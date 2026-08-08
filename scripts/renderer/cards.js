import { store } from '../state.js';
import { formatBytes, sanitizeHtml } from '../utils.js';
import { t } from '../i18n.js';
import { formatMediaSize } from '../media-size.js';

export const TYPE_ICON_MAP = { video: '🎥', image: '🖼️', audio: '🎵', document: '📄' };

// Selo de entrega: mapeia `delivery` do item para a chave i18n e classe CSS.
const DELIVERY_BADGES = { progressive: 'progressive', hls: 'hls', dash: 'dash' };

function deliveryBadgeHtml(item) {
  const key = DELIVERY_BADGES[item.delivery];
  if (!key) return '';
  return `<span class="media-badge media-badge--${key}">${t(`badge.${key}`)}</span>`;
}

// Selo de variantes: mostra o total de variantes do grupo (2+) do item.
function variantBadgeHtml(item) {
  if (!item.variantCount || item.variantCount < 2) return '';
  return `<span class="media-badge media-badge--variants">${t('badge.variants', { count: item.variantCount })}</span>`;
}

// Rótulo de uma variante no seletor: usa os melhores dados disponíveis, nesta
// ordem — quality → resolução completa (width × height) → altura (1080p) →
// tamanho formatado → nome do arquivo.
function variantLabel(member) {
  if (member.quality) return String(member.quality);
  if (member.width && member.height) return `${member.width} × ${member.height}`;
  if (member.height) return `${member.height}p`;
  if (member.size > 0) return formatBytes(member.size, 1);
  return member.name;
}

// Controle de variante do card colapsado: lista todas as variantes do grupo e
// marca a atualmente selecionada. Grupos com 2+ itens.
function variantSelectHtml(item) {
  if (!item.variantCount || item.variantCount < 2 || !item.variantGroupKey) return '';
  const groupItems = store.state.items.filter(i => i.variantGroupKey === item.variantGroupKey);
  const current = groupItems.find(i => store.state.selectedItemIds.has(i.id)) || item;
  const currentUrl = current.url;
  const options = groupItems.map(m => `
            <option value="${sanitizeHtml(m.url)}" ${m.url === currentUrl ? 'selected' : ''}>${sanitizeHtml(variantLabel(m))}</option>`).join('');
  return `
            <select class="variant-select" data-key="${sanitizeHtml(item.variantGroupKey)}" aria-label="${t('actions.select_variant')}">
              <option value="" disabled>${t('actions.select_variant')}</option>
              ${options}
            </select>`;
}

export function buildCardHtml(item, isSelected, typeIconMap = TYPE_ICON_MAP) {
let previewContent = `<div class="media-placeholder-icon">${typeIconMap[item.type] || '📄'}</div>`;
  if (item.type === 'image') {
    previewContent = `<img class="card-media-img" src="${item.proxyUrl}" alt="${sanitizeHtml(item.name)}" loading="lazy" />`;
  } else if (item.thumbnail) {
    previewContent = `<img class="card-media-img" src="${item.thumbnail}" alt="${sanitizeHtml(item.name)}" loading="lazy" />`;
  }

  return `
    <div class="media-card ${isSelected ? 'selected' : ''}" data-id="${item.id}">
      <input type="checkbox" class="card-checkbox" data-id="${item.id}" ${isSelected ? 'checked' : ''} />
      <div class="card-media-preview">
        ${previewContent}
        <span class="card-badge-type">${sanitizeHtml(item.label || item.type)}</span>
        ${deliveryBadgeHtml(item)}
        ${variantBadgeHtml(item)}
      </div>
      <div class="card-body">
        <div class="card-title" title="${sanitizeHtml(item.name)}">${sanitizeHtml(item.name)}</div>
        <div class="card-meta">
          <span>${item.ext ? item.ext.toUpperCase() : ''}</span>
          <span>${formatMediaSize(item.size)}</span>
          ${item.qualities && item.qualities.length > 1 ? `
            <select class="quality-select" data-id="${item.id}">
              ${item.qualities.map((q, i) => `<option value="${i}" ${i === item.selectedQualityIndex ? 'selected' : ''}>${q.label}</option>`).join('')}
            </select>
          ` : ''}
          ${variantSelectHtml(item)}
        </div>
        <div class="card-actions card-state" data-state="idle">
          <button class="btn btn-secondary btn-sm copy-link-btn" data-id="${item.id}" title="${t('actions.copy_link')}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
          <button class="btn btn-secondary btn-sm inspect-btn" data-id="${item.id}" title="${t('actions.inspect')}">${t('actions.details')}</button>
          ${(item.type === 'video' || item.type === 'image' || item.type === 'audio') ? `
            <button class="btn btn-secondary btn-sm preview-btn" data-id="${item.id}" title="${t('actions.preview')}">${t('actions.preview')}</button>
          ` : ''}
          <button class="btn btn-primary btn-sm download-btn" data-id="${item.id}" title="${t('actions.download')}">${t('actions.download')}</button>
        </div>
      </div>
    </div>
  `;
}
