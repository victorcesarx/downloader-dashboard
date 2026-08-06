/**
 * Seleciona a melhor variante de um grupo de mídia.
 *
 * Função pura: não ordena o array nem modifica os itens. Critérios, em ordem:
 *   1. maior `height`;
 *   2. maior `width`;
 *   3. maior `size`;
 *   4. maior `confidenceScore`;
 *   5. empate → primeiro item.
 *
 * Valores `null` (ou não numéricos) valem menos do que qualquer número
 * conhecido (tratados como -1: nenhum número real de mídia é negativo).
 */

function numericValue(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : -1;
}

export function selectBestVariant(items) {
  if (!Array.isArray(items) || items.length === 0) return null;

  let best = items[0];
  for (let i = 1; i < items.length; i++) {
    if (compare(items[i], best) > 0) best = items[i];
  }
  return best;
}

function compare(a, b) {
  for (const key of ['height', 'width', 'size', 'confidenceScore']) {
    const av = numericValue(a[key]);
    const bv = numericValue(b[key]);
    if (av !== bv) return av > bv ? 1 : -1;
  }
  return 0;
}