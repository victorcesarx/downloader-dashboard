import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scrapeGeneric, candidateToMediaItem, mediaItemToLegacy, annotateVariantMetadata, buildVariantGroups } from '../../server/scrapers/generic.js';
import { buildMediaCandidates } from '../../server/media/build-media-candidates.js';

function mockFetch(html) {
  // fetchText exige corpo com pelo menos 50 caracteres.
  const body = `<html><head><title>Teste</title></head><body>${html}</body></html>`;
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => body,
  }));
}

const byUrl = (items, url) => items.find(i => i.url === url);
const urls = (items) => items.map(i => i.url);

describe('scrapeGeneric com buildMediaCandidates', () => {
  beforeEach(() => mockFetch(''));
  afterEach(() => vi.restoreAllMocks());

  it('URL relativa passa a funcionar', async () => {
    mockFetch('<img src="pic.jpg">');
    const { items } = await scrapeGeneric('https://example.com/dir/page.html');

    expect(items).toHaveLength(1);
    expect(items[0].url).toBe('https://example.com/dir/pic.jpg');
    expect(items[0].type).toBe('image');
  });

  it('srcset entra no resultado', async () => {
    mockFetch('<img srcset="a.jpg 480w, b.jpg 1080w">');
    const { items } = await scrapeGeneric('https://example.com/page.html');

    expect(urls(items)).toEqual(['https://example.com/a.jpg', 'https://example.com/b.jpg']);
    expect(items.every(i => i.type === 'image')).toBe(true);
  });

  it('Open Graph entra no resultado', async () => {
    mockFetch('<meta property="og:video" content="https://cdn.example.com/clip.mp4">');
    const { items } = await scrapeGeneric('https://example.com/page.html');

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ url: 'https://cdn.example.com/clip.mp4', type: 'video', ext: 'mp4' });
  });

  it('JSON-LD entra no resultado', async () => {
    mockFetch('<script type="application/ld+json">{"contentUrl":"https://cdn.example.com/song.mp3"}</script>');
    const { items } = await scrapeGeneric('https://example.com/page.html');

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ url: 'https://cdn.example.com/song.mp3', type: 'audio', ext: 'mp3' });
  });

  it('duplicatas são removidas', async () => {
    mockFetch('<img src="https://cdn.example.com/dup.jpg"><meta property="og:image" content="https://cdn.example.com/dup.jpg">');
    const { items } = await scrapeGeneric('https://example.com/page.html');

    expect(items).toHaveLength(1);
  });

  it('formato externo permanece compatível', async () => {
    mockFetch('<video src="https://cdn.example.com/c.mp4"></video>');
    const { items } = await scrapeGeneric('https://example.com/page.html');

    expect(items).toEqual([
      {
        type: 'video',
        name: 'c.mp4',
        url: 'https://cdn.example.com/c.mp4',
        ext: 'mp4',
        label: 'video',
        size: 0,
        thumbnail: null,
        delivery: 'progressive',
      },
    ]);
    // Nenhum campo de MediaItem nesta etapa.
    expect(items[0].id).toBeUndefined();
    expect(items[0].mimeType).toBeUndefined();
    expect(items[0].width).toBeUndefined();
  });

  it('classifica vídeo, imagem, áudio e documento no mesmo HTML', async () => {
    mockFetch(`
      <video src="https://cdn.example.com/clip.mp4"></video>
      <img src="https://cdn.example.com/foto.jpg">
      <audio src="https://cdn.example.com/som.mp3"></audio>
      <a href="https://cdn.example.com/doc.pdf">x</a>
    `);
    const { items } = await scrapeGeneric('https://example.com/page.html');

    expect(items).toHaveLength(4);
    expect(byUrl(items, 'https://cdn.example.com/clip.mp4').type).toBe('video');
    expect(byUrl(items, 'https://cdn.example.com/foto.jpg').type).toBe('image');
    expect(byUrl(items, 'https://cdn.example.com/som.mp3').type).toBe('audio');
    expect(byUrl(items, 'https://cdn.example.com/doc.pdf').type).toBe('document');
  });

  const candidate = { type: 'video', url: 'https://cdn.example.com/clip.mp4', extension: 'mp4' };

  it('item interno válido passa por createMediaItem', () => {
    const item = candidateToMediaItem(candidate, null);

    expect(item).toEqual({
      id: candidate.url,
      type: 'video',
      name: 'clip.mp4',
      url: candidate.url,
      mimeType: null,
      extension: 'mp4',
      size: null,
      width: null,
      height: null,
      duration: null,
      container: null,
      quality: null,
      thumbnail: null,
      delivery: 'progressive',
      source: 'generic:html',
      confidenceScore: 80,
      confidenceReasons: ['source:html'],
    });
  });

  it('campos opcionais ficam null', () => {
    const item = candidateToMediaItem({ ...candidate, type: 'image' }, null);

    expect(item.mimeType).toBeNull();
    expect(item.size).toBeNull();
    expect(item.width).toBeNull();
    expect(item.height).toBeNull();
    expect(item.duration).toBeNull();
    expect(item.quality).toBeNull();
    expect(item.delivery).toBeNull();
  });

  it('source default é generic:html', () => {
    const item = candidateToMediaItem(candidate, 'https://cdn.example.com/og.jpg');

    expect(item.source).toBe('generic:html');
    expect(item.thumbnail).toBe('https://cdn.example.com/og.jpg');
  });

  it('continua encontrando mídia em scripts', async () => {
    mockFetch('<script>var src="https://cdn.example.com/script-movie.mp4";</script>');
    const { items } = await scrapeGeneric('https://example.com/page.html');

    expect(items).toEqual([
      {
        type: 'video',
        name: 'script-movie.mp4',
        url: 'https://cdn.example.com/script-movie.mp4',
        ext: 'mp4',
        label: 'video',
        size: 0,
        thumbnail: null,
        delivery: 'progressive',
      },
    ]);
  });

  it('MP4 expõe delivery progressive', async () => {
    mockFetch('<video src="https://cdn.example.com/clip.mp4"></video>');
    const { items } = await scrapeGeneric('https://example.com/page.html');

    expect(items[0].delivery).toBe('progressive');
  });

  it('M3U8 expõe delivery hls', async () => {
    mockFetch('<video src="https://cdn.example.com/live.m3u8"></video>');
    const { items } = await scrapeGeneric('https://example.com/page.html');

    expect(items[0].delivery).toBe('hls');
  });

  it('MPD expõe delivery dash', async () => {
    mockFetch('<video src="https://cdn.example.com/stream.mpd"></video>');
    const { items } = await scrapeGeneric('https://example.com/page.html');

    expect(items[0].delivery).toBe('dash');
  });

  it('imagem expõe delivery null', async () => {
    mockFetch('<img src="https://cdn.example.com/foto.jpg">');
    const { items } = await scrapeGeneric('https://example.com/page.html');

    expect(items[0].delivery).toBeNull();
  });

  it('campos antigos permanecem iguais', async () => {
    mockFetch(`
      <video src="https://cdn.example.com/clip.mp4"></video>
      <img src="https://cdn.example.com/foto.jpg">
    `);
    const { items } = await scrapeGeneric('https://example.com/page.html');

    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(
        ['delivery', 'ext', 'label', 'name', 'size', 'thumbnail', 'type', 'url'].sort()
      );
      expect(item.type).toBeDefined();
      expect(item.name).toBeDefined();
      expect(item.url).toBeDefined();
      expect(typeof item.ext).toBe('string');
      expect(item.label).toBe(item.type);
      expect(item.size).toBe(0);
    }
    expect(byUrl(items, 'https://cdn.example.com/clip.mp4').thumbnail).toBeNull();
    expect(byUrl(items, 'https://cdn.example.com/foto.jpg').thumbnail).toBeNull();
  });

  it('saída pública permanece igual', async () => {
    mockFetch('<video src="https://cdn.example.com/clip.mp4"></video>');
    const { items } = await scrapeGeneric('https://example.com/page.html');

    expect(Object.keys(items[0]).sort()).toEqual(
      ['delivery', 'ext', 'label', 'name', 'size', 'thumbnail', 'type', 'url'].sort()
    );
    expect(mediaItemToLegacy(candidateToMediaItem(candidate, null))).toEqual({
      type: 'video',
      name: 'clip.mp4',
      url: 'https://cdn.example.com/clip.mp4',
      ext: 'mp4',
      label: 'video',
      size: 0,
      thumbnail: null,
      delivery: 'progressive',
    });
  });
});

describe('origem do candidato (source) no MediaItem', () => {
  function itemFromHtml(html) {
    return buildMediaCandidates(html, 'https://example.com/page.html')
      .map(c => candidateToMediaItem(c, null));
  }

  it('candidato HTML comum usa generic:html', () => {
    const [item] = itemFromHtml('<video src="https://cdn.example.com/clip.mp4"></video>');

    expect(item.source).toBe('generic:html');
  });

  it('srcset usa generic:srcset', () => {
    const [item] = itemFromHtml('<img srcset="https://cdn.example.com/a.jpg 480w">');

    expect(item.source).toBe('generic:srcset');
  });

  it('Open Graph usa generic:meta', () => {
    const [item] = itemFromHtml('<meta property="og:video" content="https://cdn.example.com/clip.mp4">');

    expect(item.source).toBe('generic:meta');
  });

  it('JSON-LD usa generic:json-ld', () => {
    const [item] = itemFromHtml('<script type="application/ld+json">{"contentUrl":"https://cdn.example.com/song.mp3"}</script>');

    expect(item.source).toBe('generic:json-ld');
  });

  it('style usa generic:style', () => {
    const [item] = itemFromHtml('<div style="background-image:url(https://cdn.example.com/bg.jpg)"></div>');

    expect(item.source).toBe('generic:style');
  });

  it('script usa generic:script', () => {
    const [item] = itemFromHtml('<script>var src="https://cdn.example.com/script-movie.mp4";</script>');

    expect(item.source).toBe('generic:script');
  });

  it('candidato meta recebe confiança 90', () => {
    const [item] = itemFromHtml('<meta property="og:video" content="https://cdn.example.com/clip.mp4">');

    expect(item.confidenceScore).toBe(90);
    expect(item.confidenceReasons).toEqual(['source:meta']);
  });

  it('candidato style recebe confiança 40', () => {
    const [item] = itemFromHtml('<div style="background-image:url(https://cdn.example.com/bg.jpg)"></div>');

    expect(item.confidenceScore).toBe(40);
    expect(item.confidenceReasons).toEqual(['source:style']);
  });

  it('saída pública não expõe confiança', async () => {
    mockFetch(`
      <meta property="og:video" content="https://cdn.example.com/clip.mp4">
      <div style="background-image:url(https://cdn.example.com/bg.jpg)"></div>
    `);
    const { items } = await scrapeGeneric('https://example.com/page.html');

    for (const item of items) {
      expect(item).not.toHaveProperty('confidenceScore');
      expect(item).not.toHaveProperty('confidenceReasons');
    }
  });
});

describe('variantes no scraper genérico', () => {
  function variantItem(url, height) {
    const item = candidateToMediaItem({ url, type: 'video', extension: 'mp4' }, null);
    item.height = height ?? null;
    return item;
  }

  it('1080p e 720p ficam no mesmo grupo', () => {
    const items = annotateVariantMetadata([
      variantItem('https://cdn.example.com/video-1080p.mp4?token=a', 1080),
      variantItem('https://cdn.example.com/video-720p.mp4?token=b', 720),
    ]);

    expect(items[0].variantGroupKey).toBe('cdn.example.com/video.mp4');
    expect(items[1].variantGroupKey).toBe(items[0].variantGroupKey);
  });

  it('1080p é marcada como melhor quando height é maior', () => {
    const items = annotateVariantMetadata([
      variantItem('https://cdn.example.com/video-720p.mp4', 720),
      variantItem('https://cdn.example.com/video-1080p.mp4', 1080),
    ]);

    expect(items.find(i => i.height === 1080).isBestVariant).toBe(true);
    expect(items.find(i => i.height === 720).isBestVariant).toBe(false);
  });

  it('apenas uma variante é marcada por grupo', () => {
    const items = annotateVariantMetadata([
      variantItem('https://cdn.example.com/video-720p.mp4', 720),
      variantItem('https://cdn.example.com/video-1080p.mp4', 1080),
      variantItem('https://cdn.example.com/video-480p.mp4', 480),
      variantItem('https://cdn.example.com/song.mp3'),
    ]);

    const videoGroup = items.filter(i => i.variantGroupKey === 'cdn.example.com/video.mp4');
    expect(videoGroup).toHaveLength(3);
    expect(videoGroup.filter(i => i.isBestVariant)).toHaveLength(1);
    expect(videoGroup.find(i => i.isBestVariant).height).toBe(1080);

    const audioGroup = items.filter(i => i.variantGroupKey === 'cdn.example.com/song.mp3');
    expect(audioGroup.filter(i => i.isBestVariant)).toHaveLength(1);
  });

  it('grupo com chave nula recebe variantGroupKey null', () => {
    const invalid = candidateToMediaItem({ url: 'not a url', type: 'video', extension: 'mp4' }, null);
    const items = annotateVariantMetadata([invalid]);

    expect(items[0].variantGroupKey).toBeNull();
    expect(items[0].isBestVariant).toBe(true);
  });

  it('saída pública continua idêntica', async () => {
    mockFetch('<video src="https://cdn.example.com/video-1080p.mp4"></video><video src="https://cdn.example.com/video-720p.mp4"></video>');
    const { items } = await scrapeGeneric('https://example.com/page.html');

    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(
        ['delivery', 'ext', 'label', 'name', 'size', 'thumbnail', 'type', 'url'].sort()
      );
      expect(item).not.toHaveProperty('variantGroupKey');
      expect(item).not.toHaveProperty('isBestVariant');
    }
  });
});

describe('grupos na resposta do scraper genérico', () => {
  function variantItem(url, height) {
    const item = candidateToMediaItem({ url, type: 'video', extension: 'mp4' }, null);
    item.height = height ?? null;
    return item;
  }

  it('grupo com 1080p e 720p', async () => {
    mockFetch('<video src="https://cdn.example.com/video-1080p.mp4"></video><video src="https://cdn.example.com/video-720p.mp4"></video>');
    const { items, groups } = await scrapeGeneric('https://example.com/page.html');

    expect(items).toHaveLength(2);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('cdn.example.com/video.mp4');
    expect(groups[0].itemUrls).toEqual([
      'https://cdn.example.com/video-1080p.mp4',
      'https://cdn.example.com/video-720p.mp4',
    ]);
  });

  it('bestItemUrl aponta para a melhor variante', () => {
    const items = annotateVariantMetadata([
      variantItem('https://cdn.example.com/video-720p.mp4', 720),
      variantItem('https://cdn.example.com/video-1080p.mp4', 1080),
    ]);

    const groups = buildVariantGroups(items);

    expect(groups[0].bestItemUrl).toBe('https://cdn.example.com/video-1080p.mp4');
  });

  it('ordem de itemUrls preservada', () => {
    const items = annotateVariantMetadata([
      variantItem('https://cdn.example.com/video-720p.mp4', 720),
      variantItem('https://cdn.example.com/video-1080p.mp4', 1080),
      variantItem('https://cdn.example.com/video-480p.mp4', 480),
    ]);

    const groups = buildVariantGroups(items);

    expect(groups[0].itemUrls).toEqual([
      'https://cdn.example.com/video-720p.mp4',
      'https://cdn.example.com/video-1080p.mp4',
      'https://cdn.example.com/video-480p.mp4',
    ]);
  });

  it('grupo único aparece', async () => {
    mockFetch('<video src="https://cdn.example.com/solo.mp4"></video>');
    const { groups } = await scrapeGeneric('https://example.com/page.html');

    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual({
      key: 'cdn.example.com/solo.mp4',
      bestItemUrl: 'https://cdn.example.com/solo.mp4',
      itemUrls: ['https://cdn.example.com/solo.mp4'],
    });
  });

  it('grupo com chave nula aparece com key null', () => {
    const invalid = candidateToMediaItem({ url: 'not a url', type: 'video', extension: 'mp4' }, null);
    const items = annotateVariantMetadata([invalid]);

    const groups = buildVariantGroups(items);

    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBeNull();
    expect(groups[0].itemUrls).toEqual(['not a url']);
    expect(groups[0].bestItemUrl).toBe('not a url');
  });

  it('items continua idêntico ao formato anterior', async () => {
    mockFetch('<video src="https://cdn.example.com/video-1080p.mp4"></video><video src="https://cdn.example.com/video-720p.mp4"></video>');
    const { items, groups } = await scrapeGeneric('https://example.com/page.html');

    expect(groups).toHaveLength(1);
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(
        ['delivery', 'ext', 'label', 'name', 'size', 'thumbnail', 'type', 'url'].sort()
      );
    }
    expect(items[0]).toEqual({
      type: 'video',
      name: 'video-1080p.mp4',
      url: 'https://cdn.example.com/video-1080p.mp4',
      ext: 'mp4',
      label: 'video',
      size: 0,
      thumbnail: null,
      delivery: 'progressive',
    });
  });
});
