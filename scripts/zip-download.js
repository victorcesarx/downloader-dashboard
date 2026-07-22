/**
 * Batch ZIP Downloader Module (zip-download.js)
 */
import { store } from './state.js';
import { Toast, formatBytes, formatSpeed } from './utils.js';
import { t } from './i18n.js';

let pollingInterval = null;

export async function startZipDownload() {
  const { items, selectedItemIds } = store.state;
  const selectedItems = items.filter(i => selectedItemIds.has(i.id));

  if (selectedItems.length === 0) {
    Toast.show('Nenhuma mídia selecionada.', 'warning');
    return;
  }

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

    renderZipPanel(taskId, selectedItems.length);
    startPollingStatus(taskId);
  } catch (err) {
    console.error('ZIP start error:', err);
    Toast.show(t('toast.zip_error'), 'error');
  }
}

function renderZipPanel(taskId, totalFiles) {
  let panel = document.getElementById('zip-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'zip-panel';
    panel.className = 'zip-panel';
    document.body.appendChild(panel);
  }

  panel.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <h4 style="font-size:1.1rem; color:var(--text-primary);">${t('zip.title')}</h4>
      <button class="btn btn-icon btn-sm cancel-zip-btn" style="width:28px; height:28px;">&times;</button>
    </div>
    <div id="zip-status-text" style="font-size:0.9rem; color:var(--text-secondary);">${t('zip.preparing')}</div>
    <div class="progress-bar-container">
      <div id="zip-progress-bar" class="progress-bar-fill"></div>
    </div>
    <div style="display:flex; justify-content:space-between; font-size:0.8rem; color:var(--text-muted);">
      <span id="zip-speed">0 B/s</span>
      <span id="zip-processed-bytes">0 B</span>
    </div>
    <div id="zip-action-area" style="margin-top:4px;"></div>
  `;

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
        Toast.show(data.error || 'Task cancelada ou com erro', 'error');
        removeZipPanel();
      }
    } catch (err) {
      console.error('Polling error:', err);
    }
  }, 300);
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

  statusText.textContent = `${t('zip.progress', { current, total })} (${percent}%)`;
  if (progressBar) progressBar.style.width = `${percent}%`;
  if (speedEl) speedEl.textContent = formatSpeed(data.speed || 0);
  if (bytesEl) bytesEl.textContent = formatBytes(data.currentBytes || 0);
}

function onZipCompleted(taskId) {
  const statusText = document.getElementById('zip-status-text');
  const actionArea = document.getElementById('zip-action-area');
  const progressBar = document.getElementById('zip-progress-bar');

  if (statusText) statusText.textContent = t('zip.download_ready');
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
