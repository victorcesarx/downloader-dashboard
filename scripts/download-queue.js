import { getActiveDownloads, setOnChange, dismissDownload } from './downloader.js';
import { formatBytes, formatSpeed } from './utils.js';
import { t } from './i18n.js';

let panel = null;
let badge = null;
let isOpen = false;

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
  for (const ad of getActiveDownloads().values()) {
    const failed = ad.state === 'error';
    const done = ad._done && !failed;
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

// Drawer: fechar ao clicar fora do painel ou pressionar ESC.
// Clicks programáticos (ex.: a.click() do download no downloader.js)
// são `isTrusted: false` e não devem fechar a fila.
document.addEventListener('click', (e) => {
  if (!isOpen || !e.isTrusted) return;
  if (panel && !panel.contains(e.target) && !(e.target.closest && e.target.closest('#queue-toggle-btn'))) {
    closeQueue();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isOpen) closeQueue();
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
        <button class="btn btn-secondary btn-sm queue-clear-done" title="${t('queue.clear_done')}" style="display:none;">${t('queue.clear_done')}</button>
        <button class="queue-panel-close btn btn-icon" aria-label="${t('actions.close')}" title="${t('actions.close')}">&times;</button>
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

  panel.querySelector('.queue-panel-close').addEventListener('click', toggleQueue);
  panel.querySelector('.queue-clear-done').addEventListener('click', clearCompleted);
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

const QUEUE_TYPE_LABELS = { video: 'VIDEO', image: 'IMAGE', audio: 'AUDIO', document: 'DOC' };

function typeChip(ad) {
  const fallback = QUEUE_TYPE_LABELS[ad.item.type] || (ad.item.ext ? ad.item.ext.toUpperCase() : 'FILE');
  if (ad.item.thumbnail) {
    return `<img class="queue-item-thumb" src="${ad.item.thumbnail}" alt="" loading="lazy" data-fallback="${fallback}" />`;
  }
  return `<span class="queue-item-type">${fallback}</span>`;
}

function renderList() {
  const body = panel.querySelector('.queue-panel-body');
  const byTab = classifyDownloads();
  const items = byTab[activeTab];
  const hasDone = byTab.completed.length > 0;
  const clearBtn = panel.querySelector('.queue-clear-done');
  clearBtn.style.display = hasDone ? '' : 'none';

  if (items.length === 0) {
    const def = TAB_DEFS.find(d => d.id === activeTab);
    body.innerHTML = `<div class="queue-panel-empty">${t(def.emptyKey)}</div>`;
    return;
  }

  body.innerHTML = items.map(ad => {
    const pct = ad.totalLength > 0 ? Math.round((ad.receivedLength / ad.totalLength) * 100) : 0;
    const isPaused = ad.paused;
    const isDone = ad._done;
    const isError = ad.state === 'error';
    const state = isError ? 'error' : isDone ? 'completed' : isPaused ? 'paused' : 'downloading';
    const progressWidth = isError ? 0 : isDone ? 100 : Math.min(pct, 100);

    const statusLabel =
      isError
        ? { cls: 'queue-status-error', text: t('dl.error') }
        : isDone
          ? { cls: 'queue-status-done', text: t('dl.complete') }
          : isPaused
            ? { cls: 'queue-status-paused', text: t('dl.paused') }
            : { cls: 'queue-status-active', text: t('dl.downloading') };

    const infoParts = [`<span class="queue-status ${statusLabel.cls}">${statusLabel.text}</span>`];
    if (ad.receivedLength > 0 || ad.totalLength > 0) {
      infoParts.push(`${formatBytes(ad.receivedLength)}${ad.totalLength > 0 ? ` / ${formatBytes(ad.totalLength)}` : ''}`);
    }
    if (!isDone && !isError && ad.speed > 0) infoParts.push(formatSpeed(ad.speed));
    if (!isDone && !isError && ad.totalLength > 0) infoParts.push(`${pct}%`);

    const actionsHtml = !isDone && !isError
      ? `
          <div class="queue-item-actions">
            <button class="btn btn-secondary btn-sm queue-btn" data-action="pause" data-id="${ad.item.id}" title="${isPaused ? t('dl.resume') : t('dl.pause')}">${isPaused ? t('dl.resume') : t('dl.pause')}</button>
            <button class="btn btn-secondary btn-sm queue-btn" data-action="cancel" data-id="${ad.item.id}" title="${t('dl.cancel')}">${t('dl.cancel')}</button>
          </div>`
      : `
          <div class="queue-item-dismiss">
            <button class="btn btn-secondary btn-sm queue-btn" data-action="dismiss" data-id="${ad.item.id}" title="${t('actions.close')}">${t('actions.close')}</button>
          </div>`;

    return `
      <div class="queue-item ${isDone ? 'queue-item-done' : ''}" data-state="${state}">
        <div class="queue-item-head">
          ${typeChip(ad)}
          <div class="queue-item-head-main">
            <span class="queue-item-name" title="${ad.item.name}">${ad.item.name}</span>
            <div class="queue-item-sub">${infoParts.join(' · ')}</div>
          </div>
        </div>
        <div class="progress-bar-container queue-item-progress">
          <div class="progress-bar-fill" style="width:${progressWidth}%"></div>
        </div>
        ${actionsHtml}
      </div>
    `;
  }).join('');
}

function updateBadge() {
  const downloads = [...getActiveDownloads().values()];
  const count = downloads.filter(ad => !ad._done).length;

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

export function toggleQueue() {
  isOpen = !isOpen;
  const p = getOrCreatePanel();
  p.classList.toggle('open', isOpen);
  if (isOpen) {
    activeTab = 'active';
    renderTabs();
    renderList();
    renderSummary();
    updateBadge();
  }
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
