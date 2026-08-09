import { sanitizeHtml } from './utils.js';
import { t } from './i18n.js';
import { store } from './state.js';
import { closeRightPanel, getActiveRightPanel, openRightPanel, setOnRightPanelChange } from './right-panel.js';
import { formatMediaSize } from './media-size.js';
import { downloadSingleItem } from './download.js';
import { openPreviewModal } from './renderer/modal.js';
import { updateAllCardSelections, updateBatchActionsUI } from './renderer/batch.js';
import { Toast } from './utils.js';
import { closeIconSvg } from './icons.js';

let panel = null;
let currentItem = null;
let initialized = false;
let probeState = { loading: false, error: null, metadata: null };

function valueOrFallback(value) {
  return value !== null && value !== undefined && value !== ''
    ? sanitizeHtml(String(value))
    : t('common.na');
}

function durationLabel(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return t('common.na');
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const parts = hours > 0 ? [hours, minutes, secs] : [minutes, secs];
  return parts.map(n => String(n).padStart(2, '0')).join(':');
}

function aspectRatio(item) {
  if (!Number.isFinite(item.width) || !Number.isFinite(item.height) || item.height <= 0) return null;
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  const divisor = gcd(Math.round(item.width), Math.round(item.height));
  return `${Math.round(item.width) / divisor}:${Math.round(item.height) / divisor}`;
}

function variantLabel(item) {
  return [item.quality, item.width && item.height ? `${item.width}×${item.height}` : null, formatMediaSize(item.size)]
    .filter(Boolean).join(' · ') || item.name;
}

function metadataJson(item) {
  const ratio = aspectRatio(item);
  return {
    id: item.id, name: item.name, type: item.type, mimeType: item.mimeType || null,
    extension: item.extension || item.ext || null, size: Number.isFinite(item.size) ? item.size : null,
    width: item.width ?? null, height: item.height ?? null, aspectRatio: ratio,
    duration: item.duration ?? null, container: item.container ?? null,
    quality: item.quality ?? null, delivery: item.delivery ?? null, source: item.source ?? null,
    url: item.url, probe: probeState.metadata,
  };
}

function probeBrowserMetadata(item) {
  if (!['video', 'audio'].includes(item.type) || !item.proxyUrl) return Promise.resolve({});
  return new Promise(resolve => {
    const media = document.createElement(item.type);
    const finish = data => { media.removeAttribute('src'); media.load?.(); resolve(data); };
    const timer = window.setTimeout(() => finish({}), 6000);
    media.preload = 'metadata';
    media.onloadedmetadata = () => {
      window.clearTimeout(timer);
      finish({
        duration: Number.isFinite(media.duration) ? media.duration : null,
        width: item.type === 'video' && media.videoWidth ? media.videoWidth : null,
        height: item.type === 'video' && media.videoHeight ? media.videoHeight : null,
      });
    };
    media.onerror = () => { window.clearTimeout(timer); finish({}); };
    media.src = item.proxyUrl;
  });
}

function replaceCurrentItem(patch) {
  const updated = { ...currentItem, ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== null && value !== undefined)) };
  currentItem = updated;
  const index = store.state.items.findIndex(item => String(item.id) === String(updated.id));
  if (index >= 0) {
    const items = [...store.state.items];
    items[index] = updated;
    store.state.items = items;
  } else render();
}

function detailRow(label, value, stacked = false) {
  return `<div class="inspector-detail-row${stacked ? ' inspector-detail-row--stacked' : ''}"><dt>${label}</dt><dd>${value}</dd></div>`;
}

function translatedType(item) {
  if (item.mimeType) return valueOrFallback(item.mimeType);
  const key = `inspector.type_${item.type}`;
  const translated = t(key);
  return translated === key ? valueOrFallback(item.type) : translated;
}

function translatedDelivery(delivery) {
  if (!delivery) return t('common.na');
  const key = `badge.${delivery}`;
  const translated = t(key);
  return translated === key ? valueOrFallback(delivery) : translated;
}

function isSameAsResolution(quality, item) {
  if (!quality || !item.width || !item.height) return false;
  const normalized = String(quality).toLowerCase().replace(/\s|×/g, 'x');
  return normalized === `${item.width}x${item.height}`;
}

function previewHtml(item) {
  const src = item.type === 'image' ? item.proxyUrl : item.thumbnail;
  if (src) return `<img class="inspector-preview-image" src="${sanitizeHtml(src)}" alt="${sanitizeHtml(item.name)}">`;
  const icons = { video: '🎥', image: '🖼️', audio: '🎵', document: '📄' };
  return `<div class="inspector-preview-placeholder" aria-hidden="true">${icons[item.type] || '📄'}</div>`;
}

function render() {
  if (!panel || !currentItem) return;
  const item = currentItem;
  const ratio = aspectRatio(item);
  const variants = item.variantGroupKey
    ? store.state.items.filter(candidate => candidate.variantGroupKey === item.variantGroupKey)
    : [];
  const isSelected = store.state.selectedItemIds.has(item.id);
  const resolution = item.width || item.height
    ? `${valueOrFallback(item.width)} × ${valueOrFallback(item.height)} px`
    : t('common.na');
  const confidence = Number.isFinite(item.confidenceScore) ? `${Math.round(item.confidenceScore)}%` : t('common.na');
  const hasReasons = Array.isArray(item.confidenceReasons) && item.confidenceReasons.length > 0;
  const hasSourceData = Boolean(item.source) || Number.isFinite(item.confidenceScore) || hasReasons;
  const reasons = hasReasons
    ? `<ul class="inspector-reasons">${item.confidenceReasons.map(reason => `<li>${sanitizeHtml(reason)}</li>`).join('')}</ul>`
    : `<span class="inspector-muted">${t('common.na')}</span>`;
  const qualityRow = isSameAsResolution(item.quality, item)
    ? ''
    : detailRow(t('inspector.quality'), valueOrFallback(item.quality));
  const sourceSection = hasSourceData
    ? `<section class="inspector-section" aria-labelledby="inspector-source-heading">
        <h5 id="inspector-source-heading">${t('inspector.source_details')}</h5><dl>
          ${item.source ? detailRow(t('inspector.source'), valueOrFallback(item.source)) : ''}
          ${Number.isFinite(item.confidenceScore) ? detailRow(t('inspector.confidence'), confidence) : ''}
        </dl>
        ${hasReasons ? `<div class="inspector-reasons-block"><span>${t('inspector.confidence_reasons')}</span>${reasons}</div>` : ''}
      </section>`
    : `<section class="inspector-section inspector-empty-section" aria-labelledby="inspector-source-heading">
        <h5 id="inspector-source-heading">${t('inspector.source_details')}</h5>
        <p>${t('inspector.source_unavailable')}</p>
      </section>`;

  panel.innerHTML = `
    <header class="queue-panel-header inspector-header">
      <div class="queue-panel-heading"><h4 id="media-inspector-title">${t('inspector.title')}</h4><span class="queue-panel-subtext">${sanitizeHtml(item.name)}</span></div>
      <button class="queue-panel-close icon-close-btn inspector-close" type="button" aria-label="${t('actions.close')}" title="${t('actions.close')}">${closeIconSvg()}</button>
    </header>
    <div class="inspector-body">
      <div class="inspector-preview">${previewHtml(item)}</div>
      <div class="inspector-title-block"><strong title="${sanitizeHtml(item.name)}">${sanitizeHtml(item.name)}</strong><span>${valueOrFallback(item.label || item.type)} · ${valueOrFallback(item.extension || item.ext).toUpperCase()}</span></div>
      <div class="inspector-actions">
        <button class="btn btn-secondary btn-sm inspector-preview-btn" type="button">${t('actions.preview')}</button>
        <button class="btn btn-secondary btn-sm inspector-select-btn" type="button">${isSelected ? t('actions.deselect') : t('actions.select')}</button>
        <button class="btn btn-primary btn-sm inspector-download-btn" type="button">${t('actions.download')}</button>
      </div>
      ${variants.length > 1 ? `<section class="inspector-section inspector-variants" aria-labelledby="inspector-variants-heading">
        <h5 id="inspector-variants-heading">${t('inspector.variants')}</h5>
        <select class="inspector-variant-select" aria-label="${t('actions.select_variant')}">${variants.map(variant => `<option value="${sanitizeHtml(variant.id)}" ${String(variant.id) === String(item.id) ? 'selected' : ''}>${sanitizeHtml(variantLabel(variant))}</option>`).join('')}</select>
      </section>` : ''}
      <section class="inspector-section" aria-labelledby="inspector-file-heading">
        <div class="inspector-section-heading"><h5 id="inspector-file-heading">${t('inspector.file_details')}</h5><button class="btn btn-secondary btn-sm inspector-refresh" type="button" ${probeState.loading ? 'disabled' : ''}>${probeState.loading ? t('inspector.probing') : t('inspector.refresh')}</button></div><dl>
          ${detailRow(t('inspector.type'), translatedType(item))}
          ${detailRow(t('inspector.size'), formatMediaSize(item.size))}
          ${detailRow(t('inspector.resolution'), resolution)}
          ${detailRow(t('inspector.aspect_ratio'), valueOrFallback(ratio))}
          ${detailRow(t('inspector.duration'), durationLabel(item.duration))}
          ${detailRow(t('inspector.container'), valueOrFallback(item.container))}
          ${qualityRow}
          ${detailRow(t('inspector.delivery'), translatedDelivery(item.delivery))}
        </dl>
        ${probeState.error ? `<p class="inspector-probe-error">${sanitizeHtml(probeState.error)}</p>` : ''}
      </section>
      ${sourceSection}
      <section class="inspector-section inspector-url-section" aria-labelledby="inspector-url-heading">
        <div class="inspector-section-heading">
          <h5 id="inspector-url-heading">${t('inspector.url')}</h5>
          <button class="btn btn-secondary btn-sm inspector-url-copy" type="button" aria-label="${t('actions.copy_link')}" title="${t('actions.copy_link')}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
        </div>
        <code class="inspector-url" title="${sanitizeHtml(item.url)}">${sanitizeHtml(item.url)}</code>
        <div class="inspector-data-actions"><button class="btn btn-secondary btn-sm inspector-copy" type="button">${t('actions.copy_link')}</button><button class="btn btn-secondary btn-sm inspector-copy-json" type="button">${t('inspector.copy_json')}</button><a class="btn btn-secondary btn-sm inspector-open" href="${sanitizeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${t('actions.open_original')}</a></div>
      </section>
    </div>`;

  panel.querySelector('.inspector-close').addEventListener('click', closeRightPanel);
  const copyUrl = async button => {
    try {
      await navigator.clipboard.writeText(item.url);
      if (button.classList.contains('inspector-copy')) {
        button.textContent = t('inspector.copied');
        window.setTimeout(() => { if (button.isConnected) button.textContent = t('actions.copy_link'); }, 1200);
      }
    } catch { /* Clipboard indisponível: nenhuma navegação destrutiva. */ }
  };
  panel.querySelector('.inspector-copy').addEventListener('click', event => copyUrl(event.currentTarget));
  panel.querySelector('.inspector-url-copy').addEventListener('click', event => copyUrl(event.currentTarget));
  panel.querySelector('.inspector-copy-json').addEventListener('click', async event => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(metadataJson(item), null, 2));
      event.currentTarget.textContent = t('inspector.copied');
    } catch { Toast.show(t('toast.copy_failed'), 'error'); }
  });
  panel.querySelector('.inspector-preview-btn').addEventListener('click', () => item.openInBrowser ? window.open(item.url, '_blank') : openPreviewModal(item));
  panel.querySelector('.inspector-download-btn').addEventListener('click', () => {
    if (item.delivery === 'hls' || item.delivery === 'dash') Toast.show(t('toast.streaming_unsupported'), 'warning');
    else if (item.openInBrowser) window.open(item.url, '_blank');
    else downloadSingleItem(item, null);
  });
  panel.querySelector('.inspector-select-btn').addEventListener('click', () => {
    const next = new Set(store.state.selectedItemIds);
    if (next.has(item.id)) next.delete(item.id);
    else {
      if (item.variantGroupKey) store.state.items.forEach(candidate => { if (candidate.variantGroupKey === item.variantGroupKey) next.delete(candidate.id); });
      next.add(item.id);
    }
    store.state.selectedItemIds = next;
    updateAllCardSelections();
    updateBatchActionsUI();
    render();
  });
  panel.querySelector('.inspector-variant-select')?.addEventListener('change', event => {
    const target = store.state.items.find(candidate => String(candidate.id) === event.target.value);
    if (!target) return;
    currentItem = target;
    probeState = { loading: false, error: null, metadata: null };
    render();
  });
  panel.querySelector('.inspector-refresh').addEventListener('click', async () => {
    probeState = { loading: true, error: null, metadata: probeState.metadata };
    render();
    try {
      const [response, browserMetadata] = await Promise.all([
        fetch(`/media-metadata?url=${encodeURIComponent(item.url)}`),
        probeBrowserMetadata(item),
      ]);
      const metadata = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(metadata.error || t('inspector.probe_failed'));
      probeState = { loading: false, error: null, metadata };
      replaceCurrentItem({
        size: metadata.size, mimeType: metadata.mimeType, container: metadata.container,
        duration: browserMetadata.duration ?? metadata.duration,
        width: browserMetadata.width ?? metadata.width,
        height: browserMetadata.height ?? metadata.height,
      });
    } catch (error) {
      probeState = { loading: false, error: error.message || t('inspector.probe_failed'), metadata: probeState.metadata };
      render();
    }
  });
}

function getOrCreatePanel() {
  if (panel?.isConnected) return panel;
  panel = document.createElement('aside');
  panel.id = 'media-inspector-panel';
  panel.className = 'media-inspector-panel';
  panel.setAttribute('aria-labelledby', 'media-inspector-title');
  panel.setAttribute('aria-hidden', 'true');
  document.body.appendChild(panel);
  return panel;
}

function syncInspector() {
  const isOpen = getActiveRightPanel() === 'inspector' && currentItem;
  if (isOpen) {
    const el = getOrCreatePanel();
    render();
    el.classList.add('open');
    el.setAttribute('aria-hidden', 'false');
  } else if (panel) {
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
  }
}

export function openMediaInspector(item) {
  if (!item) return;
  const isSameItemOpen = getActiveRightPanel() === 'inspector'
    && currentItem
    && String(currentItem.id) === String(item.id);
  if (isSameItemOpen) {
    closeRightPanel();
    return;
  }
  currentItem = item;
  probeState = { loading: false, error: null, metadata: null };
  getOrCreatePanel();
  if (getActiveRightPanel() === 'inspector') render();
  else openRightPanel('inspector');
}

export function isInspectorOutsideClick(event, inspectorPanel = panel) {
  if (!inspectorPanel) return true;
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  const startedInsidePanel = path.includes(inspectorPanel);
  return !startedInsidePanel
    && !inspectorPanel.contains(event.target)
    && !event.target.closest?.('.inspect-btn');
}

export function initMediaInspector() {
  if (initialized) return;
  initialized = true;
  setOnRightPanelChange(syncInspector);
  store.subscribe((property) => {
    if (property === 'lang' && getActiveRightPanel() === 'inspector' && currentItem) render();
    if (property === 'items' && currentItem) {
      const updated = store.state.items.find(item => String(item.id) === String(currentItem.id));
      if (updated) currentItem = updated;
      if (updated && getActiveRightPanel() === 'inspector') render();
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && getActiveRightPanel() === 'inspector') closeRightPanel();
  });
  document.addEventListener('click', event => {
    if (getActiveRightPanel() !== 'inspector' || !event.isTrusted) return;
    if (isInspectorOutsideClick(event)) closeRightPanel();
  });
}
