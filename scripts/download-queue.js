import { DOWNLOAD_MAX_ATTEMPTS, cancelActiveDownload, getActiveDownloads, setOnChange, dismissDownload, restartDownload } from './downloader.js';
import { Toast, formatBytes, formatSpeed, sanitizeHtml } from './utils.js';
import { t } from './i18n.js';
import { store } from './state.js';
import { getActiveRightPanel, setOnRightPanelChange, closeRightPanel, toggleRightPanel } from './right-panel.js';
import { getZipQueueTasks, subscribeZipQueue } from './zip-queue.js';
import { cancelZipTask, dismissZipTask, downloadZipResult, exportZipReport, retryZipFailures } from './zip-download.js';
import { closeIconSvg } from './icons.js';
import { updateFaviconProgress } from './favicon-progress.js';

let panel = null;
let badge = null;
let localeListenerInstalled = false;
let zipListenerInstalled = false;

const TAB_DEFS = [
  { id: 'active', labelKey: 'queue.tab_active', emptyKey: 'queue.empty' },
  { id: 'completed', labelKey: 'queue.tab_completed', emptyKey: 'queue.empty_completed' },
  { id: 'failed', labelKey: 'queue.tab_failed', emptyKey: 'queue.empty_failed' },
];

let activeTab = 'active';

// Classificação a partir da fonte única (activeDownloads).
//
// Regras exatas:
// - Falhas:      ad.state === 'error'  (download encerrado com erro, ainda na fila)
// - Concluídos:  ad._done && não-falha (concluído com sucesso)
// - Ativos:      todo o resto presente na fila (downloading, paused e o
//                instante entre criação e primeiro render — state 'idle')
// - Cancelados:  saem da fila (cleanup) — não pertencem a nenhuma aba
function classifyDownloads() {
  const byTab = { active: [], completed: [], failed: [] };
  const individual = [...getActiveDownloads().values()].map(ad => ({ ...ad, kind: 'individual', queueId: ad.item.id }));
  const zips = [...getZipQueueTasks().values()].map(task => ({
    ...task,
    queueId: task.taskId,
    item: { id: task.taskId, name: task.name, type: 'archive', ext: 'zip', source: 'ZIP' },
    receivedLength: task.currentBytes || 0,
    totalLength: task.totalBytes || 0,
  }));
  for (const ad of [...individual, ...zips]) {
    const failed = ad.state === 'error';
    const done = ad.kind === 'zip'
      ? ad.state === 'completed' && ad.downloaded === true
      : ad._done && !failed;
    if (failed) byTab.failed.push(ad);
    else if (done) byTab.completed.push(ad);
    else byTab.active.push(ad);
  }
  return byTab;
}

function renderTabs() {
  if (!panel) return;
  const counts = {
    active: 0,
    completed: 0,
    failed: 0,
  };
  for (const [tab, items] of Object.entries(classifyDownloads())) {
    counts[tab] = items.length;
  }
  panel.querySelectorAll('.queue-tab').forEach(btn => {
    const id = btn.dataset.queueTab;
    const def = TAB_DEFS.find(d => d.id === id);
    btn.textContent = `${t(def.labelKey)} (${counts[id]})`;
    btn.setAttribute('aria-selected', String(id === activeTab));
  });
}

// Resumo do rodapé: mesmas contagens das abas (classifyDownloads)
// e total de bytes efetivamente recebidos pelos itens ainda na fila.
function renderSummary() {
  if (!panel) return;
  const counts = { active: 0, completed: 0, failed: 0 };
  let totalBytes = 0;
  for (const [tab, items] of Object.entries(classifyDownloads())) {
    counts[tab] = items.length;
    for (const ad of items) totalBytes += ad.receivedLength || 0;
  }
  panel.querySelector('[data-summary="active"]').textContent = counts.active;
  panel.querySelector('[data-summary="completed"]').textContent = counts.completed;
  panel.querySelector('[data-summary="failed"]').textContent = counts.failed;
  panel.querySelector('[data-summary="total"]').textContent = formatBytes(totalBytes);
}

function renderPanelLocale() {
  if (!panel) return;
  panel.querySelector('.queue-panel-heading h4').textContent = t('nav.queue');
  const clearBtn = panel.querySelector('.queue-clear-done');
  updateClearButton();
  const closeBtn = panel.querySelector('.queue-panel-close');
  closeBtn.title = t('actions.close');
  closeBtn.setAttribute('aria-label', t('actions.close'));
  panel.querySelector('.queue-summary-title').textContent = t('queue.summary');
  const summaryKeys = ['queue.tab_active', 'queue.tab_completed', 'queue.tab_failed', 'queue.total_downloaded'];
  panel.querySelectorAll('.queue-summary-label').forEach((el, index) => {
    el.textContent = t(summaryKeys[index]);
  });
  renderTabs();
  renderList();
  renderSummary();
  updateBadge();
}

// Drawer: fechar ao clicar fora do painel ou pressionar ESC.
// Clicks programáticos (ex.: a.click() do download no downloader.js)
// são `isTrusted: false` e não devem fechar a fila.
document.addEventListener('click', (e) => {
  if (getActiveRightPanel() !== 'downloads' || !e.isTrusted) return;
  if (panel && !panel.contains(e.target) && !(e.target.closest && e.target.closest('#queue-toggle-btn'))) {
    closeRightPanel();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && getActiveRightPanel() === 'downloads') closeRightPanel();
});

function getOrCreatePanel() {
  if (panel) return panel;
  panel = document.createElement('div');
  panel.id = 'download-queue-panel';
  panel.className = 'download-queue-panel';
  panel.innerHTML = `
    <div class="queue-panel-header">
      <div class="queue-panel-heading">
        <h4>${t('nav.queue')}</h4>
        <span class="queue-panel-subtext"></span>
      </div>
      <div class="queue-panel-header-actions">
        <button class="btn btn-secondary btn-sm queue-clear-done" style="display:none;"></button>
        <button class="queue-panel-close btn btn-icon icon-close-btn" aria-label="${t('actions.close')}" title="${t('actions.close')}">${closeIconSvg()}</button>
      </div>
    </div>
    <div class="queue-tabs" role="tablist">
      <button class="queue-tab" type="button" role="tab" data-queue-tab="active"></button>
      <button class="queue-tab" type="button" role="tab" data-queue-tab="completed"></button>
      <button class="queue-tab" type="button" role="tab" data-queue-tab="failed"></button>
    </div>
    <div class="queue-panel-body"></div>
    <div class="queue-summary">
      <div class="queue-summary-title">${t('queue.summary')}</div>
      <div class="queue-summary-rows">
        <div class="queue-summary-row">
          <span class="queue-summary-label">${t('queue.tab_active')}</span>
          <span class="queue-summary-value" data-summary="active">0</span>
        </div>
        <div class="queue-summary-row">
          <span class="queue-summary-label">${t('queue.tab_completed')}</span>
          <span class="queue-summary-value queue-summary-value--completed" data-summary="completed">0</span>
        </div>
        <div class="queue-summary-row">
          <span class="queue-summary-label">${t('queue.tab_failed')}</span>
          <span class="queue-summary-value queue-summary-value--failed" data-summary="failed">0</span>
        </div>
        <div class="queue-summary-row queue-summary-row--total">
          <span class="queue-summary-label">${t('queue.total_downloaded')}</span>
          <span class="queue-summary-value" data-summary="total">0 B</span>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  panel.querySelector('.queue-panel-close').addEventListener('click', () => toggleRightPanel('downloads'));
  panel.querySelector('.queue-clear-done').addEventListener('click', clearCurrentTab);
  panel.querySelector('.queue-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.queue-tab');
    if (!btn) return;
    activeTab = btn.dataset.queueTab;
    renderTabs();
    renderList();
    renderSummary();
  });
  // Miniatura quebrada (CSP bloqueia onerror inline): evento `error` não
  // borbulha — escuta na fase de captura e cai para o chip de tipo.
  panel.querySelector('.queue-panel-body').addEventListener('error', (e) => {
    const img = e.target.closest && e.target.closest('.queue-item-thumb');
    if (!img) return;
    const span = document.createElement('span');
    span.className = 'queue-item-type';
    span.textContent = img.dataset.fallback || 'FILE';
    img.replaceWith(span);
  }, true);
  panel.querySelector('.queue-panel-body').addEventListener('click', (e) => {
    const target = e.target.closest('button');
    if (!target) return;
    const { action, id } = target.dataset;
    if (!action || !id) return;
    if (target.dataset.kind === 'zip') {
      if (action === 'cancel') cancelZipTask(id);
      if (action === 'download-zip') downloadZipResult(id);
      if (action === 'retry-failures') retryZipFailures(id);
      if (action === 'export-text') exportZipReport(id, 'text');
      if (action === 'dismiss') dismissZipTask(id);
      return;
    }
    const ad = getActiveDownloads().get(id);
    if (!ad) return;
    if (action === 'pause') togglePause(ad);
    if (action === 'cancel') cancelDownload(ad);
    if (action === 'dismiss') dismissDownload(ad);
    if (action === 'restart') restartDownload(ad);
    if (action === 'copy') copyDownloadLink(ad);
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

const QUEUE_TYPE_LABELS = { video: 'VIDEO', image: 'IMAGE', audio: 'AUDIO', document: 'DOC', archive: 'ZIP' };

function typeChip(ad) {
  const fallback = QUEUE_TYPE_LABELS[ad.item.type] || (ad.item.ext ? ad.item.ext.toUpperCase() : 'FILE');
  if (ad.item.thumbnail) {
    return `<img class="queue-item-thumb" src="${ad.item.thumbnail}" alt="" loading="lazy" data-fallback="${fallback}" />`;
  }
  return `<span class="queue-item-type">${fallback}</span>`;
}

function zipReportReason(reason) {
  const known = {
    'unsupported hls': 'zip.reason_unsupported_hls',
    'unsupported dash': 'zip.reason_unsupported_dash',
    ZIP_SIZE_LIMIT_EXCEEDED: 'zip.error.size_limit_exceeded',
    ZIP_TEMP_STORAGE_FULL: 'zip.error.temp_storage_full',
    PIXELDRAIN_HOTLINK_PROTECTION: 'zip.reason_pixeldrain_hotlink',
  };
  return known[reason] ? t(known[reason]) : reason;
}

function renderList() {
  const body = panel.querySelector('.queue-panel-body');
  const byTab = classifyDownloads();
  const items = byTab[activeTab];
  updateClearButton(byTab);

  if (items.length === 0) {
    const def = TAB_DEFS.find(d => d.id === activeTab);
    body.innerHTML = `<div class="queue-panel-empty">${t(def.emptyKey)}</div>`;
    return;
  }

  body.innerHTML = items.map(ad => {
    const isZip = ad.kind === 'zip';
    const pct = isZip
      ? Math.round(((ad.processed || 0) / (ad.total || 1)) * 100)
      : ad.totalLength > 0 ? Math.round((ad.receivedLength / ad.totalLength) * 100) : 0;
    const isPaused = ad.paused;
    const isDone = ad._done;
    const isError = ad.state === 'error';
    const isQueued = ad.state === 'queued';
    const isZipReady = isZip && ad.state === 'completed' && !ad.downloaded;
    const hasKnownTotal = ad.totalLengthKnown === true || (ad.totalLengthKnown == null && ad.totalLength > 0);
    const state = isError ? 'error' : isDone ? 'completed' : isZipReady ? 'ready' : isPaused ? 'paused' : ad.state === 'queued' ? 'queued' : 'downloading';
    const progressWidth = isError ? 0 : isDone || isZipReady ? 100 : Math.min(pct, 100);

    const statusLabel =
      isError
        ? { cls: 'queue-status-error', text: t('dl.error') }
        : isDone
          ? { cls: 'queue-status-done', text: t('dl.complete') }
          : isPaused
            ? { cls: 'queue-status-paused', text: t('dl.paused') }
            : { cls: 'queue-status-active', text: isQueued ? t('dl.queued') : t('dl.downloading') };

    if (isZip) {
      statusLabel.text = isError ? t('dl.error')
        : isDone || isZipReady ? t('zip.download_ready')
          : ad.state === 'queued'
            ? (ad.queuePosition > 0 ? t('zip.queued_position', { position: ad.queuePosition }) : t('zip.queued_waiting'))
            : t('zip.progress', { current: ad.processed || 0, total: ad.total || 0 });
    }
    const infoParts = [`<span class="queue-status ${statusLabel.cls}">${statusLabel.text}</span>`];
    if (ad.receivedLength > 0 || hasKnownTotal) {
      infoParts.push(`${formatBytes(ad.receivedLength)}${hasKnownTotal ? ` / ${formatBytes(ad.totalLength)}` : ''}`);
    }
    if (!isDone && !isError && !isZipReady && ad.speed > 0) infoParts.push(formatSpeed(ad.speed));
    if (!isDone && !isError && !isZipReady && ad.totalLength > 0) infoParts.push(`${pct}%`);
    if (!isDone && !isError && ad.attempt) infoParts.push(t('dl.attempt', { attempt: ad.attempt, max: DOWNLOAD_MAX_ATTEMPTS }));
    if (!isDone && !isError && ad.waitingRetry) infoParts.push(t('dl.retry_wait'));
    if ((isDone || isError) && ad.finishedAt) infoParts.push(formatHistoryTime(ad.finishedAt));
    if ((isDone || isError) && ad.item.source) infoParts.push(sanitizeHtml(String(ad.item.source)));
    if (isError && ad.errorMsg) infoParts.push(sanitizeHtml(ad.errorMsg));

    const zipReport = isZip && Array.isArray(ad.report) ? ad.report : [];
    const reportCounts = zipReport.reduce((counts, item) => {
      counts[item.outcome] = (counts[item.outcome] || 0) + 1;
      return counts;
    }, { completed: 0, failed: 0, ignored: 0, pending: 0 });
    const reportHtml = zipReport.length && (isZipReady || isDone || isError)
      ? `<details class="zip-report" ${reportCounts.failed || reportCounts.ignored ? 'open' : ''}>
          <summary>${t('zip.report_summary', {
            completed: reportCounts.completed,
            failed: reportCounts.failed,
            ignored: reportCounts.ignored,
          })}</summary>
          <div class="zip-report-list">
            ${zipReport.map(item => `
              <div class="zip-report-row" data-outcome="${sanitizeHtml(item.outcome)}">
                <span class="zip-report-indicator" aria-hidden="true"></span>
                <span class="zip-report-name" title="${sanitizeHtml(item.name)}">${sanitizeHtml(item.name)}</span>
                <span class="zip-report-outcome">${t(`zip.report_${item.outcome}`)}</span>
                ${item.reason ? `<span class="zip-report-reason">${sanitizeHtml(zipReportReason(item.reason))}</span>` : ''}
              </div>`).join('')}
          </div>
        </details>`
      : '';

    const actionsHtml = isZip
      ? `<div class="queue-item-actions ${isDone || isError ? 'queue-item-history-actions' : ''}">
          <button class="btn btn-secondary btn-sm queue-btn" data-kind="zip" data-action="cancel" data-id="${ad.taskId}">${t('zip.cancel')}</button>
          ${isZipReady ? `<button class="btn btn-primary btn-sm queue-btn" data-kind="zip" data-action="download-zip" data-id="${ad.taskId}">${t('zip.download_btn')}</button>` : ''}
          ${reportCounts.failed ? `<button class="btn btn-secondary btn-sm queue-btn" data-kind="zip" data-action="retry-failures" data-id="${ad.taskId}">${t('zip.retry_failed', { count: reportCounts.failed })}</button>` : ''}
          ${zipReport.length ? `<button class="btn btn-secondary btn-sm queue-btn" data-kind="zip" data-action="export-text" data-id="${ad.taskId}">${t('zip.export_text')}</button>` : ''}
          ${isDone || isError ? `<button class="btn btn-secondary btn-sm queue-btn" data-kind="zip" data-action="dismiss" data-id="${ad.taskId}">${t('queue.remove')}</button>` : ''}
        </div>`
      : !isDone && !isError
      ? `
          <div class="queue-item-actions">
            ${ad.waitingRetry || isQueued ? '' : `<button class="btn btn-secondary btn-sm queue-btn" data-action="pause" data-id="${ad.item.id}" title="${isPaused ? t('dl.resume') : t('dl.pause')}">${isPaused ? t('dl.resume') : t('dl.pause')}</button>`}
            <button class="btn btn-secondary btn-sm queue-btn" data-action="cancel" data-id="${ad.item.id}" title="${t('dl.cancel')}">${t('dl.cancel')}</button>
          </div>`
      : `
          <div class="queue-item-actions queue-item-history-actions">
            <button class="btn btn-primary btn-sm queue-btn" data-action="restart" data-id="${ad.item.id}">${isError ? t('dl.retry') : t('queue.download_again')}</button>
            <button class="btn btn-secondary btn-sm queue-btn" data-action="copy" data-id="${ad.item.id}">${t('actions.copy_link')}</button>
            <button class="btn btn-secondary btn-sm queue-btn" data-action="dismiss" data-id="${ad.item.id}">${t('queue.remove')}</button>
          </div>`;

    return `
      <div class="queue-item ${isDone ? 'queue-item-done' : ''}" data-state="${state}">
        <div class="queue-item-head">
          ${typeChip(ad)}
          <div class="queue-item-head-main">
          <span class="queue-item-name" title="${sanitizeHtml(ad.item.name)}">${sanitizeHtml(ad.item.name)}</span>
            <div class="queue-item-sub">${infoParts.join(' · ')}</div>
          </div>
        </div>
        <div class="progress-bar-container queue-item-progress">
          <div class="progress-bar-fill" style="width:${progressWidth}%"></div>
        </div>
        ${reportHtml}
        ${actionsHtml}
      </div>
    `;
  }).join('');
}

function updateBadge() {
  const count = classifyDownloads().active.length;
  updateFaviconProgress(count, store.state.faviconBadgeEnabled);

  const sub = panel && panel.querySelector('.queue-panel-subtext');
  if (sub) {
    if (count > 0) {
      sub.style.display = '';
      sub.textContent = t(count === 1 ? 'queue.active_one' : 'queue.active_other', { count: String(count) });
    } else {
      sub.style.display = 'none';
      sub.textContent = '';
    }
  }

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
  if (panel) {
    renderTabs();
    renderList();
    renderSummary();
  }
  updateBadge();
}

// O drawer reage ao estado do coordenador de painéis laterais
// (right-panel.js). Abrir/fechar/ESC/click-outside sempre passam por lá;
// este módulo apenas espelha `activeRightPanel` na classe `.open`.
function syncDrawer() {
  if (getActiveRightPanel() === 'downloads') {
    const p = getOrCreatePanel();
    p.classList.add('open');
    activeTab = 'active';
    renderTabs();
    renderList();
    renderSummary();
    updateBadge();
  } else if (panel) {
    panel.classList.remove('open');
  }
}

export function initQueue() {
  setOnChange(onDownloadsChange);
  if (!zipListenerInstalled) {
    zipListenerInstalled = true;
    subscribeZipQueue(onDownloadsChange);
  }
  setOnRightPanelChange(syncDrawer);
  if (!localeListenerInstalled) {
    localeListenerInstalled = true;
    store.subscribe((property) => {
      if (property === 'lang') renderPanelLocale();
      else if (property === 'faviconBadgeEnabled') updateBadge();
    });
  }
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
  cancelActiveDownload(ad);
}

function clearHistoryTab(tab) {
  for (const ad of getActiveDownloads().values()) {
    if (tab === 'completed' && ad._done && ad.state !== 'error') dismissDownload(ad);
    if (tab === 'failed' && ad.state === 'error') dismissDownload(ad);
  }
  for (const task of getZipQueueTasks().values()) {
    if (tab === 'completed' && task.state === 'completed') dismissZipTask(task.taskId);
    if (tab === 'failed' && task.state === 'error') dismissZipTask(task.taskId);
  }
}

function clearCurrentTab() {
  if (activeTab === 'completed' || activeTab === 'failed') clearHistoryTab(activeTab);
}

function updateClearButton(byTab = classifyDownloads()) {
  if (!panel) return;
  const btn = panel.querySelector('.queue-clear-done');
  const visible = activeTab === 'completed' || activeTab === 'failed';
  const key = activeTab === 'failed' ? 'queue.clear_failed' : 'queue.clear_done';
  btn.textContent = t(key);
  btn.title = t(key);
  btn.style.display = visible && byTab[activeTab].length > 0 ? '' : 'none';
}

function formatHistoryTime(timestamp) {
  try {
    return new Intl.DateTimeFormat(store.state.lang === 'en' ? 'en-US' : 'pt-BR', {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).format(new Date(timestamp));
  } catch { return ''; }
}

async function copyDownloadLink(ad) {
  const link = ad?.item?.url || ad?.item?.proxyUrl;
  if (!link) return;
  try {
    await navigator.clipboard.writeText(link);
    Toast.show(t('toast.copied'), 'success');
  } catch {
    Toast.show(t('toast.copy_failed'), 'error');
  }
}
