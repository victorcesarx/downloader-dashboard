/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { t, translateDOM, loadLocale, onLocaleChange } from '../../scripts/i18n.js';
import { store } from '../../scripts/state.js';

const mockLocales = {
  'pt-BR': {
    app: { title: 'WebScope', subtitle: 'Downloader Dashboard' },
    status: { analyzing: 'Analisando...', error: 'Erro' },
    toast: { success: 'Sucesso!', invalid_url: 'URL inválida' },
    filters: { all: 'Todas as mídias' },
    greeting: 'Olá, {name}!',
    file_count: '{n} arquivos',
  },
};

function mockFetch() {
  globalThis.fetch = vi.fn((url) => {
    const match = url.match(/\/locales\/(.+)\.json$/);
    const lang = match ? match[1] : null;
    const data = mockLocales[lang];
    if (data) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(data),
      });
    }
    return Promise.resolve({
      ok: false,
      json: () => Promise.resolve({}),
    });
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('t()', () => {
  beforeEach(async () => {
    mockFetch();
    store.state.lang = 'pt-BR';
    await loadLocale('pt-BR');
  });

  it('resolves simple keys', () => {
    expect(t('app.title')).toBe('WebScope');
  });

  it('resolves nested keys', () => {
    expect(t('status.analyzing')).toBe('Analisando...');
    expect(t('toast.success')).toBe('Sucesso!');
  });

  it('returns the key as fallback when key is not found', () => {
    expect(t('nonexistent.key')).toBe('nonexistent.key');
  });

  it('interpolates parameters', () => {
    expect(t('greeting', { name: 'João' })).toBe('Olá, João!');
    expect(t('file_count', { n: 5 })).toBe('5 arquivos');
  });

  it('returns key for missing translations even with params', () => {
    expect(t('missing.key', { x: 1 })).toBe('missing.key');
  });
});

describe('loadLocale', () => {
  it('loads from fetch when available', async () => {
    mockFetch();
    const result = await loadLocale('pt-BR');
    expect(result).toBe(true);
    expect(document.documentElement.lang).toBe('pt-BR');
  });

  it('notifica listeners depois de carregar e permite unsubscribe', async () => {
    mockFetch();
    const listener = vi.fn();
    const unsubscribe = onLocaleChange(listener);
    await loadLocale('pt-BR');
    expect(listener).toHaveBeenCalledWith('pt-BR');
    unsubscribe();
    await loadLocale('pt-BR');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('falls back to "en" when locale fails to load', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false }));
    const result = await loadLocale('invalid');
    expect(result).toBe(false);
  });
});

describe('translateDOM', () => {
  beforeEach(async () => {
    document.body.innerHTML = '';
    mockFetch();
    store.state.lang = 'pt-BR';
    await loadLocale('pt-BR');
  });

  it('translates elements with data-i18n attribute', () => {
    document.body.innerHTML = '<h1 data-i18n="app.title"></h1>';
    translateDOM();
    expect(document.querySelector('h1').textContent).toBe('WebScope');
  });

  it('translates elements with data-i18n-placeholder', () => {
    document.body.innerHTML = '<input data-i18n-placeholder="status.analyzing">';
    translateDOM();
    expect(document.querySelector('input').placeholder).toBe('Analisando...');
  });

  it('translates elements with data-i18n-aria-label', () => {
    document.body.innerHTML = '<button data-i18n-aria-label="toast.success"></button>';
    translateDOM();
    expect(document.querySelector('button').getAttribute('aria-label')).toBe('Sucesso!');
  });

  it('does not error when no translatable elements exist', () => {
    document.body.innerHTML = '<div>No i18n here</div>';
    expect(() => translateDOM()).not.toThrow();
  });
});
