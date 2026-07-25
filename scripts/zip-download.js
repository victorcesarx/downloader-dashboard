import { store } from './state.js';
import { Toast, formatBytes, formatSpeed, formatDuration, apiFetch, playBeep } from './utils.js';
import { t } from './i18n.js';

const activeTasks = new Map();
const pollingIntervals = new Map();

export async function startZipDownload() {
  const { items, selectedItemIds } = store.state;
  const selectedItems = items.filter(i => selectedItemIds.has(i.id));

  if (selectedItems.length === 0) {
    Toast.show(t('toast.no_media_selected'), 'warning');
    return;
  }

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

    if (!res.ok) throw new Error(t('zip.start_error'));

    const data = await res.json();
    const taskId = data.taskId;

    activeTasks.set(taskId, true);

    const totalBytes = selectedItems.reduce((sum, i) => sum + (i.size || 0), 0);
    store.state.activeZipTask = { taskId, total: selectedItems.length, totalBytes, progress: 0 };
    updateNavbarZipProgress(0, selectedItems.length);
    renderZipPanel(taskId, selectedItems.length, totalBytes);
    startPollingStatus(taskId);
  } catch (err) {
    console.error('ZIP start error:', err);
    Toast.show(t('toast.zip_error'), 'error');
  }
}

function renderZipPanel(taskId, totalFiles, totalBytes) {
  const panel = document.createElement('div');
  panel.id = `zip-panel-${taskId}`;
  panel.className = 'zip-panel';
  panel.dataset.taskId = taskId;

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

function startPollingStatus(taskId) {
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
        Toast.show(data.error || t('zip.task_error'), 'error');
        removeZipPanel(taskId);
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

function updateZipPanelUI(taskId, data) {
  const panel = document.getElementById(`zip-panel-${taskId}`);
  if (!panel) return;

  const statusText = panel.querySelector('.zip-status-text');
  const progressBar = panel.querySelector('.zip-progress-bar');
  const speedEl = panel.querySelector('.zip-speed');
  const etaEl = panel.querySelector('.zip-eta');
  const bytesEl = panel.querySelector('.zip-processed-bytes');

  if (!statusText) return;

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

  const statusText = panel.querySelector('.zip-status-text');
  const progressWrap = panel.querySelector('.zip-progress-wrap');

  if (statusText) {
    const totalBytes = parseInt(statusText.getAttribute('data-total-bytes') || '0', 10);
    statusText.textContent = `${t('zip.download_ready')} — ${formatBytes(totalBytes)}`;
  }

  if (progressWrap) {
    const token = localStorage.getItem('downdash_token');
    const resultUrl = `/download-zip/result/${taskId}${token ? `?token=${token}` : ''}`;
    progressWrap.innerHTML = `
      <a href="${resultUrl}" class="btn btn-primary btn-sm" style="width:100%;" download="webscope_media_pack.zip">
        ${t('zip.download_btn')}
      </a>
    `;
    progressWrap.querySelector('a').addEventListener('click', () => {
      setTimeout(() => removeZipPanel(taskId), 2000);
    });
  }
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
