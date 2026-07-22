/**
 * Batch ZIP Downloader Module (zip-download.js)
 */
import { store } from './state.js';
import { Toast, formatBytes, formatSpeed } from './utils.js';
import { t } from './i18n.js';

let pollingInterval = null;
let isZipping = false;

export async function startZipDownload() {
  if (isZipping) return;
  isZipping = true;

  const { items, selectedItemIds } = store.state;
  const selectedItems = items.filter(i => selectedItemIds.has(i.id));

  if (selectedItems.length === 0) {
    isZipping = false;
    Toast.show('Nenhuma mídia selecionada.', 'warning');
    return;
  }

  disableZipButton();

  const payload = {
    items: selectedItems.map(item => ({
      name: item.name,
      url: item.url,
      ext: item.ext
    }))
  };

  try {
    const res = await fetch('/download-zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error('Falha ao iniciar empacotamento ZIP');

    const data = await res.json();
    const taskId = data.taskId;

    const totalBytes = selectedItems.reduce((sum, i) => sum + (i.size || 0), 0);
    renderZipPanel(taskId, selectedItems.length, totalBytes);
    startPollingStatus(taskId);
  } catch (err) {
    console.error('ZIP start error:', err);
    Toast.show(t('toast.zip_error'), 'error');
    isZipping = false;
    enableZipButton();
  }
}

function disableZipButton() {
  const btn = document.getElementById('download-selected-btn');
  if (btn) btn.disabled = true;
}

function enableZipButton() {
  const btn = document.getElementById('download-selected-btn');
  if (btn) {
    const count = store.state.selectedItemIds.size;
    btn.disabled = count === 0;
  }
}

function renderZipPanel(taskId, totalFiles, totalBytes) {
  const oldPanel = document.getElementById('zip-panel');
  if (oldPanel) oldPanel.remove();

  const panel = document.createElement('div');
  panel.id = 'zip-panel';
  panel.className = 'zip-panel';

  panel.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <h4 style="font-size:1.1rem; color:var(--text-primary);">${t('zip.title')}</h4>
      <button class="btn btn-icon btn-sm cancel-zip-btn" style="width:28px; height:28px;">&times;</button>
    </div>
    <div id="zip-status-text" style="font-size:0.9rem; color:var(--text-secondary);" data-total-bytes="${totalBytes}">${renderZipStatusText(0, totalFiles, totalBytes)}</div>
    <div class="progress-bar-container">
      <div id="zip-progress-bar" class="progress-bar-fill" style="width:0%"></div>
    </div>
    <div style="display:flex; justify-content:space-between; font-size:0.8rem; color:var(--text-muted);">
      <span id="zip-speed">0 B/s</span>
      <span id="zip-processed-bytes">0 B</span>
    </div>
    <div id="zip-action-area" style="margin-top:4px;"></div>
  `;

  document.body.appendChild(panel);

  panel.querySelector('.cancel-zip-btn').addEventListener('click', () => {
    cancelZipTask(taskId);
  });
}

function startPollingStatus(taskId) {
  if (pollingInterval) clearInterval(pollingInterval);

  pollingInterval = setInterval(async () => {
    try {
      const res = await fetch(`/download-zip/status/${taskId}`);
      if (!res.ok) return;

      const data = await res.json();
      updateZipPanelUI(taskId, data);

      if (data.status === 'completed') {
        clearInterval(pollingInterval);
        onZipCompleted(taskId);
      } else if (data.status === 'error' || data.status === 'cancelled') {
        clearInterval(pollingInterval);
        resetZipState();
        Toast.show(data.error || 'Task cancelada ou com erro', 'error');
        removeZipPanel();
      }
    } catch (err) {
      console.error('Polling error:', err);
    }
  }, 300);
}

function renderZipStatusText(current, total, totalBytes) {
  return `${t('zip.progress', { current, total })} (${Math.round((current / (total || 1)) * 100)}%) — ${formatBytes(totalBytes)}`;
}

function updateZipPanelUI(taskId, data) {
  const statusText = document.getElementById('zip-status-text');
  const progressBar = document.getElementById('zip-progress-bar');
  const speedEl = document.getElementById('zip-speed');
  const bytesEl = document.getElementById('zip-processed-bytes');

  if (!statusText) return;

  const current = data.processed || 0;
  const total = data.total || 1;
  const percent = Math.round((current / total) * 100);
  const totalBytes = parseInt(statusText.getAttribute('data-total-bytes') || '0', 10);

  statusText.textContent = renderZipStatusText(current, total, totalBytes);
  if (progressBar) progressBar.style.width = `${percent}%`;
  if (speedEl) speedEl.textContent = formatSpeed(data.speed || 0);
  if (bytesEl) bytesEl.textContent = formatBytes(data.currentBytes || 0);
}

function resetZipState() {
  isZipping = false;
  enableZipButton();
}

function onZipCompleted(taskId) {
  resetZipState();
  const statusText = document.getElementById('zip-status-text');
  const actionArea = document.getElementById('zip-action-area');
  const progressBar = document.getElementById('zip-progress-bar');

  if (statusText) {
    const totalBytes = parseInt(statusText.getAttribute('data-total-bytes') || '0', 10);
    statusText.textContent = `${t('zip.download_ready')} — ${formatBytes(totalBytes)}`;
  }
  if (progressBar) progressBar.style.width = '100%';

  if (actionArea) {
    actionArea.innerHTML = `
      <a href="/download-zip/result/${taskId}" class="btn btn-primary btn-sm" style="width:100%;" download="downdash_media_pack.zip">
        ${t('zip.download_btn')}
      </a>
    `;
  }
}

async function cancelZipTask(taskId) {
  resetZipState();
  if (pollingInterval) clearInterval(pollingInterval);
  try {
    await fetch(`/download-zip/cancel/${taskId}`);
  } catch (e) {}
  removeZipPanel();
}

function removeZipPanel() {
  const panel = document.getElementById('zip-panel');
  if (panel) panel.remove();
}
