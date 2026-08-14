import { t } from '../i18n.js';
import { sanitizeHtml } from '../utils.js';
import { closeIconSvg } from '../icons.js';
import { getDisplayItems } from './display.js';
import { attachAudioWaveform, stopAudioWaveform } from '../audio-waveform.js';

function trapFocus(container, e) {
  if (e.key === 'Escape') {
    const close = container._closeModal;
    if (close) close();
    return;
  }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    container._navigate?.(e.key === 'ArrowLeft' ? -1 : 1);
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

function previewable(items) {
  return (Array.isArray(items) ? items : []).filter(candidate => ['video', 'image', 'audio'].includes(candidate.type) && candidate.proxyUrl);
}

function preloadAdjacentThumbnails(items, index) {
  if (typeof Image === 'undefined' || items.length < 2) return;
  const indexes = new Set([(index - 1 + items.length) % items.length, (index + 1) % items.length]);
  indexes.forEach(candidateIndex => {
    const thumbnail = items[candidateIndex]?.thumbnail;
    if (thumbnail) new Image().src = thumbnail;
  });
}

function chevronIconSvg(direction) {
  const path = direction === 'previous' ? 'M15 18l-6-6 6-6' : 'M9 6l6 6-6 6';
  return `<svg class="lightbox-nav-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${path}" /></svg>`;
}

export function openPreviewModal(item, suppliedItems = getDisplayItems()) {
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
      modal.classList.remove('lightbox-static');
      const mediaEl = modal.querySelector('video, audio');
      if (mediaEl) mediaEl.pause();
      const audio = modal.querySelector('audio');
      if (audio) stopAudioWaveform(audio);
      if (modal._previousFocus) {
        modal._previousFocus.focus();
        modal._previousFocus = null;
      }
    };
    modal._closeModal = closeModalFn;
  }

  if (!modal.classList.contains('open')) modal._previousFocus = document.activeElement;

  if (!modal._keyHandlerInstalled) {
    modal._keyHandlerInstalled = true;
    modal.addEventListener('keydown', (e) => trapFocus(modal, e));
  }

  const gallery = previewable(suppliedItems);
  let index = gallery.findIndex(candidate => String(candidate.id) === String(item.id));
  if (index < 0 && ['video', 'image', 'audio'].includes(item.type) && item.proxyUrl) {
    gallery.splice(0, gallery.length, item);
    index = 0;
  }
  let current = gallery[index] || item;

  const renderCurrent = () => {
    const previousMedia = modal.querySelector('video, audio');
    previousMedia?.pause();
    if (previousMedia?.tagName === 'AUDIO') stopAudioWaveform(previousMedia);
    current = gallery[index] || item;
    let bodyContent = '';
    if (current.type === 'video') {
      bodyContent = `<video src="${sanitizeHtml(current.proxyUrl)}" controls autoplay></video>`;
    } else if (current.type === 'image') {
      bodyContent = `<img src="${sanitizeHtml(current.proxyUrl)}" alt="${sanitizeHtml(current.name)}" />`;
    } else if (current.type === 'audio') {
      bodyContent = `<div class="audio-preview"><canvas class="audio-waveform" width="720" height="112" aria-label="${t('modal.audio_waveform')}"></canvas><audio src="${sanitizeHtml(current.proxyUrl)}" controls autoplay crossorigin="anonymous"></audio><p class="audio-waveform-fallback">${t('modal.waveform_fallback')}</p></div>`;
    } else {
      bodyContent = `<p data-i18n="modal.unsupported_preview">${t('modal.unsupported_preview')}</p>`;
    }

    const hasGallery = gallery.length > 1;
    modal.innerHTML = `
      <div class="modal-content lightbox-content" role="document">
        <div class="modal-header">
          <h3 id="modal-title">${sanitizeHtml(current.name)}</h3>
          ${gallery.length ? `<span class="lightbox-counter" aria-live="polite">${index + 1} / ${gallery.length}</span>` : ''}
          <button class="btn btn-icon icon-close-btn close-modal-btn" data-focus-init aria-label="${t('actions.close')}" title="${t('actions.close')}">${closeIconSvg()}</button>
        </div>
        <div class="modal-body lightbox-body">
          ${hasGallery ? `<button class="lightbox-nav lightbox-prev" type="button" aria-label="${t('modal.previous')}" title="${t('modal.previous')}">${chevronIconSvg('previous')}</button>` : ''}
          <div class="lightbox-stage">${bodyContent}</div>
          ${hasGallery ? `<button class="lightbox-nav lightbox-next" type="button" aria-label="${t('modal.next')}" title="${t('modal.next')}">${chevronIconSvg('next')}</button>` : ''}
        </div>
      </div>`;
    modal.querySelector('.close-modal-btn').addEventListener('click', closeModalFn);
    const navigate = direction => {
      if (gallery.length < 2) return;
      // O modal já está visível: a nova estrutura interna não deve receber
      // novamente a animação reservada à abertura do lightbox.
      modal.classList.add('lightbox-static');
      index = (index + direction + gallery.length) % gallery.length;
      renderCurrent();
    };
    modal.querySelector('.lightbox-prev')?.addEventListener('click', () => navigate(-1));
    modal.querySelector('.lightbox-next')?.addEventListener('click', () => navigate(1));
    const audio = modal.querySelector('audio');
    const canvas = modal.querySelector('.audio-waveform');
    if (audio && canvas) {
      const enhanced = attachAudioWaveform(audio, canvas);
      modal.querySelector('.audio-waveform-fallback')?.classList.toggle('visible', !enhanced);
    }
    modal._navigate = navigate;
    preloadAdjacentThumbnails(gallery, index);
  };

  renderCurrent();
  modal.setAttribute('aria-labelledby', 'modal-title');

  modal.classList.add('open');

  if (!modal._backdropHandlerInstalled) {
    modal._backdropHandlerInstalled = true;
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModalFn();
    });
    let touchStartX = null;
    modal.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0]?.clientX ?? null; }, { passive: true });
    modal.addEventListener('touchend', e => {
      if (touchStartX === null) return;
      const delta = (e.changedTouches[0]?.clientX ?? touchStartX) - touchStartX;
      touchStartX = null;
      if (Math.abs(delta) >= 50) modal._navigate?.(delta > 0 ? -1 : 1);
    }, { passive: true });
  }

  const focusable = getFocusableElements(modal);
  const initEl = modal.querySelector('[data-focus-init]') || focusable[0];
  if (initEl) {
    requestAnimationFrame(() => initEl.focus());
  } else if (modal.querySelector('.modal-content')) {
    modal.querySelector('.modal-content').setAttribute('tabindex', '-1');
    requestAnimationFrame(() => modal.querySelector('.modal-content').focus());
  }
}
