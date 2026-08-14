import { afterEach, describe, expect, it, vi } from 'vitest';
import { scrapePixelDrain } from '../../server/scrapers/pixeldrain.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PixelDrain media classification', () => {
  it('classifies a MOV file link as video', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ name: 'recording.MOV', size: 123, mime_type: 'application/octet-stream' }),
    })));

    const result = await scrapePixelDrain('https://pixeldrain.com/u/AbCd1234');

    expect(result.items[0]).toMatchObject({
      name: 'recording.MOV',
      ext: 'mov',
      type: 'video',
    });
  });

  it('classifies MOV files inside a list as videos and provides thumbnails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        title: 'MOV list',
        files: [{ id: 'FileMov1', name: 'clip.mov', size: 456 }],
      }),
    })));

    const result = await scrapePixelDrain('https://pixeldrain.com/l/List1234');

    expect(result.items[0]).toMatchObject({
      ext: 'mov',
      type: 'video',
      thumbnail: 'https://pixeldrain.com/api/file/FileMov1/thumbnail?width=128&height=128',
    });
  });
});
