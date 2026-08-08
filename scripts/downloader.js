import { Toast, formatBytes, formatSpeed, apiFetch, playBeep, showSystemNotification, sanitizeHtml, ensureFileExtension, extensionFromMime } from './utils.js';
import { onLocaleChange, t } from './i18n.js';
import { store } from './state.js';
import { updateBatchActionsUI, updateCardSize } from './renderer/batch.js';
import { openRightPanel } from './right-panel.js';

const activeDownloads = new Map();
const HISTORY_STORAGE_KEY = 'webscope_download_history_v1';
export const DOWNLOAD_HISTORY_LIMIT = 50;
export const DOWNLOAD_MAX_ATTEMPTS = 3;
export const DOWNLOAD_RETRY_BASE_MS = 500;
let _onChange = null;
let runningSlots = 0;

function historyLimit() {
  return Math.min(100, Math.max(10, Number(store.state.historyRetention) || DOWNLOAD_HISTORY_LIMIT));
}

function historySnapshot(ad) {
  return {
    item: ad.item,
    state: ad.state,
    _done: true,
    receivedLength: ad.receivedLength || 0,
    totalLength: ad.totalLength || 0,
    totalLengthKnown: ad.totalLengthKnown === true,
    startTime: ad.startTime || null,
    finishedAt: ad.finishedAt || Date.now(),
    errorMsg: ad.errorMsg || null,
    shortMsg: ad.shortMsg || null,
    speed: 0,
    paused: false,
  };
}

function persistHistory() {
  try {
    const records = [...activeDownloads.values()]
      .filter(ad => ad._done)
      .sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0))
      .slice(0, historyLimit())
      .map(historySnapshot);
    sessionStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(records));
  } catch { /* sessionStorage indisponível ou item não serializável */ }
}

function hydrateHistory() {
  try {
    const records = JSON.parse(sessionStorage.getItem(HISTORY_STORAGE_KEY) || '[]');
    if (!Array.isArray(records)) return;
    for (const record of records.slice(0, historyLimit())) {
      if (!record?.item?.id || !['completed', 'error'].includes(record.state)) continue;
      activeDownloads.set(record.item.id, {
        ...record,
        totalLengthKnown: record.totalLengthKnown === true,
        stateEl: null, cardEl: null, controller: null,
      });
    }
  } catch { /* histórico inválido é ignorado */ }
}

function pruneHistory() {
  const terminal = [...activeDownloads.values()]
    .filter(ad => ad._done)
    .sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
  for (const ad of terminal.slice(historyLimit())) activeDownloads.delete(ad.item.id);
  persistHistory();
}

hydrateHistory();

onLocaleChange(() => {
  for (const ad of activeDownloads.values()) renderState(ad, ad.state);
  notifyChange();
});

export function setOnChange(cb) {
  _onChange = cb;
}

export function getActiveDownloads() {
  return activeDownloads;
}

export function dismissDownload(ad) {
  cleanup(ad);
}

export function restartDownload(ad) {
  if (!ad) return;
  const { item, cardEl } = ad;
  cleanup(ad);
  downloadFile(item, cardEl);
}

export function cancelActiveDownload(ad) {
  cancelDownload(ad);
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
  const speed = ad.waitingRetry
    ? t('dl.retrying', { attempt: ad.attempt + 1, max: DOWNLOAD_MAX_ATTEMPTS })
    : paused ? t('dl.paused_at', { pct }) : formatSpeed(ad.speed);
  const pauseLabel = paused ? `▶ ${t('dl.resume')}` : `⏸ ${t('dl.pause')}`;
  return `
    ${progressBarHtml(width)}
    ${infoLineHtml(speed, `${bytes} · ${pct}%`)}
    ${controlsRowHtml(`
      ${ad.waitingRetry ? '' : stateBtnHtml('secondary', pauseLabel, 'data-action="pause"')}
      ${stateBtnHtml('secondary', `✕ ${t('dl.cancel')}`, 'data-action="cancel"')}
    `)}
  `;
}

function queuedHTML(ad) {
  return `${progressBarHtml(0)}${infoLineHtml(t('dl.queued'), t('dl.attempt', { attempt: ad.attempt, max: DOWNLOAD_MAX_ATTEMPTS }))}${controlsRowHtml(stateBtnHtml('secondary', `✕ ${t('dl.cancel')}`, 'data-action="cancel"'))}`;
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

  if (state === 'queued') {
    el.innerHTML = queuedHTML(ad);
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
  if (!ad || ad._done) return false;

  const stateEl = cardEl.querySelector('.card-state');
  if (!stateEl) return false;

  ad.cardEl = cardEl;
  ad.stateEl = stateEl;
  renderState(ad, ad.state);
  return true;
}

export function downloadFile(item, cardEl) {
  const existing = activeDownloads.get(item.id);
  if (existing && !existing._done) {
    Toast.show(t('toast.download_in_progress'), 'warning');
    return;
  }
  if (existing) cleanup(existing);

  const stateEl = cardEl?.querySelector('.card-state') || null;

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
    attempt: 1,
    waitingRetry: false,
    retryTimer: null,
    _done: false
  };

  activeDownloads.set(item.id, ad);
  notifyChange();
  openRightPanel('downloads');

  if (runningSlots < (store.state.downloadConcurrency || 3)) beginDownload(ad);
  else renderState(ad, 'queued');
}

function beginDownload(ad) {
  if (!ad || ad._done || ad._cleanedUp || ad.runningSlot) return;
  ad.runningSlot = true;
  runningSlots += 1;
  renderState(ad, 'downloading');
  startSpeedTimer(ad);
  notifyChange();
  executeDownload(ad);
}

function releaseSlot(ad) {
  if (!ad?.runningSlot) return;
  ad.runningSlot = false;
  runningSlots = Math.max(0, runningSlots - 1);
  pumpDownloadQueue();
}

function pumpDownloadQueue() {
  const limit = store.state.downloadConcurrency || 3;
  for (const ad of activeDownloads.values()) {
    if (runningSlots >= limit) break;
    if (!ad._done && ad.state === 'queued') beginDownload(ad);
  }
}

async function executeDownload(ad) {
  if (!ad || ad._done) return;

  try {
    if (ad.item.delivery === 'hls' || ad.item.delivery === 'dash') {
      const formatError = new Error(t('toast.streaming_unsupported'));
      formatError.code = 'UNSUPPORTED_FORMAT';
      throw formatError;
    }
    const res = await apiFetch(ad.item.proxyUrl, { signal: ad.controller.signal });
    if (!res.ok) {
      const httpError = new Error(`HTTP ${res.status}`);
      httpError.status = res.status;
      throw httpError;
    }

    ad.contentType = res.headers.get('content-type') || null;
    const contentLength = res.headers.get('content-length');
    ad.totalLengthKnown = contentLength !== null && Number.isFinite(parseInt(contentLength, 10));
    ad.totalLength = ad.totalLengthKnown ? parseInt(contentLength, 10) : 0;
    if (ad.totalLengthKnown) updateKnownItemSize(ad, ad.totalLength);

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
    if (shouldRetry(ad, err)) scheduleRetry(ad, err);
    else onError(ad, err);
  }
}

function shouldRetry(ad, err) {
  if (!ad || ad._done || ad.attempt >= DOWNLOAD_MAX_ATTEMPTS) return false;
  if ([400, 401, 403, 404, 405, 410, 415, 422].includes(err?.status)) return false;
  if (err?.code === 'UNSUPPORTED_FORMAT') return false;
  return true;
}

function scheduleRetry(ad, err) {
  if (!ad || ad._done) return;
  ad.errorMsg = String(err?.message || err);
  ad.waitingRetry = true;
  ad.state = 'downloading';
  const delay = DOWNLOAD_RETRY_BASE_MS * (2 ** (ad.attempt - 1)) + Math.floor(Math.random() * 250);
  ad.nextRetryAt = Date.now() + delay;
  renderState(ad, 'downloading');
  notifyChange();
  ad.retryTimer = setTimeout(() => {
    if (ad._done || ad._cleanedUp) return;
    ad.retryTimer = null;
    ad.waitingRetry = false;
    ad.attempt += 1;
    ad.controller = new AbortController();
    ad.chunks = [];
    ad.receivedLength = 0;
    ad.totalLength = 0;
    ad.totalLengthKnown = false;
    ad.lastCheckBytes = 0;
    ad.lastCheckTime = Date.now();
    renderState(ad, 'downloading');
    notifyChange();
    executeDownload(ad);
  }, delay);
}

function finishDownload(ad) {
  if (!ad || ad._done) return;
  ad._done = true;
  ad.finishedAt = Date.now();

  if (store.state.soundEnabled) playBeep();
  if (store.state.notificationsEnabled) showSystemNotification(t('dl.complete'), ad.item.name);

  const blob = new Blob(ad.chunks);
  if (!ad.totalLengthKnown) {
    ad.totalLength = blob.size;
    ad.totalLengthKnown = true;
    updateKnownItemSize(ad, blob.size);
  }
  const blobUrl = URL.createObjectURL(blob);
  const fileName = ensureFileExtension(
    ad.item.name,
    extensionFromMime(ad.contentType) || ad.item.ext || 'bin'
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
  stopTimer(ad);
  releaseSlot(ad);
  pruneHistory();
  notifyChange();
  setTimeout(() => restoreCardIdle(ad), 2500);
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
  if (ad.retryTimer) {
    clearTimeout(ad.retryTimer);
    ad.retryTimer = null;
  }
  ad.controller?.abort();
  cleanup(ad);
}

function onError(ad, err) {
  if (!ad || ad._done) return;
  ad._done = true;
  ad.finishedAt = Date.now();
  ad.errorMsg = String(err && err.message ? err.message : err);
  ad.shortMsg = t('dl.error');
  Toast.show(`${t('dl.error')}: ${ad.errorMsg}`, 'error');
  stopTimer(ad);
  releaseSlot(ad);
  renderState(ad, 'error');
  pruneHistory();
  notifyChange();
}

function retryDownload(ad) {
  restartDownload(ad);
}

function stopTimer(ad) {
  if (ad && ad.speedInterval) {
    clearInterval(ad.speedInterval);
    ad.speedInterval = null;
  }
}

function updateKnownItemSize(ad, size) {
  if (!ad?.item || !Number.isFinite(size) || size < 0) return;
  ad.item.size = size;
  const index = store.state.items.findIndex(item => String(item.id) === String(ad.item.id));
  if (index !== -1) {
    const items = [...store.state.items];
    items[index] = { ...items[index], size };
    ad.item = items[index];
    store.state.items = items;
  }
  updateCardSize(ad.item.id, size);
  updateBatchActionsUI();
}

function cleanup(ad) {
  if (!ad || ad._cleanedUp) return;
  ad._cleanedUp = true;
  if (ad.retryTimer) clearTimeout(ad.retryTimer);
  ad.retryTimer = null;
  stopTimer(ad);
  releaseSlot(ad);
  activeDownloads.delete(ad.item.id);
  persistHistory();
  notifyChange();
  if (ad.blobUrl) URL.revokeObjectURL(ad.blobUrl);
  const el = ad.stateEl;
  if (el) {
    el.dataset.state = 'idle';
    if (ad.idleHtml) el.innerHTML = ad.idleHtml;
  }
}

store.subscribe((property) => {
  if (property === 'downloadConcurrency') pumpDownloadQueue();
  if (property === 'historyRetention') pruneHistory();
});

function restoreCardIdle(ad) {
  const el = ad?.stateEl;
  if (!el || activeDownloads.get(ad.item.id) !== ad) return;
  el.dataset.state = 'idle';
  if (ad.idleHtml) el.innerHTML = ad.idleHtml;
  ad.stateEl = null;
  ad.cardEl = null;
}
