/**
 * DOM Renderer Module (renderer.js)
 */
import { store } from './state.js';
import { formatBytes, sanitizeHtml, Toast } from './utils.js';
import { t } from './i18n.js';
import { downloadSingleItem } from './download.js';

export function renderSkeletons(container, count = 6) {
  if (!container) return;
  const isGrid = store.state.viewMode === 'grid';
  container.className = `media-container ${isGrid ? 'grid-view' : 'list-view'}`;
  
  let html = '';
  for (let i = 0; i < count; i++) {
    html += `<div class="skeleton skeleton-card"></div>`;
  }
  container.innerHTML = html;
}

export function renderMediaContainer() {
  const container = document.getElementById('media-container');
  const countEl = document.getElementById('found-count');
  if (!container) return;

  const { items, activeFilter, searchQuery, viewMode, selectedItemIds, isAnalyzing } = store.state;

  if (isAnalyzing) {
    renderSkeletons(container);
    if (countEl) countEl.textContent = t('status.loading');
    return;
  }

  // Filter items
  const filtered = items.filter(item => {
    const matchesFilter = activeFilter === 'all' || item.type === activeFilter;
    const matchesSearch = !searchQuery || item.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  if (countEl) {
    countEl.textContent = t('status.found_count', { count: filtered.length });
  }

  if (filtered.length === 0) {
    container.className = 'media-container';
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📂</div>
        <h3>${items.length === 0 ? t('status.empty') : 'Nenhum resultado para os filtros atuais.'}</h3>
      </div>
    `;
    return;
  }

  container.className = `media-container ${viewMode === 'grid' ? 'grid-view' : 'list-view'}`;

  const cardsHtml = filtered.map(item => {
    const isSelected = selectedItemIds.has(item.id);
    const typeIconMap = {
      video: '🎥',
      image: '🖼️',
      audio: '🎵',
      document: '📄'
    };

    let previewContent = `<div class="media-placeholder-icon">${typeIconMap[item.type] || '📄'}</div>`;
    if (item.type === 'image') {
      previewContent = `<img src="${item.proxyUrl}" alt="${sanitizeHtml(item.name)}" loading="lazy" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'media-placeholder-icon\\'>🖼️</div>';" />`;
    } else if (item.thumbnail) {
      previewContent = `<img src="${item.thumbnail}" alt="${sanitizeHtml(item.name)}" loading="lazy" />`;
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
  }).join('');

  container.innerHTML = cardsHtml;
  attachCardEvents(container);
}

function attachCardEvents(container) {
  // Checkbox events
  container.querySelectorAll('.card-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const id = e.target.getAttribute('data-id');
      if (e.target.checked) {
        store.state.selectedItemIds.add(id);
      } else {
        store.state.selectedItemIds.delete(id);
      }
      renderMediaContainer();
      updateBatchActionsUI();
    });
  });

  // Download buttons
  container.querySelectorAll('.download-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.target.getAttribute('data-id');
      const item = store.state.items.find(i => i.id === id);
      if (item) {
        downloadSingleItem(item);
      }
    });
  });

  // Preview buttons
  container.querySelectorAll('.preview-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.target.getAttribute('data-id');
      const item = store.state.items.find(i => i.id === id);
      if (item) {
        openPreviewModal(item);
      }
    });
  });
}

export function updateBatchActionsUI() {
  const batchBtn = document.getElementById('download-selected-btn');
  const count = store.state.selectedItemIds.size;
  if (batchBtn) {
    batchBtn.disabled = count === 0;
    batchBtn.textContent = `${t('actions.download_selected')} (${count})`;
  }
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
