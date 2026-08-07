import { store } from '../state.js';
import { formatBytes } from '../utils.js';
import { t } from '../i18n.js';
import { getDisplayItems } from './display.js';
import { vs } from './virtual-scroll.js';

export function updateBatchActionsUI() {
  const batchBtn = document.getElementById('download-selected-btn');
  let totalSizeEl = document.getElementById('total-size-display');
  const toggleBtn = document.getElementById('toggle-select-btn');
  const selectedIds = store.state.selectedItemIds;
  const count = selectedIds.size;

  if (toggleBtn) {
    const displayItems = getDisplayItems();
    const filteredIds = displayItems.map(i => i.id);
    const allSelected = filteredIds.length > 0 && filteredIds.every(id => selectedIds.has(id));
    toggleBtn.textContent = allSelected ? t('actions.deselect_all') : t('actions.select_all');
  }

  if (batchBtn) {
    batchBtn.disabled = count === 0;
    const sizeText = totalSizeEl?.textContent || '';
    batchBtn.innerHTML = `${t('actions.download_selected')} (${count}) <span id="total-size-display" class="total-size-info">${sizeText}</span>`;
    totalSizeEl = document.getElementById('total-size-display');
  }
  if (totalSizeEl) {
    if (count === 0) {
      totalSizeEl.textContent = '';
    } else {
      let totalBytes = 0;
      for (const id of selectedIds) {
        const item = store.state.items.find(i => i.id === id);
        if (item && item.size) totalBytes += item.size;
      }
      totalSizeEl.textContent = totalBytes > 0 ? `(${formatBytes(totalBytes)})` : '';
    }
  }
}

export function updateCardSize(id, size) {
  const selector = `.media-card[data-id="${id}"]`;
  let card = document.querySelector(selector);
  if (!card && vs.active && vs.wrapper) {
    card = vs.wrapper.querySelector(selector);
  }
  const sizeEl = card?.querySelector('.card-meta span:last-of-type');
  if (sizeEl) sizeEl.textContent = formatBytes(size);
}

export function updateCardSelection(id, selected) {
  const selector = `.media-card[data-id="${id}"]`;
  let card = document.querySelector(selector);
  if (!card && vs.active && vs.wrapper) {
    card = vs.wrapper.querySelector(selector);
  }
  if (!card) return;
  card.classList.toggle('selected', selected);
  const cb = card.querySelector('.card-checkbox');
  if (cb) cb.checked = selected;
}

export function updateAllCardSelections() {
  const { selectedItemIds } = store.state;
  const cards = document.querySelectorAll('.media-card');
  cards.forEach(card => {
    const id = card.getAttribute('data-id');
    const sel = selectedItemIds.has(id);
    card.classList.toggle('selected', sel);
    const cb = card.querySelector('.card-checkbox');
    if (cb) cb.checked = sel;
  });
  if (vs.active) vs.selectedItemIds = new Set(selectedItemIds);
}

export function toggleBlur() {
  const container = document.getElementById('media-container');
  if (!container) return;
  container.classList.toggle('thumb-blurred', store.state.thumbBlurred);
  if (vs.active) vs.container?.classList.toggle('thumb-blurred', store.state.thumbBlurred);
}