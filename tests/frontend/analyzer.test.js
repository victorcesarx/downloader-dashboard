/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadLocale } from '../../scripts/i18n.js';
import { store } from '../../scripts/state.js';
import {
  ANALYZE_CACHE_MAX_BYTES,
  ANALYZE_CACHE_SCHEMA_VERSION,
  ANALYZE_CACHE_TTL_MS,
  analyzeUrl,
} from '../../scripts/analyzer.js';

const mockLocales = {
  toast: {
    analyzed_success: 'Mídias extraídas com sucesso!',
    invalid_url: 'URL inválida',
    download_started: 'Download iniciado.',
  },
  status: { error: 'Ocorreu um erro ao processar o link. Verifique a URL e tente novamente.' },
  common: { media_fallback: 'Mídia {n}' },
};

function mockResponse({ ok, data, status = 200 }) {
  return {
    ok,
    status,
    json: async () => (ok ? data : { error: 'server error' }),
  };
}

describe('analyzeUrl sem mode', () => {
  beforeEach(async () => {
    store.state.lang = 'pt-BR';
    store.state.items = [];
    store.state.selectedItemIds = new Set();
    store.state.isAnalyzing = false;
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('/locales/')) {
        return { ok: true, json: async () => mockLocales };
      }
      return mockResponse({
        ok: true,
        data: {
          url: 'https://example.com/page',
          items: [{ type: 'video', name: 'clip.mp4', url: 'https://cdn.example.com/clip.mp4', ext: 'mp4' }],
        },
      });
    });
    await loadLocale('pt-BR');
    sessionStorage.removeItem('analyze_cache');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  function analyzeCall() {
    return globalThis.fetch.mock.calls.find(c => String(c[0]).endsWith('/analyze'));
  }

  it('requisição não inclui mais mode', async () => {
    await analyzeUrl('https://example.com/page');

    const call = analyzeCall();
    expect(call).toBeDefined();
    const body = JSON.parse(call[1].body);
    expect(body).not.toHaveProperty('mode');
  });

  it('URL continua sendo enviada', async () => {
    await analyzeUrl('https://example.com/page');

    const body = JSON.parse(analyzeCall()[1].body);
    expect(body.url).toBe('https://example.com/page');
    expect(body.lang).toBe('pt-BR');
  });

  it('tratamento de sucesso permanece igual', async () => {
    const data = await analyzeUrl('https://example.com/page');

    expect(data).not.toBeNull();
    expect(store.state.items).toHaveLength(1);
    expect(store.state.items[0].name).toBe('clip.mp4');
    expect(store.state.isAnalyzing).toBe(false);
    const toast = document.querySelector('#toast-container .toast:last-child span:last-child');
    expect(toast.textContent).toBe('Mídias extraídas com sucesso!');
  });

  it('grava envelope versionado e reutiliza a entrada atual', async () => {
    await analyzeUrl('https://example.com/page');
    await analyzeUrl('https://example.com/page');

    const cache = JSON.parse(sessionStorage.getItem('analyze_cache'));
    expect(cache.schemaVersion).toBe(ANALYZE_CACHE_SCHEMA_VERSION);
    expect(cache.entries['https://example.com/page']).toMatchObject({
      cachedAt: expect.any(Number),
      data: { items: expect.any(Array) },
    });
    expect(globalThis.fetch.mock.calls.filter(c => String(c[0]).endsWith('/analyze'))).toHaveLength(1);
  });

  it('não reutiliza nem persiste resultados vazios', async () => {
    globalThis.fetch.mockImplementation(async url => {
      if (String(url).includes('/locales/')) return { ok: true, json: async () => mockLocales };
      return mockResponse({ ok: true, data: { items: [] } });
    });
    await analyzeUrl('https://example.com/empty');
    await analyzeUrl('https://example.com/empty');
    expect(globalThis.fetch.mock.calls.filter(call => String(call[0]).endsWith('/analyze'))).toHaveLength(2);
    expect(sessionStorage.getItem('analyze_cache')).toBeNull();
  });

  it('carrega thumbnails HTTP pelo proxy e preserva URLs locais', async () => {
    globalThis.fetch.mockImplementation(async url => {
      if (String(url).includes('/locales/')) return { ok: true, json: async () => mockLocales };
      return mockResponse({ ok: true, data: { items: [{
        type: 'video', url: 'https://cdn.example/video.mp4', thumbnail: 'https://images.example/poster.jpg',
        qualities: [{ label: '720p', url: 'https://cdn.example/720.mp4', thumbnail: 'https://images.example/720.jpg' }],
      }] } });
    });
    await analyzeUrl('https://example.com/thumbs');
    expect(store.state.items[0].thumbnail).toContain('/proxy?url=https%3A%2F%2Fimages.example%2Fposter.jpg');
    expect(store.state.items[0].qualities[0].thumbnail).toContain('/proxy?url=https%3A%2F%2Fimages.example%2F720.jpg');
  });

  it('migra o cache legado válido sem refazer a análise', async () => {
    const legacyData = {
      items: [{ type: 'video', name: 'legacy.mp4', url: 'https://cdn.example/legacy.mp4' }],
    };
    sessionStorage.setItem('analyze_cache', JSON.stringify({ 'https://example.com/legacy': legacyData }));

    await analyzeUrl('https://example.com/legacy');

    expect(analyzeCall()).toBeUndefined();
    expect(store.state.items[0].name).toBe('legacy.mp4');
    expect(JSON.parse(sessionStorage.getItem('analyze_cache')).schemaVersion).toBe(ANALYZE_CACHE_SCHEMA_VERSION);
  });

  it('invalida entrada expirada e consulta novamente', async () => {
    const data = { items: [{ url: 'https://cdn.example/old.mp4' }] };
    sessionStorage.setItem('analyze_cache', JSON.stringify({
      schemaVersion: ANALYZE_CACHE_SCHEMA_VERSION,
      entries: { 'https://example.com/page': { cachedAt: Date.now() - ANALYZE_CACHE_TTL_MS - 1, data } },
    }));

    await analyzeUrl('https://example.com/page');
    expect(analyzeCall()).toBeDefined();
  });

  it('ignora cache corrompido e contrato inválido', async () => {
    sessionStorage.setItem('analyze_cache', '{invalid');
    await analyzeUrl('https://example.com/page');
    expect(analyzeCall()).toBeDefined();

    sessionStorage.setItem('analyze_cache', JSON.stringify({
      schemaVersion: ANALYZE_CACHE_SCHEMA_VERSION,
      entries: { 'https://example.com/invalid': { cachedAt: Date.now(), data: { items: [{}] } } },
    }));
    await analyzeUrl('https://example.com/invalid');
    expect(globalThis.fetch.mock.calls.filter(c => String(c[0]).endsWith('/analyze'))).toHaveLength(2);
  });

  it('não persiste uma entrada que exceda o limite em bytes', async () => {
    globalThis.fetch.mockImplementation(async url => {
      if (String(url).includes('/locales/')) return { ok: true, json: async () => mockLocales };
      return mockResponse({
        ok: true,
        data: { items: [{ url: 'https://cdn.example/huge.mp4', name: 'x'.repeat(ANALYZE_CACHE_MAX_BYTES + 10) }] },
      });
    });
    await analyzeUrl('https://example.com/huge');
    expect(JSON.parse(sessionStorage.getItem('analyze_cache')).entries).toEqual({});
  });

  it('mantém somente as 10 análises mais recentes', async () => {
    for (let index = 0; index < 12; index += 1) {
      await analyzeUrl(`https://example.com/page-${index}`);
    }
    const entries = JSON.parse(sessionStorage.getItem('analyze_cache')).entries;
    expect(Object.keys(entries)).toHaveLength(10);
    expect(entries['https://example.com/page-0']).toBeUndefined();
    expect(entries['https://example.com/page-11']).toBeDefined();
  });

  it('tratamento de erro permanece igual', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('/locales/')) {
        return { ok: true, json: async () => mockLocales };
      }
      return mockResponse({ ok: false, data: null, status: 500 });
    });

    const result = await analyzeUrl('https://example.com/page');

    expect(result).toBeNull();
    expect(store.state.items).toEqual([]);
    expect(store.state.isAnalyzing).toBe(false);
    const toast = document.querySelector('#toast-container .toast:last-child span:last-child');
    expect(toast.textContent).toBe('server error');
  });

  it('aplica a qualidade preferida quando a variante existe', async () => {
    store.state.preferredQuality = '720p';
    globalThis.fetch = vi.fn(async url => {
      if (String(url).includes('/locales/')) return { ok: true, json: async () => mockLocales };
      return mockResponse({ ok: true, data: { items: [{
        type: 'video', name: 'clip.mp4', url: 'https://cdn.example/original.mp4',
        qualities: [
          { label: '1080p', url: 'https://cdn.example/1080.mp4', height: 1080 },
          { label: '720p', url: 'https://cdn.example/720.mp4', height: 720 },
        ],
      }] } });
    });
    await analyzeUrl('https://example.com/quality');
    expect(store.state.items[0]).toMatchObject({ selectedQualityIndex: 1, url: 'https://cdn.example/720.mp4' });
    store.state.preferredQuality = 'best';
  });
});

describe('pré-seleção de melhor variante via groups', () => {
  const BEST_URL = 'https://cdn.example.com/video-1080p.mp4';
  const LOW_URL = 'https://cdn.example.com/video-720p.mp4';
  const SOLO_URL = 'https://cdn.example.com/solo.mp4';

  const media = (url) => ({
    type: 'video', name: url.split('/').pop(), url, ext: 'mp4',
  });

  it('aplica a preferência padrão aos grupos quando há metadados compatíveis', async () => {
    store.state.preferredQuality = '720p';
    globalThis.fetch = vi.fn(async url => {
      if (String(url).includes('/locales/')) return { ok: true, json: async () => mockLocales };
      return mockResponse({ ok: true, data: {
        items: [
          { ...media(BEST_URL), quality: '1080p', height: 1080 },
          { ...media(LOW_URL), quality: '720p', height: 720 },
        ],
        groups: [{ key: 'video', itemUrls: [BEST_URL, LOW_URL], bestItemUrl: BEST_URL }],
      } });
    });

    await analyzeUrl('https://example.com/preferred-group');
    const selected = store.state.items.find(item => store.state.selectedItemIds.has(item.id));
    expect(selected.sourceUrl).toBe(LOW_URL);
    store.state.preferredQuality = 'best';
  });

  function stubAnalyze(data) {
    globalThis.fetch = vi.fn(async (u) => {
      if (String(u).includes('/locales/')) return { ok: true, json: async () => mockLocales };
      return mockResponse({ ok: true, data });
    });
  }

  beforeEach(async () => {
    store.state.lang = 'pt-BR';
    store.state.items = [];
    store.state.selectedItemIds = new Set();
    await loadLocale('pt-BR');
    sessionStorage.removeItem('analyze_cache');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('melhor variante é selecionada', async () => {
    stubAnalyze({
      url: 'https://example.com/page',
      items: [media(BEST_URL), media(LOW_URL)],
      groups: [{ key: 'cdn.example.com/video.mp4', bestItemUrl: BEST_URL, itemUrls: [BEST_URL, LOW_URL] }],
    });

    await analyzeUrl('https://example.com/page');

    const best = store.state.items.find(i => i.url === BEST_URL);
    expect(store.state.selectedItemIds).toEqual(new Set([best.id]));
  });

  it('variante inferior fica visível e não selecionada', async () => {
    stubAnalyze({
      url: 'https://example.com/page',
      items: [media(BEST_URL), media(LOW_URL)],
      groups: [{ key: 'cdn.example.com/video.mp4', bestItemUrl: BEST_URL, itemUrls: [BEST_URL, LOW_URL] }],
    });

    await analyzeUrl('https://example.com/page');

    expect(store.state.items).toHaveLength(2);
    const low = store.state.items.find(i => i.url === LOW_URL);
    expect(low).toBeDefined();
    expect(store.state.selectedItemIds.has(low.id)).toBe(false);
  });

  it('grupos de item único são selecionados', async () => {
    stubAnalyze({
      url: 'https://example.com/page',
      items: [media(SOLO_URL), media(LOW_URL)],
      groups: [{ key: 'cdn.example.com/solo.mp4', bestItemUrl: SOLO_URL, itemUrls: [SOLO_URL] }],
    });

    await analyzeUrl('https://example.com/page');

    const solo = store.state.items.find(i => i.url === SOLO_URL);
    expect(store.state.selectedItemIds).toEqual(new Set([solo.id]));
  });

  it('resposta sem groups mantém comportamento antigo', async () => {
    stubAnalyze({ url: 'https://example.com/page', items: [media(BEST_URL), media(LOW_URL)] });

    await analyzeUrl('https://example.com/page');

    expect(store.state.items).toHaveLength(2);
    expect(store.state.selectedItemIds).toEqual(new Set());
  });

  it('URLs desconhecidas em groups são ignoradas', async () => {
    stubAnalyze({
      url: 'https://example.com/page',
      items: [media(BEST_URL)],
      groups: [
        { key: 'cdn.example.com/video.mp4', bestItemUrl: BEST_URL, itemUrls: [BEST_URL] },
        { key: 'cdn.example.com/ghost.mp4', bestItemUrl: 'https://cdn.example.com/ghost.mp4', itemUrls: ['https://cdn.example.com/ghost.mp4'] },
      ],
    });

    await analyzeUrl('https://example.com/page');

    const best = store.state.items.find(i => i.url === BEST_URL);
    expect(store.state.selectedItemIds).toEqual(new Set([best.id]));
  });
});
