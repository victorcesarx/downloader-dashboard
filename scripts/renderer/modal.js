import { t } from '../i18n.js';
import { sanitizeHtml } from '../utils.js';
import { closeIconSvg } from '../icons.js';

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
    bodyContent = `<p data-i18n="modal.unsupported_preview">${t('modal.unsupported_preview')}</p>`;
  }

  modal.innerHTML = `
    <div class="modal-content" role="document">
      <div class="modal-header">
        <h3 id="modal-title">${sanitizeHtml(item.name)}</h3>
        <button class="btn btn-icon icon-close-btn close-modal-btn" data-focus-init data-i18n-aria-label="actions.close" data-i18n-title="actions.close" aria-label="${t('actions.close')}" title="${t('actions.close')}">${closeIconSvg()}</button>
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
