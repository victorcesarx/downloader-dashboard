import { store } from '../state.js';

// Lista de exibição: variantes do mesmo grupo (2+ itens) são colapsadas em um
// único card — o da variante selecionada, ou a primeira do grupo se nenhuma
// estiver marcada. Itens fora de grupo seguem normais. Exportada porque o
// "Selecionar Todos" também precisa respeitar o colapso.
export function getDisplayItems() {
  const { items, activeFilter, searchQuery, selectedItemIds } = store.state;
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
  return display.filter(item => {
    const matchesFilter = activeFilter === 'all' || item.type === activeFilter;
    const matchesSearch = !searchQuery || item.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });
}