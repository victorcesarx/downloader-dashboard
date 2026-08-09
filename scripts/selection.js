/**
 * Inverte somente os cards presentes na lista filtrada de exibição.
 * Seleções fora do filtro são preservadas. Ao selecionar um representante
 * de variantes, qualquer outra variante do mesmo grupo é removida primeiro.
 */
export function invertVisibleSelection(items, visibleItems, selectedItemIds) {
  const next = new Set(selectedItemIds);

  for (const item of visibleItems) {
    if (next.has(item.id)) {
      next.delete(item.id);
      continue;
    }

    if (item.variantGroupKey) {
      for (const candidate of items) {
        if (candidate.variantGroupKey === item.variantGroupKey) {
          next.delete(candidate.id);
        }
      }
    }
    next.add(item.id);
  }

  return next;
}

/** Seleciona os itens visíveis sem alterar itens fora do filtro. */
export function selectVisibleItems(items, visibleItems, selectedItemIds) {
  const next = new Set(selectedItemIds);

  for (const item of visibleItems) {
    if (item.variantGroupKey) {
      for (const candidate of items) {
        if (candidate.variantGroupKey === item.variantGroupKey) next.delete(candidate.id);
      }
    }
    next.add(item.id);
  }

  return next;
}
