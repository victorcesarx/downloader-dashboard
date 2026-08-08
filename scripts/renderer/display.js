import { store } from '../state.js';

const TYPE_ORDER = { video: 0, image: 1, audio: 2, document: 3 };

function qualityValue(item) {
  const width = Number(item.width);
  const height = Number(item.height);
  if (width > 0 && height > 0) return width * height;
  if (height > 0) return height;
  const text = `${item.quality || ''} ${item.label || ''} ${item.name || ''}`;
  const match = text.match(/(?:^|\D)(\d{3,4})p(?:\D|$)/i);
  // Normalize a "1080p" label to an approximate 16:9 pixel count so it can
  // be compared consistently with items that expose explicit dimensions.
  if (match) {
    const height = Number(match[1]);
    return height * Math.round(height * 16 / 9);
  }
  return null;
}

function compareKnownNumbers(a, b, direction) {
  const aKnown = Number.isFinite(a) && a > 0;
  const bKnown = Number.isFinite(b) && b > 0;
  if (!aKnown && !bKnown) return 0;
  if (!aKnown) return 1;
  if (!bKnown) return -1;
  return direction === 'asc' ? a - b : b - a;
}

export function sortDisplayItems(items, sortOrder = 'original', lang = 'pt-BR') {
  if (sortOrder === 'original') return [...items];
  const collator = new Intl.Collator(lang === 'en' ? 'en-US' : 'pt-BR', { sensitivity: 'base', numeric: true });
  const indexed = items.map((item, index) => ({ item, index }));
  indexed.sort((a, b) => {
    let result = 0;
    if (sortOrder === 'name-asc') result = collator.compare(a.item.name || '', b.item.name || '');
    if (sortOrder === 'name-desc') result = collator.compare(b.item.name || '', a.item.name || '');
    if (sortOrder === 'size-asc') result = compareKnownNumbers(a.item.size, b.item.size, 'asc');
    if (sortOrder === 'size-desc') result = compareKnownNumbers(a.item.size, b.item.size, 'desc');
    if (sortOrder === 'quality-asc') result = compareKnownNumbers(qualityValue(a.item), qualityValue(b.item), 'asc');
    if (sortOrder === 'quality-desc') result = compareKnownNumbers(qualityValue(a.item), qualityValue(b.item), 'desc');
    if (sortOrder === 'type') result = (TYPE_ORDER[a.item.type] ?? 99) - (TYPE_ORDER[b.item.type] ?? 99);
    return result || a.index - b.index;
  });
  return indexed.map(entry => entry.item);
}

// Lista de exibição: variantes do mesmo grupo (2+ itens) são colapsadas em um
// único card — o da variante selecionada, ou a primeira do grupo se nenhuma
// estiver marcada. Itens fora de grupo seguem normais. Exportada porque o
// "Selecionar Todos" também precisa respeitar o colapso.
export function getDisplayItems() {
  const { items, activeFilter, searchQuery, selectedItemIds, sortOrder, lang } = store.state;
  const seenGroups = new Set();
  const display = [];
  for (const item of items) {
    if (item.variantGroupKey && item.variantCount >= 2) {
      if (seenGroups.has(item.variantGroupKey)) continue;
      seenGroups.add(item.variantGroupKey);
      const group = items.filter(i => i.variantGroupKey === item.variantGroupKey);
      const selected = group.find(i => selectedItemIds.has(i.id)) || group[0];
      display.push(selected);
    } else {
      display.push(item);
    }
  }
  const filtered = display.filter(item => {
    const matchesFilter = activeFilter === 'all' || item.type === activeFilter;
    const matchesSearch = !searchQuery || item.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });
  return sortDisplayItems(filtered, sortOrder, lang);
}
