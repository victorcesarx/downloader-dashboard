import { onLocaleChange, t } from './i18n.js';
import { closeRightPanel, getActiveRightPanel } from './right-panel.js';
import { closeIconSvg } from './icons.js';

let helpModal = null;
let initialized = false;

export function isEditableTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]'));
}

export function closeOpenModal() {
  const help = document.getElementById('shortcuts-help-modal');
  if (help?.classList.contains('open')) {
    help._closeModal?.();
    return true;
  }

  const rename = document.querySelector('.rename-overlay');
  if (rename) {
    rename.querySelector('.rename-cancel')?.click();
    return true;
  }

  const modal = document.querySelector('.modal-overlay.open');
  if (!modal) return false;
  if (modal._closeModal) modal._closeModal();
  else modal.querySelector('.close-modal-btn')?.click();
  return true;
}

function hasOpenModal() {
  return Boolean(document.querySelector('.rename-overlay, .modal-overlay.open'));
}

export function createShortcutHandler(actions) {
  return event => {
    const editable = isEditableTarget(event.target);

    if (event.key === 'Escape') {
      if (actions.closeModal()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (actions.hasOpenPanel()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        actions.closePanel();
        return;
      }
      if (!editable && actions.hasSelection()) {
        event.preventDefault();
        actions.clearSelection();
      }
      return;
    }

    if (actions.isBlocked() || event.altKey && event.key.toLowerCase() !== 'z') return;

    const command = event.ctrlKey || event.metaKey;
    if (command && event.key === 'Enter') {
      event.preventDefault();
      actions.analyze();
      return;
    }

    if (editable) return;

    if (command && event.key.toLowerCase() === 'a' && actions.hasVisibleItems()) {
      event.preventDefault();
      actions.selectVisible();
      return;
    }

    if (event.altKey && event.key.toLowerCase() === 'z' && actions.hasSelection()) {
      event.preventDefault();
      actions.startZip();
      return;
    }

    if (event.key === '?') {
      event.preventDefault();
      actions.openHelp();
    }
  };
}

function shortcutRow(keys, description) {
  return `<div class="shortcuts-row"><dt class="shortcuts-keys">${keys.map(key => `<kbd>${key}</kbd>`).join('')}</dt><dd>${description}</dd></div>`;
}

function renderHelp() {
  if (!helpModal) return;
  helpModal.innerHTML = `
    <div class="modal-content shortcuts-help-content" role="document">
      <div class="modal-header">
        <h3 id="shortcuts-help-title">${t('shortcuts.title')}</h3>
        <button class="btn btn-icon icon-close-btn close-modal-btn" type="button" aria-label="${t('actions.close')}" title="${t('actions.close')}">${closeIconSvg()}</button>
      </div>
      <div class="modal-body">
        <p class="shortcuts-help-intro">${t('shortcuts.subtitle')}</p>
        <dl class="shortcuts-list">
          ${shortcutRow([t('shortcuts.ctrl_or_cmd'), 'Enter'], t('shortcuts.analyze'))}
          ${shortcutRow(['Esc'], t('shortcuts.close_context'))}
          ${shortcutRow([t('shortcuts.ctrl_or_cmd'), 'A'], t('shortcuts.select_all'))}
          ${shortcutRow(['Alt', 'Z'], t('shortcuts.start_zip'))}
          ${shortcutRow(['?'], t('shortcuts.show_help'))}
        </dl>
      </div>
    </div>`;
  helpModal.querySelector('.close-modal-btn').addEventListener('click', helpModal._closeModal);
}

export function openShortcutHelp() {
  if (getActiveRightPanel() !== null) closeRightPanel();

  if (!helpModal) {
    helpModal = document.createElement('div');
    helpModal.id = 'shortcuts-help-modal';
    helpModal.className = 'modal-overlay';
    helpModal.setAttribute('role', 'dialog');
    helpModal.setAttribute('aria-modal', 'true');
    helpModal.setAttribute('aria-labelledby', 'shortcuts-help-title');
    document.body.appendChild(helpModal);
    helpModal._closeModal = () => {
      helpModal.classList.remove('open');
      helpModal._previousFocus?.focus();
      helpModal._previousFocus = null;
    };
    helpModal.addEventListener('click', event => {
      if (event.target === helpModal) helpModal._closeModal();
    });
  }

  helpModal._previousFocus = document.activeElement;
  renderHelp();
  helpModal.classList.add('open');
  requestAnimationFrame(() => helpModal.querySelector('.close-modal-btn')?.focus());
}

export function initGlobalShortcuts(actions) {
  if (initialized) return;
  initialized = true;

  const helpButton = document.getElementById('shortcuts-help-btn');
  helpButton?.addEventListener('click', openShortcutHelp);
  onLocaleChange(() => {
    if (helpModal?.classList.contains('open')) renderHelp();
  });

  document.addEventListener('keydown', createShortcutHandler({
    ...actions,
    closeModal: closeOpenModal,
    hasOpenPanel: () => getActiveRightPanel() !== null,
    closePanel: closeRightPanel,
    isBlocked: () => hasOpenModal() || getActiveRightPanel() !== null,
    openHelp: openShortcutHelp,
  }), true);
}
