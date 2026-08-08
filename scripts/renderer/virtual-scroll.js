import { store } from '../state.js';
import { buildCardHtml } from './cards.js';
import { attachCardEvents } from './events.js';
import { restoreDownloadState } from '../downloader.js';

// Virtual scroll state
export const vs = {
  active: false,
  container: null,
  wrapper: null,
  items: [],
  viewMode: 'grid',
  columns: 4,
  gap: 20,
  cardWidth: 280,
  cardHeight: 340,
  totalHeight: 0,
  visibleStart: 0,
  visibleEnd: 0,
  lastScrollTop: 0,
  rafId: null,
  selectedItemIds: new Set(),
};

export function vsCleanup() {
  if (!vs.active) return;
  vs.active = false;
  if (vs.container) {
    vs.container.removeEventListener('scroll', vsOnScroll);
    vs.container.style.maxHeight = '';
  }
  window.removeEventListener('resize', vsOnResize);
  if (vs.rafId) { cancelAnimationFrame(vs.rafId); vs.rafId = null; }
  vs.container = null;
  vs.wrapper = null;
}

export function vsInit(container, items) {
  const viewMode = store.state.viewMode;
  vs.active = true;
  vs.container = container;
  vs.items = items;
  vs.viewMode = viewMode;
  vs.selectedItemIds = new Set(store.state.selectedItemIds);

  container.classList.remove('grid-view', 'list-view', 'compact-view');
  container.classList.add('virtual-scroll');

  const top = container.getBoundingClientRect().top;
  container.style.maxHeight = `calc(100vh - ${top + 24}px)`;

  vs.wrapper = document.createElement('div');
  vs.wrapper.className = 'vs-wrapper';
  container.innerHTML = '';
  container.appendChild(vs.wrapper);

  vsMeasure();
  vsRender();
  attachCardEvents(vs.wrapper, true);

  container.addEventListener('scroll', vsOnScroll, { passive: true });
  window.addEventListener('resize', vsOnResize, { passive: true });
}

function vsMeasure() {
  const w = vs.container.clientWidth;
  const gap = vs.viewMode === 'compact' ? 12 : vs.viewMode === 'list' ? 12 : 20;
  vs.gap = gap;

  if (vs.viewMode === 'list') {
    vs.columns = 1;
    vs.cardWidth = w;
    vs.cardHeight = 88;
  } else if (vs.viewMode === 'compact') {
    const minW = 180;
    vs.columns = Math.max(1, Math.floor((w + gap) / (minW + gap)));
    vs.cardWidth = Math.floor((w - (vs.columns - 1) * gap) / vs.columns);
    vs.cardHeight = 240;
  } else {
    const minW = 280;
    vs.columns = Math.max(1, Math.floor((w + gap) / (minW + gap)));
    vs.cardWidth = Math.floor((w - (vs.columns - 1) * gap) / vs.columns);
    vs.cardHeight = 360;
  }

  const totalRows = Math.ceil(vs.items.length / vs.columns);
  vs.totalHeight = totalRows * vs.cardHeight + (totalRows - 1) * gap;
  vs.wrapper.style.height = `${vs.totalHeight}px`;
}

function vsOnScroll() {
  if (vs.rafId) return;
  vs.rafId = requestAnimationFrame(() => {
    vs.rafId = null;
    vsRender();
  });
}

function vsOnResize() {
  vsMeasure();
  vsRender();
}

function vsRender() {
  if (!vs.active || !vs.container) return;

  const scrollTop = vs.container.scrollTop;
  const viewH = vs.container.clientHeight;
  const rowH = vs.cardHeight + vs.gap;

  const startRow = Math.max(0, Math.floor(scrollTop / rowH) - 2);
  const visibleRows = Math.ceil(viewH / rowH) + 4;
  const totalRows = Math.ceil(vs.items.length / vs.columns);
  const endRow = Math.min(totalRows, startRow + visibleRows);

  const startIdx = startRow * vs.columns;
  const endIdx = Math.min(vs.items.length, endRow * vs.columns);

  // Remove cards outside visible range
  const existingCards = vs.wrapper.querySelectorAll('.media-card');
  existingCards.forEach(card => {
    const id = card.getAttribute('data-id');
    const idx = vs.items.findIndex(i => i.id === id);
    if (idx < startIdx || idx >= endIdx) card.remove();
  });

  // Track already-rendered IDs
  const renderedIds = new Set();
  vs.wrapper.querySelectorAll('.media-card').forEach(c => renderedIds.add(c.getAttribute('data-id')));

  for (let i = startIdx; i < endIdx; i++) {
    const item = vs.items[i];
    if (!item || renderedIds.has(item.id)) continue;

    const row = Math.floor(i / vs.columns);
    const col = i % vs.columns;
    const left = col * (vs.cardWidth + vs.gap);
    const top = row * (vs.cardHeight + vs.gap);

    const cardHtml = buildCardHtml(item, vs.selectedItemIds.has(item.id));
    vs.wrapper.insertAdjacentHTML('beforeend', cardHtml);
    const card = vs.wrapper.lastElementChild;
    card.style.position = 'absolute';
    card.style.width = `${vs.cardWidth}px`;
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    card.style.margin = '0';
    card.style.transition = 'none';
    card.style.animation = 'none';

    // Card recriado nasce idle — se o item ainda está baixando,
    // restaura o estado visual real (download/paused/error/...).
    restoreDownloadState(item, card);
  }

  // Apply blur
  vs.container.classList.toggle('thumb-blurred', store.state.thumbBlurred);
}