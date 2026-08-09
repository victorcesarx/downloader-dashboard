/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { store } from '../../scripts/state.js';
import { getDisplayItems, sortDisplayItems } from '../../scripts/renderer/display.js';

const media = (id, overrides = {}) => ({
  id,
  name: `${id}.mp4`,
  type: 'video',
  size: null,
  ...overrides,
});

describe('media sorting', () => {
  beforeEach(() => {
    store.state.items = [];
    store.state.selectedItemIds = new Set();
    store.state.activeFilter = 'all';
    store.state.searchQuery = '';
    store.state.sortOrder = 'original';
    store.state.lang = 'pt-BR';
  });

  it('keeps the analyzer order by default without mutating the source array', () => {
    const items = [media('b'), media('a')];
    expect(sortDisplayItems(items).map(item => item.id)).toEqual(['b', 'a']);
    expect(items.map(item => item.id)).toEqual(['b', 'a']);
  });

  it('sorts names naturally in both directions', () => {
    const items = [media('arquivo10'), media('arquivo2'), media('Arquivo1')];
    expect(sortDisplayItems(items, 'name-asc').map(item => item.id)).toEqual(['Arquivo1', 'arquivo2', 'arquivo10']);
    expect(sortDisplayItems(items, 'name-desc').map(item => item.id)).toEqual(['arquivo10', 'arquivo2', 'Arquivo1']);
  });

  it('sorts known sizes and always leaves unknown sizes last', () => {
    const items = [media('unknown'), media('zero-is-unknown', { size: 0 }), media('small', { size: 10 }), media('large', { size: 100 })];
    expect(sortDisplayItems(items, 'size-asc').map(item => item.id)).toEqual(['small', 'large', 'unknown', 'zero-is-unknown']);
    expect(sortDisplayItems(items, 'size-desc').map(item => item.id)).toEqual(['large', 'small', 'unknown', 'zero-is-unknown']);
  });

  it('sorts quality using dimensions or a quality label, with unknown values last', () => {
    const items = [
      media('unknown'),
      media('hd', { width: 1280, height: 720 }),
      media('full-hd', { quality: '1080p' }),
    ];
    expect(sortDisplayItems(items, 'quality-desc').map(item => item.id)).toEqual(['full-hd', 'hd', 'unknown']);
    expect(sortDisplayItems(items, 'quality-asc').map(item => item.id)).toEqual(['hd', 'full-hd', 'unknown']);
  });

  it('groups types in a predictable order while preserving ties', () => {
    const items = [media('doc', { type: 'document' }), media('image-a', { type: 'image' }), media('video'), media('image-b', { type: 'image' })];
    expect(sortDisplayItems(items, 'type').map(item => item.id)).toEqual(['video', 'image-a', 'image-b', 'doc']);
  });

  it('sorts only after variant groups are collapsed and preserves the selected variant', () => {
    const first = media('720p', { name: 'z.mp4', variantGroupKey: 'post', variantCount: 2 });
    const selected = media('1080p', { name: 'a.mp4', variantGroupKey: 'post', variantCount: 2 });
    const other = media('other', { name: 'm.mp4' });
    store.state.items = [first, selected, other];
    store.state.selectedItemIds = new Set([selected.id]);
    store.state.sortOrder = 'name-asc';

    expect(getDisplayItems().map(item => item.id)).toEqual(['1080p', 'other']);
    expect(store.state.items.map(item => item.id)).toEqual(['720p', '1080p', 'other']);
    expect(store.state.selectedItemIds.has(selected.id)).toBe(true);
  });
});
