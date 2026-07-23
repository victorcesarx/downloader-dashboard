import { store } from './state.js';
import { formatBytes, sanitizeHtml, estimateFileSize } from './utils.js';
import { t } from './i18n.js';
import { downloadSingleItem } from './download.js';

const BATCH_SIZE = 20;
let renderedCount = 0;
let lazyObserver = null;
let currentFiltered = [];

export function renderSkeletons(container, count = 6) {
  if (!container) return;
  const isGrid = store.state.viewMode === 'grid';
  container.classList.toggle('grid-view', isGrid);
  container.classList.toggle('list-view', !isGrid);

  let html = '';
  for (let i = 0; i < count; i++) {
    html += `<div class="skeleton skeleton-card"></div>`;
  }
  container.innerHTML = html;
}

function buildCardHtml(item, isSelected, typeIconMap) {
  let previewContent = `<div class="media-placeholder-icon">${typeIconMap[item.type] || '📄'}</div>`;
  if (item.type === 'image') {
    previewContent = `<img src="${item.proxyUrl}" alt="${sanitizeHtml(item.name)}" loading="lazy" onerror="this.onerror=null;this.parentElement.innerHTML='<div class=\\'media-placeholder-icon\\'>🖼️</div>';" />`;
  } else if (item.thumbnail) {
    previewContent = `<img src="${item.thumbnail}" alt="${sanitizeHtml(item.name)}" loading="lazy" onerror="this.onerror=null;this.parentElement.innerHTML='<div class=\\'media-placeholder-icon\\'>${typeIconMap[item.type] || '📄'}</div>';" />`;
  }

  return `
    <div class="media-card ${isSelected ? 'selected' : ''}" data-id="${item.id}">
      <input type="checkbox" class="card-checkbox" data-id="${item.id}" ${isSelected ? 'checked' : ''} />
      <div class="card-media-preview">
        ${previewContent}
        <span class="card-badge-type">${sanitizeHtml(item.label || item.type)}</span>
      </div>
      <div class="card-body">
        <div class="card-title" title="${sanitizeHtml(item.name)}">${sanitizeHtml(item.name)}</div>
        <div class="card-meta">
          <span>${item.ext ? item.ext.toUpperCase() : ''}</span>
          <span>${formatBytes(item.size)}</span>
          ${item.qualities && item.qualities.length > 1 ? `
            <select class="quality-select" data-id="${item.id}">
              ${item.qualities.map((q, i) => `<option value="${i}" ${i === item.selectedQualityIndex ? 'selected' : ''}>${q.label}</option>`).join('')}
            </select>
          ` : ''}
        </div>
        <div class="card-actions">
          ${(item.type === 'video' || item.type === 'image' || item.type === 'audio') ? `
            <button class="btn btn-secondary btn-sm preview-btn" data-id="${item.id}">${t('actions.preview')}</button>
          ` : ''}
          <button class="btn btn-primary btn-sm download-btn" data-id="${item.id}">${t('actions.download')}</button>
        </div>
      </div>
    </div>
  `;
}

function getFiltered() {
  const { items, activeFilter, searchQuery } = store.state;
  return items.filter(item => {
    const matchesFilter = activeFilter === 'all' || item.type === activeFilter;
    const matchesSearch = !searchQuery || item.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });
}

function appendBatch(container) {
  const { selectedItemIds } = store.state;
  const typeIconMap = { video: '🎥', image: '🖼️', audio: '🎵', document: '📄' };
  const end = Math.min(renderedCount + BATCH_SIZE, currentFiltered.length);
  let html = '';
  for (let i = renderedCount; i < end; i++) {
    const item = currentFiltered[i];
    html += buildCardHtml(item, selectedItemIds.has(item.id), typeIconMap);
  }
  container.insertAdjacentHTML('beforeend', html);
  renderedCount = end;
}

function observeSentinel(container) {
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

function resetLazyState() {
  renderedCount = 0;
  currentFiltered = [];
}

function lazySizeFetch(container) {
  const { items } = store.state;
  items.forEach(item => {
    if (item.size) return;
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
        item.size = s;
        sizeEl.textContent = formatBytes(s);
      }
    }).catch(() => {});
  });
}

export function renderMediaContainer() {
  const container = document.getElementById('media-container');
  const countEl = document.getElementById('found-count');
  if (!container) return;

  const { items, viewMode, selectedItemIds, isAnalyzing, thumbBlurred } = store.state;

  if (isAnalyzing) {
    renderSkeletons(container);
    if (countEl) countEl.textContent = t('status.loading');
    return;
  }

  currentFiltered = getFiltered();

  if (countEl) {
    countEl.textContent = t('status.found_count', { count: currentFiltered.length });
  }

  if (currentFiltered.length === 0) {
    container.classList.remove('grid-view', 'list-view');
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📂</div>
        <h3>${items.length === 0 ? t('status.empty') : t('status.filter_empty')}</h3>
      </div>
    `;
    resetLazyState();
    return;
  }

  container.classList.toggle('grid-view', viewMode === 'grid');
  container.classList.toggle('list-view', viewMode === 'list');

  renderedCount = 0;
  container.innerHTML = '';

  // Render initial batch
  appendBatch(container);
  observeSentinel(container);

  // Apply blur after render so CSS transition animates smoothly
  requestAnimationFrame(() => {
    container.classList.toggle('thumb-blurred', thumbBlurred);
  });

  // Lazy size fetch
  requestAnimationFrame(() => lazySizeFetch(container));

  attachCardEvents(container);
}

function attachCardEvents(container) {
  container.querySelectorAll('.card-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const id = e.target.getAttribute('data-id');
      const next = new Set(store.state.selectedItemIds);
      if (e.target.checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      store.state.selectedItemIds = next;
      const card = e.target.closest('.media-card');
      if (card) {
        card.classList.toggle('selected', e.target.checked);
      }
      updateBatchActionsUI();
    });
  });

  container.querySelectorAll('.download-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.target.getAttribute('data-id');
      const item = store.state.items.find(i => i.id === id);
      const cardEl = e.target.closest('.media-card');
      if (item) {
        if (item.openInBrowser) {
          window.open(item.url, '_blank');
        } else {
          downloadSingleItem(item, cardEl);
        }
      }
    });
  });

  container.querySelectorAll('.quality-select').forEach(sel => {
    sel.addEventListener('change', (e) => {
      const id = e.target.getAttribute('data-id');
      const item = store.state.items.find(i => i.id === id);
      if (!item || !item.qualities) return;
      const idx = parseInt(e.target.value, 10);
      const q = item.qualities[idx];
      if (!q) return;
      item.selectedQualityIndex = idx;
      item.url = q.url;
      item.proxyUrl = q.proxyUrl;
      if (q.size > 0) {
        item.size = q.size;
      } else {
        item.size = estimateFileSize(q.width, q.height);
        fetch(q.proxyUrl, { headers: { Range: 'bytes=0-0' } }).then(r => {
          const cr = r.headers.get('content-range');
          if (cr) {
            const m = cr.match(/(\d+)$/);
            if (m) { item.size = parseInt(m[1], 10); updateCardSize(id, item.size); }
          }
        }).catch(() => {});
      }
      const card = container.querySelector(`.media-card[data-id="${id}"]`);
      const sizeEl = card?.querySelector('.card-meta span:last-of-type');
      if (sizeEl) sizeEl.textContent = formatBytes(item.size);
    });
  });

  container.querySelectorAll('.preview-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.target.getAttribute('data-id');
      const item = store.state.items.find(i => i.id === id);
      if (item) {
        if (item.openInBrowser) {
          window.open(item.url, '_blank');
        } else {
          openPreviewModal(item);
        }
      }
    });
  });
}

export function updateBatchActionsUI() {
  const batchBtn = document.getElementById('download-selected-btn');
  let totalSizeEl = document.getElementById('total-size-display');
  const toggleBtn = document.getElementById('toggle-select-btn');
  const selectedIds = store.state.selectedItemIds;
  const count = selectedIds.size;

  if (toggleBtn) {
    const { items, activeFilter, searchQuery } = store.state;
    const filteredIds = items.filter(item => {
      const matchesFilter = activeFilter === 'all' || item.type === activeFilter;
      const matchesSearch = !searchQuery || item.name.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesFilter && matchesSearch;
    }).map(i => i.id);
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
  const card = document.querySelector(`.media-card[data-id="${id}"]`);
  const sizeEl = card?.querySelector('.card-meta span:last-of-type');
  if (sizeEl) sizeEl.textContent = formatBytes(size);
}

export function updateCardSelection(id, selected) {
  const card = document.querySelector(`.media-card[data-id="${id}"]`);
  if (!card) return;
  card.classList.toggle('selected', selected);
  const cb = card.querySelector('.card-checkbox');
  if (cb) cb.checked = selected;
}

export function updateAllCardSelections() {
  const { selectedItemIds } = store.state;
  document.querySelectorAll('.media-card').forEach(card => {
    const id = card.getAttribute('data-id');
    const sel = selectedItemIds.has(id);
    card.classList.toggle('selected', sel);
    const cb = card.querySelector('.card-checkbox');
    if (cb) cb.checked = sel;
  });
}

export function toggleBlur() {
  const container = document.getElementById('media-container');
  if (container) container.classList.toggle('thumb-blurred', store.state.thumbBlurred);
}

export function openPreviewModal(item) {
  let modal = document.getElementById('preview-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'preview-modal';
    modal.className = 'modal-overlay';
    document.body.appendChild(modal);
  }

  let bodyContent = '';
  if (item.type === 'video') {
    bodyContent = `<video src="${item.proxyUrl}" controls autoplay style="width:100%; max-height:70vh;"></video>`;
  } else if (item.type === 'image') {
    bodyContent = `<img src="${item.proxyUrl}" alt="${sanitizeHtml(item.name)}" style="max-width:100%; max-height:70vh;" />`;
  } else if (item.type === 'audio') {
    bodyContent = `<audio src="${item.proxyUrl}" controls autoplay style="width:100%; margin:20px 0;"></audio>`;
  } else {
    bodyContent = `<p>${t('modal.unsupported_preview')}</p>`;
  }

  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>${sanitizeHtml(item.name)}</h3>
        <button class="btn btn-icon close-modal-btn">&times;</button>
      </div>
      <div class="modal-body">
        ${bodyContent}
      </div>
    </div>
  `;

  modal.classList.add('open');

  const closeModal = () => {
    modal.classList.remove('open');
    const mediaEl = modal.querySelector('video, audio');
    if (mediaEl) mediaEl.pause();
  };

  modal.querySelector('.close-modal-btn').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
}
