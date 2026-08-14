import { afterEach, describe, expect, it, vi } from 'vitest';
import { enrichItemSizes } from '../../server/utils.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('enrichItemSizes', () => {
  it('sends Erome hotlink headers and reads the total from a ranged response', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ headers: new Headers() })
      .mockResolvedValueOnce({
        headers: new Headers({
          'content-length': '1',
          'content-range': 'bytes 0-0/7340032',
        }),
      });
    vi.stubGlobal('fetch', fetchMock);
    const items = [{ name: 'clip.mp4', url: 'https://v.erome.com/example/clip.mp4', size: 0 }];

    await enrichItemSizes(items);

    expect(items[0].size).toBe(7340032);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      Referer: 'https://www.erome.com/',
      Origin: 'https://www.erome.com',
      'Accept-Encoding': 'identity',
    });
    expect(fetchMock.mock.calls[1][1].headers.Range).toBe('bytes=0-0');
  });

  it('continues using Content-Length for a regular HEAD response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      headers: new Headers({ 'content-length': '2048' }),
    })));
    const items = [{ name: 'photo.jpg', url: 'https://example.com/photo.jpg', size: 0 }];

    await enrichItemSizes(items);

    expect(items[0].size).toBe(2048);
  });
});
