import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { cacheControlFor, getStaticRoot, isCompressibleContentType } from '../../server/static.js';

const originalNodeEnv = process.env.NODE_ENV;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

describe('servidor de build estático', () => {
  it('usa cache imutável somente para assets com hash', () => {
    expect(cacheControlFor(path.join('dist', 'assets', 'index-Ab12_cdE.js')))
      .toBe('public, max-age=31536000, immutable');
    expect(cacheControlFor(path.join('dist', 'assets', 'index.js'))).toBe('no-cache');
    expect(cacheControlFor(path.join('dist', 'index.html'))).toBe('no-cache');
    expect(cacheControlFor(path.join('dist', 'locales', 'pt-BR.json'))).toBe('no-cache');
  });

  it('comprime MIME types textuais mesmo quando incluem charset', () => {
    expect(isCompressibleContentType('application/javascript; charset=utf-8')).toBe(true);
    expect(isCompressibleContentType('application/json; charset=utf-8')).toBe(true);
    expect(isCompressibleContentType('text/css; charset=utf-8')).toBe(true);
    expect(isCompressibleContentType('image/png')).toBe(false);
  });

  it('separa a raiz de desenvolvimento da raiz de produção', () => {
    process.env.NODE_ENV = 'development';
    expect(getStaticRoot()).toBe(projectRoot);
    process.env.NODE_ENV = 'production';
    expect(path.basename(getStaticRoot())).toBe('dist');
  });
});
