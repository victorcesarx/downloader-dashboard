import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractImagePondItemUrls, parseImagePondItemPage, scrapeImagePond } from '../../server/scrapers/imagepond.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const videoPage = (name, url, thumbnail) => `
  <html><head>
    <title>${name} - ImagePond</title>
    <meta property="og:type" content="video.other">
    <meta property="og:video" content="${url}">
    <meta property="og:video:type" content="video/mp4">
    <meta property="og:video:width" content="360">
    <meta property="og:video:height" content="640">
    <meta property="og:image" content="${thumbnail}">
  </head><body></body></html>`;

describe('ImagePond scraper', () => {
  it('parses the direct video and its thumbnail from an item page', () => {
    const item = parseImagePondItemPage(
      'https://www.imagepond.net/i/QFGBo8Fb',
      videoPage('clip.mp4', 'https://media.imagepond.net/media/videos/clip.mp4', 'https://media.imagepond.net/media/videos/clip_thumb.jpg'),
    );

    expect(item).toMatchObject({
      type: 'video', name: 'clip.mp4', ext: 'mp4', label: 'video/mp4', width: 360, height: 640,
      url: 'https://media.imagepond.net/media/videos/clip.mp4',
      thumbnail: 'https://media.imagepond.net/media/videos/clip_thumb.jpg',
    });
  });

  it('parses an image without mistaking a video poster for the source', () => {
    const item = parseImagePondItemPage('https://www.imagepond.net/i/Image123', `
      <title>portrait.jpg - ImagePond</title>
      <meta property="og:image" content="https://media.imagepond.net/media/images/portrait.jpg">
      <meta property="og:image:type" content="image/jpeg">
    `);

    expect(item).toMatchObject({
      type: 'image', name: 'portrait.jpg', ext: 'jpg', label: 'image/jpeg',
      url: 'https://media.imagepond.net/media/images/portrait.jpg',
    });
  });

  it('extracts unique item links from an album in display order', () => {
    const urls = extractImagePondItemUrls(`
      <a href="/i/First123">first</a>
      <a href="https://www.imagepond.net/i/Second456">second</a>
      <a href="/i/First123">duplicate</a>
      <a href="https://example.com/i/Outside1">outside</a>
    `);
    expect(urls).toEqual([
      'https://www.imagepond.net/i/First123',
      'https://www.imagepond.net/i/Second456',
    ]);
  });

  it('resolves every album item page and preserves the album order', async () => {
    const pages = new Map([
      ['https://www.imagepond.net/a/Album123', '<title>My Album - ImagePond</title><a href="/i/First123">1</a><a href="/i/Second456">2</a>'],
      ['https://www.imagepond.net/i/First123', videoPage('first.mp4', 'https://media.imagepond.net/first.mp4', 'https://media.imagepond.net/first.jpg')],
      ['https://www.imagepond.net/i/Second456', '<title>second.jpg - ImagePond</title><meta property="og:image" content="https://media.imagepond.net/second.jpg">'],
    ]);
    vi.stubGlobal('fetch', vi.fn(async url => ({
      ok: true,
      headers: new Headers(),
      text: async () => pages.get(String(url)),
    })));

    const result = await scrapeImagePond('https://www.imagepond.net/a/Album123');
    expect(result.title).toBe('My Album');
    expect(result.items.map(item => item.name)).toEqual(['first.mp4', 'second.jpg']);
  });
});
