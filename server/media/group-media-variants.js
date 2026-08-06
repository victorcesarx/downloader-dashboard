/**
 * Agrupa variantes da mesma mídia usando `createVariantGroupKey()`.
 *
 * Função pura: não modifica o array nem os objetos de entrada. A ordem dos
 * grupos segue a primeira aparição de cada chave; a ordem interna dos itens é
 * preservada. Itens sem chave válida (null) ganham um grupo próprio — nunca
 * são agrupados entre si.
 */

import { createVariantGroupKey } from './create-variant-group-key.js';

/**
 * @param {Array<{url?: string}>} mediaItems
 * @returns {Array<{key: string|null, items: Array}>}
 */
export function groupMediaVariants(mediaItems) {
  const groups = [];
  const indexByKey = new Map();

  for (const item of mediaItems) {
    const key = createVariantGroupKey(item);
    const groupIndex = key !== null ? indexByKey.get(key) : undefined;

    if (groupIndex !== undefined) {
      groups[groupIndex].items.push(item);
    } else {
      indexByKey.set(key, groups.length);
      groups.push({ key, items: [item] });
    }
  }

  return groups;
}