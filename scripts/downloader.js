import { Toast, formatBytes, formatSpeed } from './utils.js';
import { t } from './i18n.js';

let activeDownload = null;

export function downloadFile(item, cardEl) {
  if (activeDownload) {
    Toast.show(t('toast.download_in_progress'), 'warning');
    return;
  }

  const controller = new AbortController();
  activeDownload = {
    item, cardEl, controller,
    paused: false, resume: null,
    chunks: [],
    receivedLength: 0, totalLength: 0,
    startTime: Date.now(),
    lastCheckTime: Date.now(), lastCheckBytes: 0,
    speed: 0, speedInterval: null
  };

  const actions = cardEl.querySelector('.card-actions');
  activeDownload.actionsChildren = Array.from(actions.children);
  activeDownload.actionsChildren.forEach(el => el.style.display = 'none');

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
      <button class="btn btn-secondary btn-sm cp-pause" style="flex:1;padding:2px 6px;font-size:0.7rem;">⏸ ${t('dl.pause')}</button>
      <button class="btn btn-secondary btn-sm cp-cancel" style="flex:1;padding:2px 6px;font-size:0.7rem;">✕ ${t('dl.cancel')}</button>
    </div>
  `;
  actions.appendChild(progressEl);
  actions.style.flexDirection = 'column';

  progressEl.querySelector('.cp-pause').addEventListener('click', () => togglePause());
  progressEl.querySelector('.cp-cancel').addEventListener('click', () => cancelDownload());

  startSpeedTimer();
  executeDownload();
}

async function executeDownload() {
  const ad = activeDownload;
  if (!ad) return;

  try {
    const res = await fetch(ad.item.proxyUrl, { signal: ad.controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const contentLength = res.headers.get('content-length');
    ad.totalLength = contentLength ? parseInt(contentLength) : 0;

    const reader = res.body.getReader();

    while (true) {
      if (ad.paused) {
        updatePauseUI(true);
        await new Promise(resolve => { ad.resume = resolve; });
        updatePauseUI(false);
      }

      ad.controller.signal.throwIfAborted();

      const { done, value } = await reader.read();
      if (done) break;

      ad.chunks.push(value);
      ad.receivedLength += value.length;
      updateProgress();
    }

    finishDownload();
  } catch (err) {
    if (err.name === 'AbortError') return cleanup();
    onError(err.message);
  }
}

function finishDownload() {
  const ad = activeDownload;
  if (!ad) return;

  const blob = new Blob(ad.chunks);
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = ad.item.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(blobUrl);

  showDoneUI();
  setTimeout(cleanup, 2500);
}

function startSpeedTimer() {
  const ad = activeDownload;
  if (!ad) return;
  ad.speedInterval = setInterval(() => {
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

function updateProgress() {
  const ad = activeDownload;
  if (!ad) return;

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
}

function togglePause() {
  const ad = activeDownload;
  if (!ad) return;
  if (ad.paused) {
    ad.paused = false;
    if (ad.resume) ad.resume();
  } else {
    ad.paused = true;
  }
}

function updatePauseUI(paused) {
  const ad = activeDownload;
  if (!ad) return;
  const btn = ad.cardEl?.querySelector('.cp-pause');
  if (btn) btn.textContent = paused ? `▶ ${t('dl.resume')}` : `⏸ ${t('dl.pause')}`;
}

function cancelDownload() {
  const ad = activeDownload;
  if (!ad) return;
  ad.controller.abort();
  cleanup();
}

function showDoneUI() {
  const ad = activeDownload;
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

function onError(message) {
  const ad = activeDownload;
  if (!ad) return;
  Toast.show(`${t('dl.error')}: ${message}`, 'error');
  const progressEl = ad.cardEl?.querySelector('.card-progress-inline');
  if (progressEl) {
    progressEl.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px; font-size:0.8rem; color:var(--danger);">
        <span>❌</span>
        <span>${t('dl.error')}</span>
      </div>
      <button class="btn btn-primary btn-sm cp-close" style="margin-top:6px;width:100%;padding:4px 8px;font-size:0.75rem;">${t('actions.close')}</button>
    `;
    progressEl.querySelector('.cp-close')?.addEventListener('click', () => cleanup());
  }
  setTimeout(cleanup, 4000);
}

function cleanup() {
  const ad = activeDownload;
  if (!ad) return;
  if (ad.speedInterval) clearInterval(ad.speedInterval);
  const progressEl = ad.cardEl?.querySelector('.card-progress-inline');
  if (progressEl) progressEl.remove();
  const actions = ad.cardEl?.querySelector('.card-actions');
  if (actions) {
    actions.style.flexDirection = '';
    (ad.actionsChildren || []).forEach(el => el.style.display = '');
  }
  activeDownload = null;
}
