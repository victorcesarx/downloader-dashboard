/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const locale = vi.hoisted(() => ({ lang: 'pt', listener: null }));
vi.mock('../../scripts/i18n.js', () => ({
  t: (key) => ({
    'history.title': locale.lang === 'pt' ? 'URLs recentes' : 'Recent URLs',
    'history.clear': locale.lang === 'pt' ? 'Limpar' : 'Clear',
    'history.empty': locale.lang === 'pt' ? 'Nenhuma URL recente' : 'No recent URLs',
    'history.pin': 'Fixar', 'history.unpin': 'Desafixar', 'history.remove': 'Remover',
    'actions.copy_link': 'Copiar Link', 'toast.copied': 'Copiado', 'toast.copy_failed': 'Erro',
  }[key] || key),
  onLocaleChange: (callback) => { locale.listener = callback; return () => {}; },
}));

import {
  URL_HISTORY_KEY,
  URL_HISTORY_LIMIT_KEY,
  clearUrlHistory,
  getUrlHistory,
  initUrlHistory,
  recordAnalyzedUrl,
  togglePinnedUrl,
} from '../../scripts/url-history.js';

function mount() {
  document.body.innerHTML = '<div class="search-box-wrapper"><form class="search-box"><input id="url-input"></form></div>';
  const input = document.getElementById('url-input');
  const reuse = vi.fn();
  initUrlHistory(input, reuse);
  return { input, reuse, dropdown: document.querySelector('.url-history-dropdown') };
}

beforeEach(() => {
  localStorage.clear();
  locale.lang = 'pt';
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue() } });
});

describe('histórico de URLs analisadas', () => {
  it('não registra valores inválidos e mantém limite configurável', () => {
    localStorage.setItem(URL_HISTORY_LIMIT_KEY, '2');
    expect(recordAnalyzedUrl('not-a-url')).toBe(false);
    recordAnalyzedUrl('https://example.com/1');
    recordAnalyzedUrl('https://example.com/2');
    recordAnalyzedUrl('https://example.com/3');
    expect(getUrlHistory().map(entry => entry.url)).toEqual(['https://example.com/3', 'https://example.com/2']);
  });

  it('fixa entradas e a limpeza preserva somente as fixadas', () => {
    recordAnalyzedUrl('https://example.com/a');
    recordAnalyzedUrl('https://example.com/b');
    togglePinnedUrl('https://example.com/a');
    clearUrlHistory();
    expect(getUrlHistory()).toEqual([expect.objectContaining({ url: 'https://example.com/a', pinned: true })]);
  });

  it('dropdown reutiliza, copia, remove e reage ao idioma', async () => {
    recordAnalyzedUrl('https://example.com/media');
    const { input, reuse, dropdown } = mount();
    input.dispatchEvent(new Event('focus'));
    expect(dropdown.hidden).toBe(false);
    expect(dropdown.textContent).toContain('URLs recentes');

    dropdown.querySelector('[data-history-action="copy"]').click();
    await Promise.resolve();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://example.com/media');

    dropdown.querySelector('.url-history-reuse').click();
    expect(input.value).toBe('https://example.com/media');
    expect(reuse).toHaveBeenCalledWith('https://example.com/media');

    input.dispatchEvent(new Event('focus'));
    locale.lang = 'en';
    locale.listener();
    expect(dropdown.textContent).toContain('Recent URLs');

    dropdown.querySelector('[data-history-action="remove"]').click();
    expect(JSON.parse(localStorage.getItem(URL_HISTORY_KEY))).toEqual([]);
  });

  it('fecha ao perder foco, enviar o formulário, pressionar Escape ou clicar fora', () => {
    recordAnalyzedUrl('https://example.com/media');
    const { input, dropdown } = mount();
    const form = input.form;

    input.dispatchEvent(new Event('focus'));
    expect(dropdown.hidden).toBe(false);
    expect(input.getAttribute('aria-expanded')).toBe('true');

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(dropdown.hidden).toBe(true);

    input.dispatchEvent(new Event('focus'));
    input.dispatchEvent(new Event('blur'));
    expect(dropdown.hidden).toBe(true);

    input.dispatchEvent(new Event('focus'));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(dropdown.hidden).toBe(true);

    input.dispatchEvent(new Event('focus'));
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(dropdown.hidden).toBe(true);
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('não fecha ao usar uma ação dentro da própria lista', async () => {
    recordAnalyzedUrl('https://example.com/media');
    const { input, dropdown } = mount();
    input.dispatchEvent(new Event('focus'));

    dropdown.querySelector('[data-history-action="copy"]').click();
    await Promise.resolve();

    expect(dropdown.hidden).toBe(false);
  });
});
