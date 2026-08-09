import { describe, expect, it } from 'vitest';
import { invertVisibleSelection, selectVisibleItems } from '../../scripts/selection.js';

function media(id, extra = {}) {
  return { id, type: 'image', name: `${id}.jpg`, ...extra };
}

describe('seleção invertida', () => {
  it('inverte somente os itens filtrados e preserva seleções fora do filtro', () => {
    const visibleSelected = media('visible-selected');
    const visibleClear = media('visible-clear');
    const hiddenSelected = media('hidden-selected', { type: 'video' });

    const result = invertVisibleSelection(
      [visibleSelected, visibleClear, hiddenSelected],
      [visibleSelected, visibleClear],
      new Set([visibleSelected.id, hiddenSelected.id]),
    );

    expect(result).toEqual(new Set([visibleClear.id, hiddenSelected.id]));
  });

  it('mantém no máximo uma variante selecionada por grupo', () => {
    const hiddenVariant = media('low', { variantGroupKey: 'post', variantCount: 2 });
    const visibleVariant = media('high', { variantGroupKey: 'post', variantCount: 2 });

    const result = invertVisibleSelection(
      [hiddenVariant, visibleVariant],
      [visibleVariant],
      new Set([hiddenVariant.id]),
    );

    expect(result).toEqual(new Set([visibleVariant.id]));
  });

  it('desmarca o representante visível sem selecionar outra variante', () => {
    const selected = media('high', { variantGroupKey: 'post', variantCount: 2 });
    const alternate = media('low', { variantGroupKey: 'post', variantCount: 2 });

    const result = invertVisibleSelection(
      [selected, alternate],
      [selected],
      new Set([selected.id]),
    );

    expect(result).toEqual(new Set());
  });

  it('não altera a seleção quando não há itens visíveis', () => {
    const result = invertVisibleSelection([], [], new Set(['outside']));
    expect(result).toEqual(new Set(['outside']));
  });

  it('seleciona todos os itens visíveis preservando itens externos', () => {
    const visible = media('visible');
    const outside = media('outside');
    const result = selectVisibleItems([visible, outside], [visible], new Set([outside.id]));
    expect(result).toEqual(new Set([outside.id, visible.id]));
  });

  it('seleção visível substitui outra variante do mesmo grupo', () => {
    const low = media('low', { variantGroupKey: 'post', variantCount: 2 });
    const high = media('high', { variantGroupKey: 'post', variantCount: 2 });
    const result = selectVisibleItems([low, high], [high], new Set([low.id]));
    expect(result).toEqual(new Set([high.id]));
  });
});
