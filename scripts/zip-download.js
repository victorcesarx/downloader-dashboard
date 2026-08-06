import { store } from './state.js';
import { Toast, formatBytes, formatSpeed, formatDuration, apiFetch, playBeep, sanitizeHtml } from './utils.js';
import { t } from './i18n.js';

const activeTasks = new Map();
const pollingIntervals = new Map();

// Códigos de erro conhecidos do backend em POST /download-zip → chave i18n.
// Códigos desconhecidos caem no fallback genérico zip.start_error.
const ZIP_START_ERROR_KEYS = {
  ZIP_QUEUE_FULL: 'zip.error.queue_full',
  ZIP_IP_LIMIT_REACHED: 'zip.error.ip_limit',
  ZIP_TOO_MANY_ITEMS: 'zip.error.too_many_items',
};

// Códigos de erro que o backend usa em task.error quando a tarefa finaliza
// com status 'error'. Códigos desconhecidos caem no fallback genérico.
const ZIP_TASK_ERROR_KEYS = {
  ZIP_TEMP_STORAGE_FULL: 'zip.error.temp_storage_full',
  ZIP_SIZE_LIMIT_EXCEEDED: 'zip.error.size_limit_exceeded',
};

// Classe CSS aplicada ao painel conforme o estado da tarefa.
const ZIP_PANEL_STATUS_CLASS = {
  queued: 'zip-panel--queued',
  processing: 'zip-panel--processing',
  completed: 'zip-panel--completed',
  cancelled: 'zip-panel--cancelled',
  error: 'zip-panel--error',
};

// Troca a classe de status do painel somente quando o estado muda (evita
// reiniciar animações a cada poll com o mesmo status).
function setZipPanelStatus(panel, status) {
  if (!panel || panel.dataset.zipStatus === status) return;
  Object.values(ZIP_PANEL_STATUS_CLASS).forEach(cls => panel.classList.remove(cls));
  const cls = ZIP_PANEL_STATUS_CLASS[status];
  if (cls) panel.classList.add(cls);
  panel.dataset.zipStatus = status || '';
}

export async function startZipDownload() {
  const { items, selectedItemIds } = store.state;
  const selectedItems = items.filter(i => selectedItemIds.has(i.id));

  if (selectedItems.length === 0) {
    Toast.show(t('toast.no_media_selected'), 'warning');
    return;
  }

  const zipName = await promptZipName();
  if (zipName === null) return;

  try {
    const res = await apiFetch('/download-zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: selectedItems.map(item => ({
          name: item.name,
          url: item.url,
          ext: item.ext
        }))
      })
    });

    if (!res.ok) {
      // Servidor responde { error: { code, message } }. O código é convertido
      // em uma chave i18n específica; códigos desconhecidos usam o fallback
      // genérico zip.start_error (nunca mostramos "Erro 503/429/400").
      const errData = await res.json().catch(() => ({}));
      const code = errData?.error?.code;
      const key = ZIP_START_ERROR_KEYS[code] || 'zip.start_error';
      throw new Error(t(key));
    }

    const data = await res.json();
    const taskId = data.taskId;

    const finalName = (zipName || 'webscope_media_pack');
    activeTasks.set(taskId, finalName.endsWith('.zip') ? finalName : finalName + '.zip');

    const totalBytes = selectedItems.reduce((sum, i) => sum + (i.size || 0), 0);
    store.state.activeZipTask = { taskId, total: selectedItems.length, totalBytes, progress: 0 };
    updateNavbarZipProgress(0, selectedItems.length);
    renderZipPanel(taskId, selectedItems.length, totalBytes, zipName);
    startPollingStatus(taskId);
  } catch (err) {
    console.error('ZIP start error:', err);
    Toast.show(err.message || t('toast.zip_error'), 'error');
  }
}

function renderZipPanel(taskId, totalFiles, totalBytes, zipName) {
  const panel = document.createElement('div');
  panel.id = `zip-panel-${taskId}`;
  panel.className = 'zip-panel zip-panel--queued';
  panel.dataset.taskId = taskId;
  if (zipName) panel.dataset.zipName = zipName;
  panel.dataset.zipStatus = 'queued';

  // Stack panels vertically — offset by existing panels
  const existing = document.querySelectorAll('.zip-panel:not(.closing)');
  const offset = existing.length * 175;
  panel.style.bottom = `${24 + offset}px`;

  panel.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <h4 style="font-size:1.1rem; color:var(--text-primary);">${t('zip.title')}</h4>
      <button class="cancel-zip-btn">&times;</button>
    </div>
    <div class="zip-status-text" style="font-size:0.9rem; color:var(--text-secondary);" data-total-bytes="${totalBytes}">${renderZipStatusText(0, totalFiles, totalBytes)}</div>
    <div class="zip-progress-wrap">
      <div class="progress-bar-container">
        <div class="zip-progress-bar progress-bar-fill" style="width:0%"></div>
      </div>
      <div style="display:flex; justify-content:space-between; font-size:0.8rem; color:var(--text-muted);">
        <span class="zip-speed">0 B/s</span>
        <span class="zip-eta"></span>
        <span class="zip-processed-bytes">0 B</span>
      </div>
    </div>
  `;

  document.body.appendChild(panel);

  panel.querySelector('.cancel-zip-btn').addEventListener('click', () => {
    cancelZipTask(taskId);
  });
}

function updateNavbarZipProgress(current, total) {
  const bar = document.getElementById('zip-navbar-progress');
  const fill = bar?.querySelector('.zip-navbar-progress-bar');
  if (!bar || !fill) return;
  const pct = Math.round((current / (total || 1)) * 100);
  fill.style.width = `${pct}%`;
  bar.style.display = pct < 100 ? '' : 'none';
}

export function startPollingStatus(taskId) {
  const interval = setInterval(async () => {
    try {
      const res = await apiFetch(`/download-zip/status/${taskId}`);
      if (!res.ok) return;

      const data = await res.json();
      updateZipPanelUI(taskId, data);
      updateNavbarZipProgress(data.processed || 0, data.total || 1);

      if (data.status === 'completed') {
        clearInterval(interval);
        pollingIntervals.delete(taskId);
        store.state.activeZipTask = null;
        onZipCompleted(taskId);
      } else if (data.status === 'error' || data.status === 'cancelled') {
        clearInterval(interval);
        pollingIntervals.delete(taskId);
        activeTasks.delete(taskId);
        store.state.activeZipTask = null;
        updateNavbarZipProgress(0, 0);
        // task.error traz o código (ex.: ZIP_TEMP_STORAGE_FULL) ou uma mensagem
        // livre; códigos conhecidos são convertidos em chave i18n, o restante
        // usa a própria mensagem do servidor (ou o fallback zip.task_error).
        const code = data.status === 'error' ? data.error : null;
        const errorKey = ZIP_TASK_ERROR_KEYS[code];
        const msg = errorKey ? t(errorKey) : (data.error || t('zip.task_error'));
        Toast.show(msg, 'error');
        showZipPanelError(taskId, msg);
      }
    } catch (err) {
      console.error('Polling error:', err);
    }
  }, 1000);

  pollingIntervals.set(taskId, interval);
}

function renderZipStatusText(current, total, totalBytes) {
  return `${t('zip.progress', { current, total })} (${Math.round((current / (total || 1)) * 100)}%) — ${formatBytes(totalBytes)}`;
}

export function updateZipPanelUI(taskId, data) {
  const panel = document.getElementById(`zip-panel-${taskId}`);
  if (!panel) return;

  setZipPanelStatus(panel, data.status);

  const statusText = panel.querySelector('.zip-status-text');
  const progressBar = panel.querySelector('.zip-progress-bar');
  const speedEl = panel.querySelector('.zip-speed');
  const etaEl = panel.querySelector('.zip-eta');
  const bytesEl = panel.querySelector('.zip-processed-bytes');

  if (!statusText) return;

  // Tarefa ainda na fila: mostra uma mensagem de espera (com a posição, quando
  // disponível) e zera o progresso. O polling continua — ao virar 'processing',
  // a UI volta ao render normal acima.
  if (data.status === 'queued') {
    const position = data.queuePosition;
    statusText.textContent = position != null && position > 0
      ? t('zip.queued_position', { position })
      : t('zip.queued_waiting');
    if (progressBar) progressBar.style.width = '0%';
    if (speedEl) speedEl.textContent = '';
    if (etaEl) etaEl.textContent = '';
    if (bytesEl) bytesEl.textContent = '';
    return;
  }

  const current = data.processed || 0;
  const total = data.total || 1;
  const percent = Math.round((current / total) * 100);
  const totalBytes = parseInt(statusText.getAttribute('data-total-bytes') || '0', 10);
  const speed = data.speed || 0;

  statusText.textContent = renderZipStatusText(current, total, totalBytes);
  if (progressBar) progressBar.style.width = `${percent}%`;
  if (speedEl) speedEl.textContent = formatSpeed(speed);

  const remaining = Math.max(0, totalBytes - (data.currentBytes || 0));
  if (etaEl) {
    etaEl.textContent = remaining > 0 && speed > 0 ? `~${formatDuration(remaining / speed)}` : '';
  }

  if (bytesEl) bytesEl.textContent = formatBytes(data.currentBytes || 0);
}

function onZipCompleted(taskId) {
  activeTasks.delete(taskId);

  if (store.state.soundEnabled) playBeep();
  const panel = document.getElementById(`zip-panel-${taskId}`);
  if (!panel) return;
  setZipPanelStatus(panel, 'completed');

  const statusText = panel.querySelector('.zip-status-text');
  const progressWrap = panel.querySelector('.zip-progress-wrap');

  if (statusText) {
    const totalBytes = parseInt(statusText.getAttribute('data-total-bytes') || '0', 10);
    statusText.textContent = `${t('zip.download_ready')} — ${formatBytes(totalBytes)}`;
  }

  if (progressWrap) {
    const token = localStorage.getItem('downdash_token');
    let customName = activeTasks.get(taskId) || panel.dataset.zipName || 'webscope_media_pack.zip';
    if (!customName.endsWith('.zip')) customName += '.zip';
    const params = new URLSearchParams();
    if (token) params.set('token', token);
    params.set('filename', customName);
    const resultUrl = `/download-zip/result/${taskId}?${params}`;
    progressWrap.innerHTML = `
      <a href="${resultUrl}" class="btn btn-primary btn-sm" style="width:100%;" download="${sanitizeHtml(customName)}">
        ${t('zip.download_btn')}
      </a>
    `;
    progressWrap.querySelector('a').addEventListener('click', () => {
      setTimeout(() => removeZipPanel(taskId), 2000);
    });
  }
}

// Exibe a mensagem de erro no próprio painel (status text + barra zerada) e o
// mantém visível pelo tempo do toast antes de removê-lo.
function showZipPanelError(taskId, message) {
  const panel = document.getElementById(`zip-panel-${taskId}`);
  if (panel) {
    const statusText = panel.querySelector('.zip-status-text');
    if (statusText) statusText.textContent = message;
    const progressBar = panel.querySelector('.zip-progress-bar');
    if (progressBar) progressBar.style.width = '0%';
  }
  setTimeout(() => removeZipPanel(taskId), 4000);
}

async function cancelZipTask(taskId) {
  activeTasks.delete(taskId);
  store.state.activeZipTask = null;
  updateNavbarZipProgress(0, 0);
  const interval = pollingIntervals.get(taskId);
  if (interval) {
    clearInterval(interval);
    pollingIntervals.delete(taskId);
  }
  try {
    await apiFetch(`/download-zip/cancel/${taskId}`);
  } catch (e) {}
  const panel = document.getElementById(`zip-panel-${taskId}`);
  if (panel) setZipPanelStatus(panel, 'cancelled');
  removeZipPanel(taskId);
}

function removeZipPanel(taskId) {
  const panel = document.getElementById(`zip-panel-${taskId}`);
  if (!panel) return;
  panel.classList.add('closing');
  setTimeout(() => {
    if (panel.parentNode) panel.remove();
    restackZipPanels();
  }, 400);
}

function restackZipPanels() {
  const panels = document.querySelectorAll('.zip-panel:not(.closing)');
  panels.forEach((p, i) => {
    p.style.bottom = `${24 + i * 175}px`;
  });
}

function promptZipName() {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'rename-overlay';
    overlay.innerHTML = `
      <div class="rename-dialog">
        <label class="rename-label">${t('zip.rename_label')}</label>
        <div class="rename-input-group">
          <input class="rename-input" type="text" value="webscope_media_pack" spellcheck="false" autofocus>
          <span class="rename-input-suffix">.zip</span>
        </div>
        <div class="rename-actions">
          <button class="btn btn-secondary btn-sm rename-cancel">${t('actions.cancel')}</button>
          <button class="btn btn-primary btn-sm rename-confirm">${t('zip.start')}</button>
        </div>
      </div>
    `;

    const input = overlay.querySelector('.rename-input');
    const confirmBtn = overlay.querySelector('.rename-confirm');
    const cancelBtn = overlay.querySelector('.rename-cancel');

    function close(result) {
      overlay.remove();
      document.body.style.overflow = '';
      resolve(result);
    }

    confirmBtn.addEventListener('click', () => close((input.value.trim() || 'webscope_media_pack') + '.zip'));
    cancelBtn.addEventListener('click', () => close(null));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') confirmBtn.click();
      if (e.key === 'Escape') cancelBtn.click();
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cancelBtn.click();
    });

    document.body.appendChild(overlay);
    requestAnimationFrame(() => input.select());
  });
}
