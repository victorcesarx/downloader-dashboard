import { getActiveDownloads, setOnChange, dismissDownload } from './downloader.js';
import { formatBytes, formatSpeed } from './utils.js';
import { t } from './i18n.js';

let panel = null;
let badge = null;
let isOpen = false;

function getOrCreatePanel() {
  if (panel) return panel;
  panel = document.createElement('div');
  panel.id = 'download-queue-panel';
  panel.className = 'download-queue-panel';
  panel.innerHTML = `
    <div class="queue-panel-header">
      <h4>${t('queue.title')}</h4>
      <div class="queue-panel-header-actions">
        <button class="btn btn-secondary btn-sm queue-clear-done" title="${t('queue.clear_done')}" style="display:none;">${t('queue.clear_done')}</button>
        <button class="queue-panel-close btn btn-icon" aria-label="${t('actions.close')}" title="${t('actions.close')}">&times;</button>
      </div>
    </div>
    <div class="queue-panel-body"></div>
  `;
  document.body.appendChild(panel);

  panel.querySelector('.queue-panel-close').addEventListener('click', toggleQueue);
  panel.querySelector('.queue-clear-done').addEventListener('click', clearCompleted);
  panel.querySelector('.queue-panel-body').addEventListener('click', (e) => {
    const target = e.target.closest('button');
    if (!target) return;
    const { action, id } = target.dataset;
    if (action === 'clear-done') { clearCompleted(); return; }
    if (!action || !id) return;
    const ad = getActiveDownloads().get(id);
    if (!ad) return;
    if (action === 'pause') togglePause(ad);
    if (action === 'cancel') cancelDownload(ad);
    if (action === 'dismiss') dismissDownload(ad);
  });

  return panel;
}

function getOrCreateBadge() {
  if (badge) return badge;
  const btn = document.getElementById('queue-toggle-btn');
  if (!btn) return null;
  badge = document.createElement('span');
  badge.className = 'queue-badge';
  btn.appendChild(badge);
  return badge;
}

function renderList() {
  const body = panel.querySelector('.queue-panel-body');
  const downloads = [...getActiveDownloads().values()];
  const hasDone = downloads.some(ad => ad._done);
  const clearBtn = panel.querySelector('.queue-clear-done');
  clearBtn.style.display = hasDone ? '' : 'none';

  if (downloads.length === 0) {
    body.innerHTML = `<div class="queue-panel-empty">${t('queue.empty')}</div>`;
    return;
  }

  body.innerHTML = downloads.map(ad => {
    const pct = ad.totalLength > 0 ? Math.round((ad.receivedLength / ad.totalLength) * 100) : 0;
    const isPaused = ad.paused;
    const isDone = ad._done;
    const isError = ad._error;

    let statusHtml;
    if (isError) {
      statusHtml = `<span class="queue-status queue-status-error">${t('dl.error')}</span>`;
    } else if (isDone) {
      statusHtml = `<span class="queue-status queue-status-done">${t('dl.complete')}</span>`;
    } else if (isPaused) {
      statusHtml = `<span class="queue-status queue-status-paused">${t('dl.paused')}</span>`;
    } else {
      statusHtml = `<span class="queue-status queue-status-active">${t('dl.downloading')}</span>`;
    }

    return `
      <div class="queue-item ${isDone ? 'queue-item-done' : ''}">
        <div class="queue-item-info">
          <span class="queue-item-name" title="${ad.item.name}">${ad.item.name}</span>
          ${statusHtml}
        </div>
        ${!isDone && !isError ? `
          <div class="progress-bar-container queue-item-progress">
            <div class="progress-bar-fill" style="width:${pct}%"></div>
          </div>
          <div class="queue-item-stats">
            <span class="queue-speed">${formatSpeed(ad.speed)}</span>
            <span class="queue-bytes">${formatBytes(ad.receivedLength)}${ad.totalLength > 0 ? ` / ${formatBytes(ad.totalLength)}` : ''}</span>
          </div>
          <div class="queue-item-actions">
            <button class="btn btn-secondary btn-sm queue-btn" data-action="pause" data-id="${ad.item.id}" title="${isPaused ? t('dl.resume') : t('dl.pause')}">${isPaused ? '▶' : '⏸'}</button>
            <button class="btn btn-secondary btn-sm queue-btn" data-action="cancel" data-id="${ad.item.id}" title="${t('dl.cancel')}">✕</button>
          </div>
        ` : `
          <div class="queue-item-dismiss">
            <button class="btn btn-secondary btn-sm queue-btn" data-action="dismiss" data-id="${ad.item.id}" title="${t('actions.close')}">${t('actions.close')}</button>
          </div>
        `}
      </div>
    `;
  }).join('');
}

function updateBadge() {
  const downloads = [...getActiveDownloads().values()];
  const count = downloads.filter(ad => !ad._done).length;
  const b = getOrCreateBadge();
  if (!b) return;
  if (count > 0) {
    b.textContent = count;
    b.style.display = '';
    const btn = document.getElementById('queue-toggle-btn');
    if (btn) btn.classList.add('has-queue');
  } else {
    b.style.display = 'none';
    const btn = document.getElementById('queue-toggle-btn');
    if (btn) btn.classList.remove('has-queue');
  }
}

function onDownloadsChange() {
  if (panel) renderList();
  updateBadge();
}

export function toggleQueue() {
  isOpen = !isOpen;
  const p = getOrCreatePanel();
  p.classList.toggle('open', isOpen);
  if (isOpen) renderList();
}

export function closeQueue() {
  isOpen = false;
  if (panel) panel.classList.remove('open');
}

export function initQueue() {
  setOnChange(onDownloadsChange);
  updateBadge();
}

function togglePause(ad) {
  if (ad.paused) {
    ad.paused = false;
    if (ad.resume) ad.resume();
  } else {
    ad.paused = true;
  }
  renderList();
}

function cancelDownload(ad) {
  ad.controller.abort();
}

function clearCompleted() {
  for (const ad of getActiveDownloads().values()) {
    if (ad._done) dismissDownload(ad);
  }
}
