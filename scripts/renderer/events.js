import { store } from '../state.js';
import { Toast } from '../utils.js';
import { formatMediaSize } from '../media-size.js';
import { t } from '../i18n.js';
import { downloadSingleItem } from '../download.js';
import { openPreviewModal } from './modal.js';
import { updateBatchActionsUI, updateCardSize } from './batch.js';
import { renderMediaContainer } from './index.js';
import { TYPE_ICON_MAP } from './cards.js';
import { openMediaInspector } from '../media-inspector.js';

// Imagem quebrada (CSP bloqueia `onerror` inline): evento `error` não
// borbulha — escuta na fase de captura e troca pela thumbnail por um
// placeholder de ícone, mesmo em re-renders (lazy/virtual).
function attachImageErrorFallback(container) {
  container.addEventListener('error', (e) => {
    const img = e.target.closest?.('.card-media-img');
    if (!img) return;
    const card = img.closest('.media-card');
    const item = card
      ? store.state.items.find(i => String(i.id) === card.dataset.id)
      : undefined;
    const icon = (item && TYPE_ICON_MAP[item.type]) || '📄';
    const preview = img.closest('.card-media-preview');
    if (preview) preview.innerHTML = `<div class="media-placeholder-icon">${icon}</div>`;
  }, true);
}

export function attachCardEvents(container, useDelegation = false) {
  if (!container.__wsImgErrorBound) {
    container.__wsImgErrorBound = true;
    attachImageErrorFallback(container);
  }
  if (useDelegation) {
    if (container.__wsCardEventsBound) return;
    container.__wsCardEventsBound = true;
    container.addEventListener('change', (e) => {
      const cb = e.target.closest('.card-checkbox');
      const sel = e.target.closest('.quality-select');
      const vsel = e.target.closest('.variant-select');
      if (cb) handleCheckboxChange(cb);
      if (sel) handleQualityChange(sel);
      if (vsel) handleVariantChange(vsel);
    });
    container.addEventListener('click', (e) => {
      const db = e.target.closest('.download-btn');
      const pb = e.target.closest('.preview-btn');
      const cb = e.target.closest('.copy-link-btn');
      const ib = e.target.closest('.inspect-btn');
      if (db) handleDownloadClick(db);
      if (pb) handlePreviewClick(pb);
      if (cb) handleCopyClick(cb);
      if (ib) handleInspectClick(ib);
    });
    return;
  }

  container.querySelectorAll('.card-checkbox').forEach(cb => {
    cb.addEventListener('change', () => handleCheckboxChange(cb));
  });
  container.querySelectorAll('.download-btn').forEach(btn => {
    btn.addEventListener('click', () => handleDownloadClick(btn));
  });
  container.querySelectorAll('.quality-select').forEach(sel => {
    sel.addEventListener('change', () => handleQualityChange(sel));
  });
  container.querySelectorAll('.variant-select').forEach(sel => {
    sel.addEventListener('change', () => handleVariantChange(sel));
  });
  container.querySelectorAll('.preview-btn').forEach(btn => {
    btn.addEventListener('click', () => handlePreviewClick(btn));
  });
  container.querySelectorAll('.copy-link-btn').forEach(btn => {
    btn.addEventListener('click', () => handleCopyClick(btn));
  });
  container.querySelectorAll('.inspect-btn').forEach(btn => {
    btn.addEventListener('click', () => handleInspectClick(btn));
  });
}

function handleInspectClick(btn) {
  const id = btn.getAttribute('data-id');
  const item = store.state.items.find(i => i.id === id);
  if (item) openMediaInspector(item);
}

function handleCheckboxChange(cb) {
  const id = cb.getAttribute('data-id');
  const item = store.state.items.find(i => i.id === id);
  const next = new Set(store.state.selectedItemIds);
  if (cb.checked) {
    // Exclusividade por grupo: marcar um item desmarca os demais do grupo.
    if (item && item.variantGroupKey) {
      store.state.items.forEach(i => {
        if (i.variantGroupKey === item.variantGroupKey) next.delete(i.id);
      });
    }
    next.add(id);
  } else {
    next.delete(id);
  }
  store.state.selectedItemIds = next;
  const card = cb.closest('.media-card');
  if (card) card.classList.toggle('selected', cb.checked);
  updateBatchActionsUI();
}

// Troca a variante selecionada do grupo: marca o item alvo e desmarca as
// demais variantes do mesmo grupo (mantém uma única seleção por grupo). O card
// colapsado é re-renderizado para exibir a nova variante.
function handleVariantChange(sel) {
  const url = sel.value;
  if (!url) return;
  const key = sel.getAttribute('data-key');
  const target = store.state.items.find(i => i.variantGroupKey === key && i.url === url);
  if (!target) return;
  const next = new Set(store.state.selectedItemIds);
  store.state.items.forEach(i => {
    if (i.variantGroupKey === key) next.delete(i.id);
  });
  next.add(target.id);
  store.state.selectedItemIds = next;
  updateBatchActionsUI();
  renderMediaContainer();
}

function handleDownloadClick(btn) {
  const id = btn.getAttribute('data-id');
  const item = store.state.items.find(i => i.id === id);
  const cardEl = btn.closest('.media-card');
  if (!item) return;
  // HLS/DASH ainda não são suportados para download direto: o item continua
  // visível/selecionável, mas a ação é bloqueada com um aviso.
  if (item.delivery === 'hls' || item.delivery === 'dash') {
    Toast.show(t('toast.streaming_unsupported'), 'warning');
    return;
  }
  if (item.openInBrowser) window.open(item.url, '_blank');
  else downloadSingleItem(item, cardEl);
}

function handlePreviewClick(btn) {
  const id = btn.getAttribute('data-id');
  const item = store.state.items.find(i => i.id === id);
  if (item) {
    if (item.openInBrowser) window.open(item.url, '_blank');
    else openPreviewModal(item);
  }
}

async function handleCopyClick(btn) {
  const id = btn.getAttribute('data-id');
  const item = store.state.items.find(i => i.id === id);
  if (!item || !item.url) return;
  try {
    await navigator.clipboard.writeText(item.url);
    Toast.show(t('toast.copied'), 'success');
  } catch {
    Toast.show(t('toast.copy_failed'), 'error');
  }
}

function handleQualityChange(sel) {
  const id = sel.getAttribute('data-id');
  const items = store.state.items;
  const idx = items.findIndex(i => i.id === id);
  if (idx === -1) return;
  const item = items[idx];
  if (!item || !item.qualities) return;
  const qIdx = parseInt(sel.value, 10);
  const q = item.qualities[qIdx];
  if (!q) return;
  const updated = structuredClone(item);
  updated.selectedQualityIndex = qIdx;
  updated.url = q.url;
  updated.proxyUrl = q.proxyUrl;
  if (Number.isFinite(q.size) && q.size >= 0) {
    updated.size = q.size;
  } else {
    updated.size = null;
    fetch(q.proxyUrl, { headers: { Range: 'bytes=0-0' } }).then(r => {
      const cr = r.headers.get('content-range');
      if (cr) {
        const m = cr.match(/(\d+)$/);
        if (m) {
          const items2 = store.state.items;
          const idx2 = items2.findIndex(i => i.id === id);
          if (idx2 !== -1) {
            const updated2 = structuredClone(items2[idx2]);
            updated2.size = parseInt(m[1], 10);
            const newItems2 = [...items2];
            newItems2[idx2] = updated2;
            store.state.items = newItems2;
            updateBatchActionsUI();
          }
          updateCardSize(id, parseInt(m[1], 10));
        }
      }
    }).catch(() => {});
  }
  const newItems = [...items];
  newItems[idx] = updated;
  store.state.items = newItems;
  const card = document.querySelector(`.media-card[data-id="${id}"]`);
  const sizeEl = card?.querySelector('.card-meta span:last-of-type');
  if (sizeEl) sizeEl.textContent = formatMediaSize(updated.size);
  updateBatchActionsUI();
}
