/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadLocale } from '../../scripts/i18n.js';
import { store } from '../../scripts/state.js';
import { renderMediaContainer } from '../../scripts/renderer.js';

const mockLocales = {
  badge: {
    progressive: 'Arquivo direto',
    hls: 'HLS',
    dash: 'DASH',
    variants: '{count} variantes',
  },
  actions: {
    download: 'Download',
    preview: 'Visualizar',
    copy_link: 'Copiar Link',
    select_variant: 'Selecionar variante',
  },
  status: {
    found_count: '{count} mídia(s) encontrada(s)',
  },
  toast: {
    streaming_unsupported: 'Este formato de streaming ainda não é suportado para download.',
    download_started: 'Download iniciado.',
  },
  common: { na: 'N/A', unknown: 'Desconhecido', known_plus_unknown: '{size} + {count} desconhecido(s)' },
};

function item(id, delivery, variantCount = 0) {
  return {
    id,
    type: 'video',
    name: `${id}.mp4`,
    url: `https://cdn.example.com/${id}.mp4`,
    ext: 'mp4',
    label: 'video',
    size: 123,
    thumbnail: null,
    delivery,
    variantCount,
  };
}

async function render(items, selectedIds) {
  store.state.items = items;
  store.state.selectedItemIds = selectedIds || new Set();
  store.state.activeFilter = 'all';
  store.state.searchQuery = '';
  store.state.viewMode = 'grid';
  store.state.isAnalyzing = false;
  store.state.thumbBlurred = false;
  document.body.innerHTML = '<div id="media-container"></div>';
  renderMediaContainer();
  // Descarta rAF/lazy-size-fetch agendados (items já têm size).
  await new Promise(r => setTimeout(r, 10));
}

describe('selo de entrega nos cards', () => {
  beforeEach(async () => {
    store.state.lang = 'pt-BR';
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('/locales/')) {
        return { ok: true, json: async () => mockLocales };
      }
      return { ok: true, json: async () => ({}) };
    });
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
    await loadLocale('pt-BR');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('MP4 mostra "Arquivo direto"', async () => {
    await render([item('a1', 'progressive')]);

    const badge = document.querySelector('.media-badge');
    expect(badge).not.toBeNull();
    expect(badge.textContent).toBe('Arquivo direto');
    expect(badge.classList.contains('media-badge--progressive')).toBe(true);
  });

  it('HLS mostra "HLS"', async () => {
    await render([item('a2', 'hls')]);

    const badge = document.querySelector('.media-badge');
    expect(badge.textContent).toBe('HLS');
    expect(badge.classList.contains('media-badge--hls')).toBe(true);
  });

  it('DASH mostra "DASH"', async () => {
    await render([item('a3', 'dash')]);

    const badge = document.querySelector('.media-badge');
    expect(badge.textContent).toBe('DASH');
    expect(badge.classList.contains('media-badge--dash')).toBe(true);
  });

  it('item sem delivery não mostra selo', async () => {
    await render([item('a4', null), item('a5', undefined)]);

    expect(document.querySelectorAll('.media-badge')).toHaveLength(0);
    expect(document.querySelectorAll('.media-card')).toHaveLength(2);
  });

  it('campos e ações existentes continuam funcionando', async () => {
    await render([item('a6', 'progressive')]);
    const card = document.querySelector('.media-card');

    expect(card.querySelector('.card-title').textContent).toBe('a6.mp4');
    expect(card.querySelector('.card-badge-type').textContent).toBe('video');
    expect(card.querySelector('.card-checkbox')).not.toBeNull();
    expect(card.querySelector('.download-btn').textContent).toBe('Download');
    expect(card.querySelector('.preview-btn').textContent).toBe('Visualizar');
    expect(card.querySelector('.copy-link-btn')).not.toBeNull();

    const cb = card.querySelector('.card-checkbox');
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    expect(card.classList.contains('selected')).toBe(true);
    expect(store.state.selectedItemIds.has('a6')).toBe(true);
  });

  it('mantém o seletor de qualidade ao lado do nome e fora dos metadados', async () => {
    await render([{
      ...item('quality-heading', 'progressive'),
      qualities: [
        { label: '720p', url: 'https://cdn.example.com/720.mp4' },
        { label: '360p', url: 'https://cdn.example.com/360.mp4' },
      ],
    }]);

    const card = document.querySelector('.media-card');
    expect(card.querySelector('.card-heading > .quality-picker')).not.toBeNull();
    expect(card.querySelector('.card-meta .quality-picker')).toBeNull();
    expect(card.querySelector('.quality-picker summary').textContent).toBe('720p');

    card.querySelectorAll('.embedded-quality-choice')[1].click();
    expect(card.querySelector('.quality-picker summary').textContent).toBe('360p');
    expect(card.querySelector('.quality-picker summary').textContent).not.toContain('Qualidade');
  });

  it('abre o preview somente ao clicar na área da thumbnail', async () => {
    await render([{ ...item('click-preview', 'progressive'), type: 'image', proxyUrl: '/proxy/image' }]);

    document.querySelector('.card-media-preview').click();

    const modal = document.getElementById('preview-modal');
    expect(modal).not.toBeNull();
    expect(modal.classList.contains('open')).toBe(true);
    expect(modal.querySelector('#modal-title').textContent).toBe('click-preview.mp4');
  });

  it('não abre o preview ao clicar nas informações abaixo da thumbnail', async () => {
    await render([{ ...item('card-info', 'progressive'), type: 'image', proxyUrl: '/proxy/image' }]);

    document.querySelector('.card-title').click();
    document.querySelector('.card-meta').click();
    document.querySelector('.card-body').click();

    expect(document.getElementById('preview-modal')).toBeNull();
  });

  it('checkbox seleciona sem abrir o preview do card', async () => {
    await render([{ ...item('checkbox-only', 'progressive'), type: 'image', proxyUrl: '/proxy/image' }]);

    document.querySelector('.card-checkbox').click();

    expect(document.getElementById('preview-modal')).toBeNull();
    expect(store.state.selectedItemIds.has('checkbox-only')).toBe(true);
  });

  it('HLS não inicia download', async () => {
    await render([item('a7', 'hls')]);
    const downloadModule = await import('../../scripts/download.js');
    const spy = vi.spyOn(downloadModule, 'downloadSingleItem').mockResolvedValue();

    document.querySelector('.download-btn').click();

    expect(spy).not.toHaveBeenCalled();
    const toastText = document.querySelector('#toast-container .toast:last-child span:last-child').textContent;
    expect(toastText).toBe('Este formato de streaming ainda não é suportado para download.');
  });

  it('DASH não inicia download', async () => {
    await render([item('a8', 'dash')]);
    const downloadModule = await import('../../scripts/download.js');
    const spy = vi.spyOn(downloadModule, 'downloadSingleItem').mockResolvedValue();

    document.querySelector('.download-btn').click();

    expect(spy).not.toHaveBeenCalled();
    const toastText = document.querySelector('#toast-container .toast:last-child span:last-child').textContent;
    expect(toastText).toBe('Este formato de streaming ainda não é suportado para download.');
  });

  it('mensagem correta é exibida ao bloquear', async () => {
    await render([item('a9', 'hls')]);

    document.querySelector('.download-btn').click();

    const toast = document.querySelector('#toast-container .toast:last-child');
    expect(toast.textContent).toContain('Este formato de streaming ainda não é suportado para download.');
    expect(toast.classList.contains('toast-warning')).toBe(true);
  });

  it('MP4 continua baixando normalmente', async () => {
    await render([item('a10', 'progressive')]);
    const downloadModule = await import('../../scripts/download.js');
    const spy = vi.spyOn(downloadModule, 'downloadSingleItem').mockResolvedValue();

    document.querySelector('.download-btn').click();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].id).toBe('a10');
  });
});

describe('variantes sem selo redundante nos cards', () => {
  beforeEach(async () => {
    store.state.lang = 'pt-BR';
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('/locales/')) {
        return { ok: true, json: async () => mockLocales };
      }
      return { ok: true, json: async () => ({}) };
    });
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
    await loadLocale('pt-BR');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('grupo com 2 itens não mostra selo de variantes', async () => {
    await render([item('v1', 'progressive', 2), item('v2', 'progressive', 2)]);

    const badges = document.querySelectorAll('.media-badge--variants');
    expect(badges).toHaveLength(0);
  });

  it('grupo com 3 itens não mostra selo de variantes', async () => {
    await render([item('w1', 'progressive', 3), item('w2', 'progressive', 3), item('w3', 'progressive', 3)]);

    const badges = document.querySelectorAll('.media-badge--variants');
    expect(badges).toHaveLength(0);
  });

  it('grupo com item único não mostra selo', async () => {
    await render([item('s1', 'progressive', 1), item('s2', 'progressive', 1)]);

    expect(document.querySelectorAll('.media-badge--variants')).toHaveLength(0);
    expect(document.querySelectorAll('.media-card')).toHaveLength(2);
  });

  it('resposta sem groups não mostra selo', async () => {
    await render([item('g1', 'progressive')]);

    expect(document.querySelectorAll('.media-badge--variants')).toHaveLength(0);
    expect(document.querySelectorAll('.media-card')).toHaveLength(1);
  });

  it('ações dos cards continuam funcionando', async () => {
    await render([item('v5', 'progressive', 2), item('v6', 'progressive', 2)]);
    const downloadModule = await import('../../scripts/download.js');
    const spy = vi.spyOn(downloadModule, 'downloadSingleItem').mockResolvedValue();

    document.querySelector('.download-btn').click();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].id).toBe('v5');
    expect(document.querySelectorAll('.media-badge--variants')).toHaveLength(0);
  });
});

describe('colapso de variantes em um card por grupo', () => {
  beforeEach(async () => {
    store.state.lang = 'pt-BR';
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('/locales/')) {
        return { ok: true, json: async () => mockLocales };
      }
      return { ok: true, json: async () => ({}) };
    });
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
    await loadLocale('pt-BR');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  function variantItem(id, key, url, urls, extra = {}) {
    return {
      id,
      type: 'video',
      name: `${id}.mp4`,
      url,
      ext: 'mp4',
      label: 'video',
      size: 123,
      thumbnail: null,
      delivery: 'progressive',
      variantCount: urls.length,
      variantGroupKey: key,
      variantUrls: urls,
      ...extra,
    };
  }

  // Troca a variante pelo seletor do card colapsado do grupo `key`.
  function switchVariant(key, url) {
    const sel = document.querySelector(`.variant-select[data-key="${key}"]`);
    sel.value = url;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Re-render após troca passa pela animação de saída do card (150ms).
  const settle = () => new Promise(r => setTimeout(r, 250));

  it('grupo com 2 variantes vira um único card com o controle', async () => {
    const urls = ['https://cdn.example.com/movie-1080.mp4', 'https://cdn.example.com/movie-720.mp4'];
    await render(
      [variantItem('a1', 'k1', urls[0], urls), variantItem('a2', 'k1', urls[1], urls)],
      new Set(['a1'])
    );

    const cards = document.querySelectorAll('.media-card');
    expect(cards).toHaveLength(1);
    expect(cards[0].dataset.id).toBe('a1');

    const sel = cards[0].querySelector('.variant-select');
    expect(sel).not.toBeNull();
    expect(cards[0].querySelectorAll('.quality-choice')).toHaveLength(2);
    expect(cards[0].querySelector('.quality-choice.selected strong').textContent).toBe('video');
    expect(cards[0].querySelector('.quality-choice.selected small').textContent).toContain('MP4');
    expect(sel.querySelectorAll('option')).toHaveLength(3);
    expect(sel.querySelector('option[value=""]').textContent).toBe('Selecionar variante');
    expect(cards[0].querySelector('.media-badge--variants')).toBeNull();
  });

  it('grupo com 3 variantes vira um único card', async () => {
    const urls = ['https://cdn.example.com/movie-hd.mp4', 'https://cdn.example.com/movie-hq.mp4', 'https://cdn.example.com/movie-lq.mp4'];
    await render(
      [
        variantItem('a1', 'k1', urls[0], urls),
        variantItem('a2', 'k1', urls[1], urls),
        variantItem('a3', 'k1', urls[2], urls),
      ],
      new Set(['a2'])
    );

    const cards = document.querySelectorAll('.media-card');
    expect(cards).toHaveLength(1);
    expect(cards[0].dataset.id).toBe('a2');
    expect(cards[0].querySelector('.variant-select').querySelectorAll('option')).toHaveLength(4);
    expect(cards[0].querySelector('.media-badge--variants')).toBeNull();
  });

  it('escolher uma variante desmarca a anterior e troca o card', async () => {
    const urls = ['https://cdn.example.com/movie-1080.mp4', 'https://cdn.example.com/movie-720.mp4'];
    await render(
      [variantItem('a1', 'k1', urls[0], urls), variantItem('a2', 'k1', urls[1], urls)],
      new Set(['a1'])
    );

    switchVariant('k1', urls[1]);
    await settle();

    expect(store.state.selectedItemIds).toEqual(new Set(['a2']));
    const cards = document.querySelectorAll('.media-card');
    expect(cards).toHaveLength(1);
    expect(cards[0].dataset.id).toBe('a2');
    expect(cards[0].querySelector('.card-title').textContent).toBe('a2.mp4');
  });

  it('apenas uma variante permanece selecionada por grupo', async () => {
    const urls = ['https://cdn.example.com/movie-1080.mp4', 'https://cdn.example.com/movie-720.mp4'];
    await render(
      [variantItem('a1', 'k1', urls[0], urls), variantItem('a2', 'k1', urls[1], urls)],
      new Set(['a1'])
    );

    switchVariant('k1', urls[1]);
    await settle();

    const groupSelected = store.state.items
      .filter(i => i.variantGroupKey === 'k1')
      .filter(i => store.state.selectedItemIds.has(i.id));
    expect(groupSelected).toHaveLength(1);
    expect(groupSelected[0].id).toBe('a2');
  });

  it('grupos diferentes não interferem entre si', async () => {
    const urlsA = ['https://cdn.example.com/a-1080.mp4', 'https://cdn.example.com/a-720.mp4'];
    const urlsB = ['https://cdn.example.com/b-1080.mp4', 'https://cdn.example.com/b-720.mp4'];
    await render(
      [
        variantItem('a1', 'kA', urlsA[0], urlsA),
        variantItem('a2', 'kA', urlsA[1], urlsA),
        variantItem('b1', 'kB', urlsB[0], urlsB),
        variantItem('b2', 'kB', urlsB[1], urlsB),
      ],
      new Set(['a1', 'b1'])
    );

    expect(document.querySelectorAll('.media-card')).toHaveLength(2);

    switchVariant('kA', urlsA[1]);
    await settle();

    expect(store.state.selectedItemIds).toEqual(new Set(['a2', 'b1']));
    expect(document.querySelectorAll('.media-card')).toHaveLength(2);
  });

  it('item sem grupo não mostra controle', async () => {
    await render([item('x1', 'progressive')]);

    expect(document.querySelector('.variant-select')).toBeNull();
    expect(document.querySelectorAll('.media-card')).toHaveLength(1);
  });
});

describe('rótulos do seletor de variantes', () => {
  beforeEach(async () => {
    store.state.lang = 'pt-BR';
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('/locales/')) {
        return { ok: true, json: async () => mockLocales };
      }
      return { ok: true, json: async () => ({}) };
    });
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
    await loadLocale('pt-BR');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const URLS = ['https://cdn.example.com/movie-a.mp4', 'https://cdn.example.com/movie-b.mp4'];

  function labelItem(id, extra = {}) {
    return {
      id,
      type: 'video',
      name: `${id}.mp4`,
      url: URLS[id === 'a1' ? 0 : 1],
      ext: 'mp4',
      label: 'video',
      size: 0,
      thumbnail: null,
      delivery: 'progressive',
      variantCount: 2,
      variantGroupKey: 'kL',
      variantUrls: URLS,
      ...extra,
    };
  }

  function optionTexts() {
    const sel = document.querySelector('.variant-select');
    return [...sel.querySelectorAll('option:not([value=""])')].map(o => o.textContent);
  }

  it('usa quality quando existe', async () => {
    await render(
      [labelItem('a1', { quality: 'HD' }), labelItem('a2', { quality: 'LQ' })],
      new Set(['a1'])
    );

    expect(optionTexts()).toEqual(['HD', 'LQ']);
  });

  it('usa height como "1080p"', async () => {
    await render(
      [labelItem('a1', { height: 1080 }), labelItem('a2', { height: 720 })],
      new Set(['a1'])
    );

    expect(optionTexts()).toEqual(['1080p', '720p']);
  });

  it('usa resolução completa', async () => {
    await render(
      [labelItem('a1', { width: 1920, height: 1080 }), labelItem('a2', { width: 1280, height: 720 })],
      new Set(['a1'])
    );

    expect(optionTexts()).toEqual(['1920 × 1080', '1280 × 720']);
  });

  it('usa tamanho formatado', async () => {
    await render(
      [labelItem('a1', { size: 88290150 }), labelItem('a2', { size: 44145075 })],
      new Set(['a1'])
    );

    expect(optionTexts()).toEqual(['84.2 MB', '42.1 MB']);
  });

  it('usa nome como fallback', async () => {
    await render(
      [labelItem('a1'), labelItem('a2')],
      new Set(['a1'])
    );

    expect(optionTexts()).toEqual(['a1.mp4', 'a2.mp4']);
  });

  it('troca de variante continua funcionando', async () => {
    await render(
      [labelItem('a1', { quality: 'HD' }), labelItem('a2', { quality: 'LQ' })],
      new Set(['a1'])
    );

    const sel = document.querySelector('.variant-select');
    sel.value = URLS[1];
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 250));

    expect(store.state.selectedItemIds.has('a1')).toBe(false);
    expect(store.state.selectedItemIds.has('a2')).toBe(true);
    const card = document.querySelector('.media-card');
    expect(card.dataset.id).toBe('a2');
    expect(card.querySelector('.variant-select')).not.toBeNull();
    expect(optionTexts()).toEqual(['HD', 'LQ']);
  });
});

describe('renderização durante transições rápidas', () => {
  beforeEach(async () => {
    store.state.lang = 'pt-BR';
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('/locales/')) return { ok: true, json: async () => mockLocales };
      return { ok: true, json: async () => ({}) };
    });
    globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);
    globalThis.cancelAnimationFrame = id => clearTimeout(id);
    await loadLocale('pt-BR');
    await render([item('alpha', 'progressive'), item('beta', 'progressive')]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('estado vazio não é sobrescrito por um timer de render antigo', async () => {
    store.state.searchQuery = 'alpha';
    renderMediaContainer();
    store.state.searchQuery = 'sem-resultado';
    renderMediaContainer();

    expect(document.querySelector('.empty-state')).not.toBeNull();
    await new Promise(resolve => setTimeout(resolve, 220));
    expect(document.querySelector('.empty-state')).not.toBeNull();
    expect(document.querySelectorAll('.media-card')).toHaveLength(0);
  });

  it('debounce renderiza somente o estado mais recente', async () => {
    store.state.searchQuery = 'alpha';
    renderMediaContainer();
    store.state.searchQuery = 'beta';
    renderMediaContainer();
    store.state.viewMode = 'list';
    renderMediaContainer();

    await new Promise(resolve => setTimeout(resolve, 220));
    const cards = document.querySelectorAll('.media-card');
    expect(cards).toHaveLength(1);
    expect(cards[0].dataset.id).toBe('beta');
    expect(document.getElementById('media-container').classList.contains('list-view')).toBe(true);
  });
});
