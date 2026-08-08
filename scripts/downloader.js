import { Toast, formatBytes, formatSpeed, apiFetch, playBeep, sanitizeHtml, ensureFileExtension, extensionFromMime } from './utils.js';
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

export function dismissDownload(ad) {
  cleanup(ad);
}

function notifyChange() {
  if (_onChange) _onChange(activeDownloads);
}

// ---------------------------------------------------------------------------
// Máquina de estados visual da Action Area (.card-state)
//
// A área tem altura fixa definida em CSS (min-height) e existe desde o
// primeiro render do card. Cada estado apenas troca o conteúdo interno da
// área — a altura total do card nunca muda, portanto não há layout shift,
// nem no grid, nem nas linhas vizinhas.
// ---------------------------------------------------------------------------

function progressBarHtml(widthPct, extraClass = '') {
  return `
    <div class="card-state-bar">
      <div class="progress-bar-container">
        <div class="progress-bar-fill ${extraClass}" style="width:${widthPct}%;"></div>
      </div>
    </div>`;
}

function infoLineHtml(speedText, bytesText) {
  return `
    <div class="card-state-info">
      <span class="card-state-speed">${speedText}</span>
      <span class="card-state-bytes">${bytesText}</span>
    </div>`;
}

function controlsRowHtml(buttonsHtml) {
  return `<div class="card-state-controls">${buttonsHtml}</div>`;
}

function stateBtnHtml(kind, label, opts = '') {
  const cls = kind === 'primary' ? 'btn-primary' : 'btn-secondary';
  return `<button class="btn ${cls} btn-sm" ${opts}>${label}</button>`;
}

function downloadingHTML(ad, paused = false) {
  const pct = ad.totalLength > 0 ? Math.round((ad.receivedLength / ad.totalLength) * 100) : 0;
  const width = ad.totalLength > 0 ? Math.min(pct, 100) : 0;
  const bytes = ad.totalLength > 0
    ? `${formatBytes(ad.receivedLength)} / ${formatBytes(ad.totalLength)}`
    : formatBytes(ad.receivedLength);
  const speed = paused ? t('dl.paused_at', { pct }) : formatSpeed(ad.speed);
  const pauseLabel = paused ? `▶ ${t('dl.resume')}` : `⏸ ${t('dl.pause')}`;
  return `
    ${progressBarHtml(width)}
    ${infoLineHtml(speed, `${bytes} · ${pct}%`)}
    ${controlsRowHtml(`
      ${stateBtnHtml('secondary', pauseLabel, 'data-action="pause"')}
      ${stateBtnHtml('secondary', `✕ ${t('dl.cancel')}`, 'data-action="cancel"')}
    `)}
  `;
}

function completeHTML() {
  return `
    ${progressBarHtml(100, 'card-state-fill--done')}
    <div class="card-state-result card-state-result--done">
      <span>✅ ${t('dl.complete')}</span>
    </div>
    <div class="card-state-actions">
      <button class="btn btn-secondary btn-sm" disabled>${t('dl.done')}</button>
    </div>
  `;
}

function errorHTML(ad) {
  return `
    ${progressBarHtml(100, 'card-state-fill--error')}
    <div class="card-state-result card-state-result--error" title="${sanitizeHtml(ad.errorMsg || '')}">
      <span>❌ ${sanitizeHtml(ad.shortMsg || t('dl.error'))}</span>
    </div>
    <div class="card-state-actions">
      <button class="btn btn-primary btn-sm" data-action="retry">${t('dl.retry')}</button>
      <button class="btn btn-secondary btn-sm" data-action="close">${t('actions.close')}</button>
    </div>
  `;
}

function renderState(ad, state) {
  if (!ad || !ad.stateEl) return;
  const el = ad.stateEl;
  ad.state = state;
  el.dataset.state = state;

  if (state === 'downloading' || state === 'paused') {
    const paused = state === 'paused';
    el.innerHTML = downloadingHTML(ad, paused);
    el.querySelector('[data-action="pause"]')?.addEventListener('click', () => togglePause(ad));
    el.querySelector('[data-action="cancel"]')?.addEventListener('click', () => cancelDownload(ad));
    return;
  }

  if (state === 'completed') {
    el.innerHTML = completeHTML(ad);
    return;
  }

  if (state === 'error') {
    el.innerHTML = errorHTML(ad);
    el.querySelector('[data-action="retry"]')?.addEventListener('click', () => retryDownload(ad));
    el.querySelector('[data-action="close"]')?.addEventListener('click', () => cleanup(ad));
    return;
  }

  el.dataset.state = 'idle';
}

// Referência estável do HTML idle da Action Area.
//
// Armazenada uma única vez, no primeiro download iniciado a partir de um
// card realmente em estado idle. Retry/erro/pause/complete NUNCA recapturam
// o HTML — a área que restaura depois de concluir/cancelar é sempre o
// markup original dos botões, nunca o template de erro.
const WS_IDLE_KEY = '__wsActionIdleHtml';

function captureIdleHtml(stateEl) {
  if (!stateEl) return null;
  if (stateEl[WS_IDLE_KEY] !== undefined) return stateEl[WS_IDLE_KEY];
  if (stateEl.dataset.state !== 'idle') return null;
  stateEl[WS_IDLE_KEY] = stateEl.innerHTML;
  return stateEl[WS_IDLE_KEY];
}

// Rebind da Action Area após remount do virtual scroll.
//
// O card recriado pela virtualização nasce em idle; se o item ainda tiver
// um download ativo (activeDownloads é a fonte de verdade persistente),
// re-ancora o ad no novo DOM e re-renderiza o estado visual real.
// Não reinicia o download, não duplica timers/listeners: o ad original
// (com AbortController, chunks e progresso) é apenas re-apegado. Controles
// (pause/cancel/retry/close) são re-ligados pelo próprio renderState.
export function restoreDownloadState(item, cardEl) {
  if (!item || !cardEl) return false;
  const ad = activeDownloads.get(item.id);
  if (!ad) return false;

  const stateEl = cardEl.querySelector('.card-state');
  if (!stateEl) return false;

  ad.cardEl = cardEl;
  ad.stateEl = stateEl;
  renderState(ad, ad.state);
  return true;
}

export function downloadFile(item, cardEl) {
  if (activeDownloads.has(item.id)) {
    Toast.show(t('toast.download_in_progress'), 'warning');
    return;
  }

  const stateEl = cardEl.querySelector('.card-state');
  if (!stateEl) return;

  const controller = new AbortController();
  const ad = {
    item, cardEl, stateEl, controller,
    paused: false, resume: null,
    chunks: [],
    receivedLength: 0, totalLength: 0,
    startTime: Date.now(),
    lastCheckTime: Date.now(), lastCheckBytes: 0,
    speed: 0, speedInterval: null,
    idleHtml: captureIdleHtml(stateEl),
    state: 'idle',
    _done: false
  };

  activeDownloads.set(item.id, ad);
  notifyChange();

  renderState(ad, 'downloading');
  startSpeedTimer(ad);
  executeDownload(ad);
}

async function executeDownload(ad) {
  if (!ad || ad._done) return;

  try {
    const res = await apiFetch(ad.item.proxyUrl, { signal: ad.controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    ad.contentType = res.headers.get('content-type') || null;
    const contentLength = res.headers.get('content-length');
    ad.totalLength = contentLength ? parseInt(contentLength) : 0;

    const reader = res.body.getReader();

    while (true) {
      if (ad.paused) {
        renderState(ad, 'paused');
        await new Promise(resolve => { ad.resume = resolve; });
        if (ad._done) return;
        renderState(ad, 'downloading');
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
    onError(ad, err);
  }
}

function finishDownload(ad) {
  if (!ad || ad._done) return;
  ad._done = true;

  if (store.state.soundEnabled) playBeep();

  const blob = new Blob(ad.chunks);
  const blobUrl = URL.createObjectURL(blob);
  const fileName = ensureFileExtension(
    ad.item.name,
    ad.item.ext || extensionFromMime(ad.contentType) || 'bin'
  );
  ad.blobUrl = blobUrl;

  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(blobUrl);

  renderState(ad, 'completed');
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
    if (!ad.paused) {
      const el = ad.stateEl?.querySelector('.card-state-speed');
      if (el) el.textContent = formatSpeed(ad.speed);
    }
  }, 200);
}

function updateProgress(ad) {
  if (!ad || ad._done) return;

  const now = Date.now();
  if (ad._lastProgressUpdate && (now - ad._lastProgressUpdate) < 200) return;
  ad._lastProgressUpdate = now;

  const bar = ad.stateEl?.querySelector('.progress-bar-fill');
  const bytesEl = ad.stateEl?.querySelector('.card-state-bytes');

  if (ad.totalLength > 0 && bar) {
    bar.classList.remove('is-indeterminate');
    bar.style.width = `${Math.min((ad.receivedLength / ad.totalLength) * 100, 100)}%`;
  } else if (bar) {
    bar.classList.add('is-indeterminate');
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

function cancelDownload(ad) {
  if (!ad || ad._done) return;
  ad.controller.abort();
  cleanup(ad);
}

function onError(ad, err) {
  if (!ad || ad._done) return;
  ad._done = true;
  ad.errorMsg = String(err && err.message ? err.message : err);
  ad.shortMsg = t('dl.error');
  Toast.show(`${t('dl.error')}: ${ad.errorMsg}`, 'error');
  stopTimer(ad);
  renderState(ad, 'error');
}

function retryDownload(ad) {
  if (!ad) return;
  const item = ad.item;
  const cardEl = ad.cardEl;
  stopTimer(ad);
  ad._cleanedUp = true;
  activeDownloads.delete(item.id);
  downloadFile(item, cardEl);
}

function stopTimer(ad) {
  if (ad && ad.speedInterval) {
    clearInterval(ad.speedInterval);
    ad.speedInterval = null;
  }
}

function cleanup(ad) {
  if (!ad || ad._cleanedUp) return;
  ad._cleanedUp = true;
  stopTimer(ad);
  activeDownloads.delete(ad.item.id);
  notifyChange();
  if (ad.blobUrl) URL.revokeObjectURL(ad.blobUrl);
  const el = ad.stateEl;
  if (el) {
    el.dataset.state = 'idle';
    if (ad.idleHtml) el.innerHTML = ad.idleHtml;
  }
}