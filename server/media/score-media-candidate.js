/**
 * Pontuação de confiança de um candidato de mídia.
 *
 * Função pura: recebe um objeto (candidato normalizado ou MediaItem) e devolve
 * uma nota 0-100 baseada na origem (`source`) registrada no candidato. Ainda
 * não é usada para filtrar itens — apenas auxilia análise/rank futuro.
 */

const SOURCE_SCORES = Object.freeze({
  'generic:meta': 90,
  'generic:json-ld': 85,
  'generic:html': 80,
  'generic:srcset': 70,
  'generic:script': 60,
  'generic:style': 40,
});

const UNKNOWN_SCORE = 50;

/**
 * @param {{source?: string|null}} candidate
 * @returns {{score: number, reasons: string[]}}
 */
export function scoreMediaCandidate(candidate = {}) {
  const source = typeof candidate.source === 'string' ? candidate.source : null;

  if (source && Object.prototype.hasOwnProperty.call(SOURCE_SCORES, source)) {
    const local = source.split(':').pop();
    return { score: SOURCE_SCORES[source], reasons: [`source:${local}`] };
  }

  return { score: UNKNOWN_SCORE, reasons: ['source:unknown'] };
}