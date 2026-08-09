import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);

async function scriptFiles(dirUrl) {
  const entries = await readdir(dirUrl, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dirUrl);
    if (entry.isDirectory()) files.push(...await scriptFiles(url));
    else if (entry.name.endsWith('.js')) files.push(url);
  }
  return files;
}

function hasKey(locale, key) {
  return key.split('.').every(part => {
    if (!locale || !Object.prototype.hasOwnProperty.call(locale, part)) return false;
    locale = locale[part];
    return true;
  });
}

describe('completude dos locales', () => {
  it('PT-BR e EN possuem todas as chaves literais usadas pela interface', async () => {
    const locales = {
      'pt-BR': JSON.parse(await readFile(new URL('locales/pt-BR.json', root), 'utf8')),
      en: JSON.parse(await readFile(new URL('locales/en.json', root), 'utf8')),
    };
    const sources = [new URL('index.html', root), ...await scriptFiles(new URL('scripts/', root))];
    const keys = new Set();

    for (const source of sources) {
      const text = await readFile(source, 'utf8');
      for (const match of text.matchAll(/\bt\(\s*['"]([^'"]+)['"]/g)) keys.add(match[1]);
      for (const match of text.matchAll(/data-i18n(?:-html|-placeholder|-title|-aria-label|-content)?=["']([^"']+)["']/g)) keys.add(match[1]);
    }

    const missing = {};
    for (const [lang, locale] of Object.entries(locales)) {
      missing[lang] = [...keys].filter(key => !hasKey(locale, key));
    }
    expect(missing).toEqual({ 'pt-BR': [], en: [] });
  });
});
