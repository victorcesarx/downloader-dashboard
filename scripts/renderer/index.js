import { store } from '../state.js';
import { t } from '../i18n.js';
import { renderSkeletons } from './skeleton.js';
import { getDisplayItems } from './display.js';
import { resetLazyState, setFilteredItems, appendBatch, observeSentinel, lazySizeFetch } from './lazy.js';
import { attachCardEvents } from './events.js';
import { vsInit, vsCleanup } from './virtual-scroll.js';

const VIRTUAL_SCROLL_THRESHOLD = 200;
let _animatingOut = false;

export function renderMediaContainer() {
  const container = document.getElementById('media-container');
  const countEl = document.getElementById('found-count');
  if (!container) return;

  const { items, isAnalyzing } = store.state;

  if (isAnalyzing) {
    renderSkeletons(container);
    if (countEl) countEl.textContent = t('status.loading');
    return;
  }

  const currentFiltered = getDisplayItems();

  if (countEl) {
    countEl.textContent = t('status.found_count', { count: currentFiltered.length });
  }

  if (currentFiltered.length === 0) {
    container.classList.remove('grid-view', 'list-view', 'compact-view');
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">
          <svg width="96" height="96" viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M88 76a8 8 0 0 1-8 8H16a8 8 0 0 1-8-8V20a8 8 0 0 1 8-8h20l8 12h36a8 8 0 0 1 8 8z" stroke="currentColor" stroke-width="2.5" fill="none" opacity="0.35" stroke-linejoin="round"/>
            <path d="M32 52h32" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.2"/>
            <path d="M32 60h24" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.2"/>
            <path d="M32 68h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.2"/>
          </svg>
        </div>
        <h3>${items.length === 0 ? t('status.empty') : t('status.filter_empty')}</h3>
        ${items.length === 0 ? `<p class="empty-state-description">${t('status.empty_hint')}</p>` : ''}
        ${items.length > 0 ? `<button class="btn btn-secondary btn-sm filter-clear-btn" style="margin-top:16px">${t('status.clear_filters')}</button>` : ''}
      </div>
    `;
    resetLazyState();
    vsCleanup();
    return;
  }

  if (_animatingOut) return;
  const oldCards = container.querySelectorAll('.media-card');
  if (oldCards.length > 0) {
    _animatingOut = true;
    oldCards.forEach(c => c.classList.add('card-leave'));
    setTimeout(() => {
      _animatingOut = false;
      doActualRender(container);
    }, 150);
    return;
  }

  doActualRender(container);
}

function doActualRender(container) {
  const { viewMode, thumbBlurred } = store.state;
  vsCleanup();

  const currentFiltered = getDisplayItems();
  setFilteredItems(currentFiltered);

  if (currentFiltered.length >= VIRTUAL_SCROLL_THRESHOLD) {
    vsInit(container, currentFiltered);
    return;
  }

  container.classList.toggle('grid-view', viewMode === 'grid' || viewMode === 'compact');
  container.classList.toggle('list-view', viewMode === 'list');
  container.classList.toggle('compact-view', viewMode === 'compact');

  resetLazyState();
  container.innerHTML = '';

  appendBatch(container);
  observeSentinel(container);

  // Animate new cards in
  requestAnimationFrame(() => {
    container.querySelectorAll('.media-card').forEach(c => c.classList.add('card-enter'));
  });

  // Apply blur after render so CSS transition animates smoothly
  requestAnimationFrame(() => {
    container.classList.toggle('thumb-blurred', thumbBlurred);
  });

  // Lazy size fetch
  requestAnimationFrame(() => lazySizeFetch(container));

  // Delegação no container: cards de batches seguintes (lazy) e do virtual
  // scroll herdaram os mesmos handlers via event bubbling.
  attachCardEvents(container, true);
}

export { renderSkeletons } from './skeleton.js';
export { getDisplayItems } from './display.js';
export { updateBatchActionsUI, updateCardSize, updateCardSelection, updateAllCardSelections, toggleBlur } from './batch.js';
export { openPreviewModal } from './modal.js';