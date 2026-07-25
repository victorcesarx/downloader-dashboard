import { Toast, formatBytes, formatSpeed, apiFetch, playBeep } from './utils.js';
import { t } from './i18n.js';
import { store } from './state.js';

const activeDownloads = new Map();
let _onChange = null;

export function setOnChange(cb) {
  _onChange = cb;
}

export function getActiveDownloads() {
  return activeDownloads;
}

function notifyChange() {
  if (_onChange) _onChange(activeDownloads);
}

export function downloadFile(item, cardEl) {
  if (activeDownloads.has(item.id)) {
    Toast.show(t('toast.download_in_progress'), 'warning');
    return;
  }

  const controller = new AbortController();
  const ad = {
    item, cardEl, controller,
    paused: false, resume: null,
    chunks: [],
    receivedLength: 0, totalLength: 0,
    startTime: Date.now(),
    lastCheckTime: Date.now(), lastCheckBytes: 0,
    speed: 0, speedInterval: null,
    _done: false
  };

  activeDownloads.set(item.id, ad);
  notifyChange();

  const actions = cardEl.querySelector('.card-actions');
  ad.actionsChildren = Array.from(actions.children);
  ad.actionsChildren.forEach(el => el.style.display = 'none');

  const progressEl = document.createElement('div');
  progressEl.className = 'card-progress-inline';
  progressEl.innerHTML = `
    <div class="progress-bar-container" style="margin:0;">
      <div class="progress-bar-fill" style="width:0%;"></div>
    </div>
    <div style="display:flex; justify-content:space-between; font-size:0.7rem; color:var(--text-muted); margin-top:2px;">
      <span class="cp-speed">${formatSpeed(0)}</span>
      <span class="cp-bytes">${formatBytes(0)}</span>
    </div>
    <div style="display:flex; gap:4px; margin-top:4px;">
      <button class="btn btn-secondary btn-sm cp-pause" style="flex:1;padding:2px 6px;font-size:0.7rem;" title="${t('dl.pause')}">⏸ ${t('dl.pause')}</button>
      <button class="btn btn-secondary btn-sm cp-cancel" style="flex:1;padding:2px 6px;font-size:0.7rem;" title="${t('dl.cancel')}">✕ ${t('dl.cancel')}</button>
    </div>
  `;
  actions.appendChild(progressEl);
  actions.style.flexDirection = 'column';

  progressEl.querySelector('.cp-pause').addEventListener('click', () => togglePause(ad));
  progressEl.querySelector('.cp-cancel').addEventListener('click', () => cancelDownload(ad));

  startSpeedTimer(ad);
  executeDownload(ad);
}

async function executeDownload(ad) {
  if (!ad || ad._done) return;

  try {
    const res = await apiFetch(ad.item.proxyUrl, { signal: ad.controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const contentLength = res.headers.get('content-length');
    ad.totalLength = contentLength ? parseInt(contentLength) : 0;

    const reader = res.body.getReader();

    while (true) {
      if (ad.paused) {
        updatePauseUI(ad, true);
        await new Promise(resolve => { ad.resume = resolve; });
        if (ad._done) return;
        updatePauseUI(ad, false);
      }

      ad.controller.signal.throwIfAborted();

      const { done, value } = await reader.read();
      if (done) break;

      ad.chunks.push(value);
      ad.receivedLength += value.length;
      updateProgress(ad);
    }

    finishDownload(ad);
  } catch (err) {
    if (err.name === 'AbortError') return cleanup(ad);
    onError(ad, err.message);
  }
}

function finishDownload(ad) {
  if (!ad || ad._done) return;
  ad._done = true;

  if (store.state.soundEnabled) playBeep();

  const blob = new Blob(ad.chunks);
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = ad.item.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(blobUrl);

  showDoneUI(ad);
  setTimeout(() => cleanup(ad), 2500);
}

function startSpeedTimer(ad) {
  if (!ad) return;
  ad.speedInterval = setInterval(() => {
    if (ad._done) return;
    const now = Date.now();
    const elapsed = (now - ad.lastCheckTime) / 1000;
    if (elapsed > 0) {
      ad.speed = Math.round((ad.receivedLength - ad.lastCheckBytes) / elapsed);
    }
    ad.lastCheckTime = now;
    ad.lastCheckBytes = ad.receivedLength;
    const el = ad.cardEl?.querySelector('.cp-speed');
    if (el) el.textContent = formatSpeed(ad.speed);
  }, 200);
}

function updateProgress(ad) {
  if (!ad || ad._done) return;

  const now = Date.now();
  if (ad._lastProgressUpdate && (now - ad._lastProgressUpdate) < 200) return;
  ad._lastProgressUpdate = now;

  const bar = ad.cardEl?.querySelector('.progress-bar-fill');
  const bytesEl = ad.cardEl?.querySelector('.cp-bytes');

  if (ad.totalLength > 0 && bar) {
    bar.style.width = `${Math.min((ad.receivedLength / ad.totalLength) * 100, 100)}%`;
  } else if (bar) {
    bar.style.width = '100%';
    bar.style.opacity = '0.3';
  }

  if (bytesEl) {
    const pct = ad.totalLength > 0 ? ` (${Math.round((ad.receivedLength / ad.totalLength) * 100)}%)` : '';
    bytesEl.textContent = `${formatBytes(ad.receivedLength)}${pct}`;
  }

  notifyChange();
}

function togglePause(ad) {
  if (!ad || ad._done) return;
  if (ad.paused) {
    ad.paused = false;
    if (ad.resume) ad.resume();
  } else {
    ad.paused = true;
  }
}

function updatePauseUI(ad, paused) {
  if (!ad || ad._done) return;
  const btn = ad.cardEl?.querySelector('.cp-pause');
  if (btn) btn.textContent = paused ? `▶ ${t('dl.resume')}` : `⏸ ${t('dl.pause')}`;
}

function cancelDownload(ad) {
  if (!ad || ad._done) return;
  ad.controller.abort();
  cleanup(ad);
}

function showDoneUI(ad) {
  if (!ad || !ad.cardEl) return;
  const progressEl = ad.cardEl.querySelector('.card-progress-inline');
  if (progressEl) {
    progressEl.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px; font-size:0.8rem; color:var(--success);">
        <span>✅</span>
        <span>${t('dl.complete')}</span>
      </div>
    `;
  }
}

function onError(ad, message) {
  if (!ad || ad._done) return;
  ad._done = true;
  Toast.show(`${t('dl.error')}: ${message}`, 'error');
  const progressEl = ad.cardEl?.querySelector('.card-progress-inline');
  if (progressEl) {
    progressEl.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px; font-size:0.8rem; color:var(--danger);">
        <span>❌</span>
        <span>${t('dl.error')}</span>
      </div>
      <button class="btn btn-primary btn-sm cp-close" style="margin-top:6px;width:100%;padding:4px 8px;font-size:0.75rem;" title="${t('actions.close')}">${t('actions.close')}</button>
    `;
    progressEl.querySelector('.cp-close')?.addEventListener('click', () => cleanup(ad));
  }
  setTimeout(() => cleanup(ad), 4000);
}

function cleanup(ad) {
  if (!ad || ad._done) return;
  ad._done = true;
  if (ad.speedInterval) {
    clearInterval(ad.speedInterval);
    ad.speedInterval = null;
  }
  activeDownloads.delete(ad.item.id);
  notifyChange();
  const progressEl = ad.cardEl?.querySelector('.card-progress-inline');
  if (progressEl) progressEl.remove();
  const actions = ad.cardEl?.querySelector('.card-actions');
  if (actions) {
    actions.style.flexDirection = '';
    (ad.actionsChildren || []).forEach(el => el.style.display = '');
  }
}
