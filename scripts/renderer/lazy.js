import { store } from '../state.js';
import { formatBytes } from '../utils.js';
import { buildCardHtml } from './cards.js';
import { updateBatchActionsUI } from './batch.js';

const BATCH_SIZE = 20;

let renderedCount = 0;
let currentFiltered = [];
let lazyObserver = null;

export function setFilteredItems(items) {
  currentFiltered = items;
}

export function resetLazyState() {
  renderedCount = 0;
  if (lazyObserver) {
    lazyObserver.disconnect();
    lazyObserver = null;
  }
}

export function appendBatch(container) {
  const { selectedItemIds } = store.state;
  const end = Math.min(renderedCount + BATCH_SIZE, currentFiltered.length);
  let html = '';
  for (let i = renderedCount; i < end; i++) {
    const item = currentFiltered[i];
    html += buildCardHtml(item, selectedItemIds.has(item.id));
  }
  container.insertAdjacentHTML('beforeend', html);
  renderedCount = end;
}

export function observeSentinel(container) {
  if (lazyObserver) lazyObserver.disconnect();

  if (renderedCount >= currentFiltered.length) return;

  const sentinel = document.createElement('div');
  sentinel.id = 'lazy-sentinel';
  sentinel.style.height = '1px';
  container.appendChild(sentinel);

  lazyObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
      appendBatch(container);
      lazyObserver.disconnect();
      sentinel.remove();
      observeSentinel(container);
    }
  }, { rootMargin: '200px' });

  lazyObserver.observe(sentinel);
}

export function lazySizeFetch(container) {
  const { items } = store.state;
  items.forEach(item => {
    if (Number.isFinite(item.size) && item.size >= 0) return;
    const card = container.querySelector(`.media-card[data-id="${item.id}"]`);
    const sizeEl = card?.querySelector('.card-meta span:last-of-type');
    if (!sizeEl) return;
    const url = item.proxyUrl || item.url;
    if (!url) return;
    fetch(url, { headers: { Range: 'bytes=0-0' } }).then(r => {
      const cr = r.headers.get('content-range');
      let s = 0;
      if (cr) {
        const m = cr.match(/\/(\d+)$/);
        if (m) s = parseInt(m[1], 10);
      }
      if (!s) {
        const cl = r.headers.get('content-length');
        if (cl) s = parseInt(cl, 10);
      }
      if (s) {
        const items = store.state.items;
        const idx = items.indexOf(item);
        if (idx !== -1) {
          const updated = structuredClone(item);
          updated.size = s;
          const newItems = [...items];
          newItems[idx] = updated;
          store.state.items = newItems;
          updateBatchActionsUI();
        }
        sizeEl.textContent = formatBytes(s);
      }
    }).catch(() => {});
  });
}
