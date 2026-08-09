/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { closeOpenModal, createShortcutHandler, isEditableTarget, openShortcutHelp } from '../../scripts/keyboard-shortcuts.js';

function actions(overrides = {}) {
  return {
    analyze: vi.fn(),
    clearSelection: vi.fn(),
    closeModal: vi.fn(() => false),
    closePanel: vi.fn(),
    hasOpenPanel: vi.fn(() => false),
    hasSelection: vi.fn(() => false),
    hasVisibleItems: vi.fn(() => true),
    isBlocked: vi.fn(() => false),
    openHelp: vi.fn(),
    selectVisible: vi.fn(),
    startZip: vi.fn(),
    ...overrides,
  };
}

function keydown(target, init) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe('atalhos globais seguros', () => {
  beforeEach(() => {
    document.body.innerHTML = '<input id="input"><div id="surface" tabindex="0"></div>';
  });

  it('reconhece campos editáveis e seus descendentes', () => {
    document.body.innerHTML += '<div contenteditable="true"><span id="editable-child">texto</span></div>';
    expect(isEditableTarget(document.getElementById('input'))).toBe(true);
    expect(isEditableTarget(document.getElementById('editable-child'))).toBe(true);
    expect(isEditableTarget(document.getElementById('surface'))).toBe(false);
  });

  it('Ctrl/Cmd+Enter analisa inclusive a partir do campo de URL', () => {
    const api = actions();
    document.addEventListener('keydown', createShortcutHandler(api), { once: true });
    const event = keydown(document.getElementById('input'), { key: 'Enter', ctrlKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(api.analyze).toHaveBeenCalledOnce();
  });

  it('Ctrl/Cmd+A seleciona somente fora de campos editáveis', () => {
    const api = actions();
    const handler = createShortcutHandler(api);
    document.getElementById('input').addEventListener('keydown', handler);
    document.getElementById('surface').addEventListener('keydown', handler);

    const nativeEvent = keydown(document.getElementById('input'), { key: 'a', ctrlKey: true });
    const shortcutEvent = keydown(document.getElementById('surface'), { key: 'a', ctrlKey: true });

    expect(nativeEvent.defaultPrevented).toBe(false);
    expect(shortcutEvent.defaultPrevented).toBe(true);
    expect(api.selectVisible).toHaveBeenCalledOnce();
  });

  it('não captura Ctrl/Cmd+A quando não há mídia visível', () => {
    const api = actions({ hasVisibleItems: () => false });
    const handler = createShortcutHandler(api);
    document.getElementById('surface').addEventListener('keydown', handler);
    const event = keydown(document.getElementById('surface'), { key: 'a', metaKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(api.selectVisible).not.toHaveBeenCalled();
  });

  it('Alt+Z inicia ZIP somente quando há seleção', () => {
    const withoutSelection = actions();
    const withSelection = actions({ hasSelection: () => true });
    const surface = document.getElementById('surface');

    surface.addEventListener('keydown', createShortcutHandler(withoutSelection), { once: true });
    expect(keydown(surface, { key: 'z', altKey: true }).defaultPrevented).toBe(false);
    expect(withoutSelection.startZip).not.toHaveBeenCalled();

    surface.addEventListener('keydown', createShortcutHandler(withSelection), { once: true });
    expect(keydown(surface, { key: 'z', altKey: true }).defaultPrevented).toBe(true);
    expect(withSelection.startZip).toHaveBeenCalledOnce();
  });

  it('Escape respeita a prioridade modal, painel e seleção', () => {
    const modal = actions({ closeModal: vi.fn(() => true), hasOpenPanel: () => true, hasSelection: () => true });
    createShortcutHandler(modal)(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(modal.closePanel).not.toHaveBeenCalled();
    expect(modal.clearSelection).not.toHaveBeenCalled();

    const panel = actions({ hasOpenPanel: () => true, hasSelection: () => true });
    createShortcutHandler(panel)(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(panel.closePanel).toHaveBeenCalledOnce();
    expect(panel.clearSelection).not.toHaveBeenCalled();

    const selection = actions({ hasSelection: () => true });
    createShortcutHandler(selection)(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(selection.clearSelection).toHaveBeenCalledOnce();
  });

  it('Escape em campo editável não limpa a seleção', () => {
    const api = actions({ hasSelection: () => true });
    document.getElementById('input').addEventListener('keydown', createShortcutHandler(api));
    keydown(document.getElementById('input'), { key: 'Escape' });
    expect(api.clearSelection).not.toHaveBeenCalled();
  });

  it('suspende ações globais enquanto outro contexto está aberto', () => {
    const api = actions({ isBlocked: () => true, hasSelection: () => true });
    const handler = createShortcutHandler(api);
    const event = new KeyboardEvent('keydown', { key: 'z', altKey: true, cancelable: true });
    handler(event);
    expect(event.defaultPrevented).toBe(false);
    expect(api.startZip).not.toHaveBeenCalled();
  });

  it('? abre a ajuda fora de campos editáveis', () => {
    const api = actions();
    const event = new KeyboardEvent('keydown', { key: '?', cancelable: true });
    createShortcutHandler(api)(event);
    expect(event.defaultPrevented).toBe(true);
    expect(api.openHelp).toHaveBeenCalledOnce();
  });

  it('abre e fecha o modal real de ajuda pelo mesmo caminho do Escape', () => {
    openShortcutHelp();
    const modal = document.getElementById('shortcuts-help-modal');
    expect(modal.classList.contains('open')).toBe(true);
    expect(closeOpenModal()).toBe(true);
    expect(modal.classList.contains('open')).toBe(false);
  });
});
