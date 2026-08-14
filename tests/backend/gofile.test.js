import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  ensureGoFileSession,
  fetchGoFileContents,
  getGoFileDownloadHeaders,
  generateWT,
  getGoFileWTStatus,
  refreshGoFileWTSalt,
  resetGoFileSessionForTests,
  scrapeGoFile,
} from '../../server/scrapers/gofile.js';

beforeEach(() => resetGoFileSessionForTests());

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetGoFileSessionForTests();
});

describe('GoFile session', () => {
  it('generates the rotating website token using the complete browser fingerprint', () => {
    const now = 1_786_252_800_000;
    const expected = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36::en-US::account-token::124045::12af056dacea0b';
    expect(generateWT('account-token', now)).toBe(createHash('sha256').update(expected).digest('hex'));
  });

  it('deduplicates concurrent guest session creation', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      status: 'ok', data: { token: 'guest-token' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const results = await Promise.all([ensureGoFileSession(), ensureGoFileSession(), ensureGoFileSession()]);

    expect(results).toEqual([true, true, true]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('enters cooldown after a rate limit instead of creating more accounts', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await ensureGoFileSession()).toBe(false);
    expect(await ensureGoFileSession()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends matching website-token fingerprint headers and account cookie', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchGoFileContents('Folder123', 'account-token');

    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers['X-Website-Token']).toBe(generateWT('account-token'));
    expect(headers['X-BL']).toBe('en-US');
    expect(headers.Cookie).toBe('accountToken=account-token');
  });

  it('uses the MIME type when a media filename has no extension', async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url).endsWith('/accounts')) {
        return new Response(JSON.stringify({ status: 'ok', data: { token: 'guest-token' } }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({
        status: 'ok',
        data: {
          name: 'Album',
          children: {
            one: { type: 'file', name: '01', link: 'https://store1.gofile.io/download/one', mimetype: 'image/jpeg', size: 123 },
          },
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await scrapeGoFile('https://gofile.io/d/Folder123');

    expect(result.items[0]).toMatchObject({
      name: '01', ext: 'jpg', type: 'image', source: 'gofile', mimeType: 'image/jpeg',
    });
  });

  it('provides the cached account cookie for protected CDN downloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      status: 'ok', data: { token: 'download-token' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const headers = await getGoFileDownloadHeaders();

    expect(headers.Authorization).toBe('Bearer download-token');
    expect(headers.Cookie).toBe('accountToken=download-token');
  });

  it('activates a newly discovered salt only after validating it against the API', async () => {
    const candidate = '9844d94d963d30';
    const key = 'test';
    const encoded = encodeObfuscatedString(candidate, key);
    const asset = `function d(i,k){i=i-0x1e0;} function s(){var a=['${encoded}'];return a;} d(0x1e0,'${key}');`.repeat(4);
    const fetchMock = vi.fn(async (url, options = {}) => {
      const target = String(url);
      if (target.endsWith('/js/wt.obf.js')) return new Response(asset, { status: 200 });
      if (target.endsWith('/accounts')) {
        return new Response(JSON.stringify({
          status: 'ok', data: { token: 'validation-token', rootFolder: 'validation-root' },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      expect(options.headers['X-Website-Token']).toBe(generateWT('validation-token', Date.now(), candidate));
      return new Response(JSON.stringify({ status: 'ok', data: { type: 'folder', children: {} } }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await refreshGoFileWTSalt({ force: true });

    expect(result).toMatchObject({ salt: candidate, source: 'website', changed: true });
    expect(getGoFileWTStatus()).toMatchObject({ salt: candidate, source: 'website' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

function encodeObfuscatedString(plainText, key) {
  const state = Array.from({ length: 256 }, (_, index) => index);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + state[i] + key.charCodeAt(i % key.length)) % 256;
    [state[i], state[j]] = [state[j], state[i]];
  }
  let cipher = '';
  let i = 0;
  j = 0;
  for (const char of plainText) {
    i = (i + 1) % 256;
    j = (j + state[i]) % 256;
    [state[i], state[j]] = [state[j], state[i]];
    cipher += String.fromCharCode(char.charCodeAt(0) ^ state[(state[i] + state[j]) % 256]);
  }

  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';
  const bytes = Buffer.from(cipher, 'utf8');
  let output = '';
  let accumulator = 0;
  let bitCount = 0;
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bitCount += 8;
    while (bitCount >= 6) {
      bitCount -= 6;
      output += alphabet[(accumulator >> bitCount) & 63];
    }
  }
  if (bitCount > 0) output += alphabet[(accumulator << (6 - bitCount)) & 63];
  while (output.length % 4) output += '=';
  return output;
}
