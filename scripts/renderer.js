import { store } from './state.js';
import { formatBytes, sanitizeHtml, estimateFileSize, Toast } from './utils.js';
import { t } from './i18n.js';
import { downloadSingleItem } from './download.js';

const BATCH_SIZE = 20;
let renderedCount = 0;
let lazyObserver = null;
let currentFiltered = [];
let _animatingOut = false;

export function renderSkeletons(container, count = 6) {
  if (!container) return;
  const isGrid = store.state.viewMode === 'grid';
  container.classList.toggle('grid-view', isGrid);
  container.classList.toggle('list-view', !isGrid);

  let html = '';
  for (let i = 0; i < count; i++) {
    html += `<div class="skeleton skeleton-card">
  <div class="skeleton-thumb"></div>
  <div class="skeleton-body">
    <div class="skeleton-line w-80"></div>
    <div class="skeleton-line w-60"></div>
  </div>
</div>`;
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
          <button class="btn btn-secondary btn-sm copy-link-btn" data-id="${item.id}" title="${t('actions.copy_link')}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
          ${(item.type === 'video' || item.type === 'image' || item.type === 'audio') ? `
            <button class="btn btn-secondary btn-sm preview-btn" data-id="${item.id}" title="${t('actions.preview')}">${t('actions.preview')}</button>
          ` : ''}
          <button class="btn btn-primary btn-sm download-btn" data-id="${item.id}" title="${t('actions.download')}">${t('actions.download')}</button>
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
        const items = store.state.items;
        const idx = items.indexOf(item);
        if (idx !== -1) {
          const updated = structuredClone(item);
          updated.size = s;
          const newItems = [...items];
          newItems[idx] = updated;
          store.state.items = newItems;
        }
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
      </div>
    `;
    resetLazyState();
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

  container.classList.toggle('grid-view', viewMode === 'grid' || viewMode === 'compact');
  container.classList.toggle('list-view', viewMode === 'list');
  container.classList.toggle('compact-view', viewMode === 'compact');

  renderedCount = 0;
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
      const items = store.state.items;
      const idx = items.findIndex(i => i.id === id);
      if (idx === -1) return;
      const item = items[idx];
      if (!item || !item.qualities) return;
      const qIdx = parseInt(e.target.value, 10);
      const q = item.qualities[qIdx];
      if (!q) return;
      const updated = structuredClone(item);
      updated.selectedQualityIndex = qIdx;
      updated.url = q.url;
      updated.proxyUrl = q.proxyUrl;
      if (q.size > 0) {
        updated.size = q.size;
      } else {
        updated.size = estimateFileSize(q.width, q.height);
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
              }
              updateCardSize(id, parseInt(m[1], 10));
            }
          }
        }).catch(() => {});
      }
      const newItems = [...items];
      newItems[idx] = updated;
      store.state.items = newItems;
      const card = container.querySelector(`.media-card[data-id="${id}"]`);
      const sizeEl = card?.querySelector('.card-meta span:last-of-type');
      if (sizeEl) sizeEl.textContent = formatBytes(updated.size);
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

  container.querySelectorAll('.copy-link-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.getAttribute('data-id');
      const item = store.state.items.find(i => i.id === id);
      if (!item || !item.url) return;
      try {
        await navigator.clipboard.writeText(item.url);
        Toast.show(t('toast.copied'), 'success');
      } catch {
        Toast.show(t('toast.copy_failed'), 'error');
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

function trapFocus(container, e) {
  if (e.key === 'Escape') {
    const close = container._closeModal;
    if (close) close();
    return;
  }
  if (e.key !== 'Tab') return;
  const els = getFocusableElements(container);
  if (els.length === 0) {
    e.preventDefault();
    return;
  }
  const first = els[0];
  const last = els[els.length - 1];
  if (e.shiftKey) {
    if (document.activeElement === first || !container.contains(document.activeElement)) {
      e.preventDefault();
      last.focus();
    }
  } else {
    if (document.activeElement === last || !container.contains(document.activeElement)) {
      e.preventDefault();
      first.focus();
    }
  }
}

export function openPreviewModal(item) {
  let modal = document.getElementById('preview-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'preview-modal';
    modal.className = 'modal-overlay';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);
  }

  let closeModalFn = modal._closeModal;
  if (!closeModalFn) {
    closeModalFn = () => {
      modal.classList.remove('open');
      const mediaEl = modal.querySelector('video, audio');
      if (mediaEl) mediaEl.pause();
      if (modal._previousFocus) {
        modal._previousFocus.focus();
        modal._previousFocus = null;
      }
    };
    modal._closeModal = closeModalFn;
  }

  modal._previousFocus = document.activeElement;

  if (!modal._keyHandlerInstalled) {
    modal._keyHandlerInstalled = true;
    modal.addEventListener('keydown', (e) => trapFocus(modal, e));
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
    <div class="modal-content" role="document">
      <div class="modal-header">
        <h3 id="modal-title">${sanitizeHtml(item.name)}</h3>
        <button class="btn btn-icon close-modal-btn" data-focus-init aria-label="${t('modal.close')}" title="${t('actions.close')}">&times;</button>
      </div>
      <div class="modal-body">
        ${bodyContent}
      </div>
    </div>
  `;

  modal.setAttribute('aria-labelledby', 'modal-title');

  modal.classList.add('open');

  modal.querySelector('.close-modal-btn').addEventListener('click', closeModalFn);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModalFn();
  });

  const focusable = getFocusableElements(modal);
  const initEl = modal.querySelector('[data-focus-init]') || focusable[0];
  if (initEl) {
    requestAnimationFrame(() => initEl.focus());
  } else if (modal.querySelector('.modal-content')) {
    modal.querySelector('.modal-content').setAttribute('tabindex', '-1');
    requestAnimationFrame(() => modal.querySelector('.modal-content').focus());
  }
}

function getFocusableElements(container) {
  const selectors = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ];
  return [...container.querySelectorAll(selectors)].filter(el => el.offsetParent !== null);
}
