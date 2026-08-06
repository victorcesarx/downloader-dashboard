import { extractHtmlCandidates } from './extract-html-candidates.js';
import { resolveMediaUrl } from './resolve-media-url.js';
import { classifyMedia } from './classify-media.js';
import { scoreMediaCandidate } from './score-media-candidate.js';

/**
 * Transforma candidatos brutos do HTML em candidatos normalizados de mídia,
 * já com a URL absoluta resolvida e o tipo classificado.
 *
 * Descarta URLs inválidas e tipos desconhecidos, preserva a ordem de aparição,
 * remove duplicatas pela URL final e NÃO cria `MediaItem` — isso acontece em
 * uma etapa posterior.
 *
 * Na deduplicação, quando a mesma URL final aparece mais de uma vez, vence o
 * candidato com maior confiança (`scoreMediaCandidate`); em empate, o primeiro
 * é preservado. A posição no resultado é sempre a da PRIMEIRA ocorrência da
 * URL, independentemente de quem venceu.
 *
 * @param {string} html
 * @param {string} pageUrl
 * @returns {Array<{url: string, type: string, extension: string, sourceTag: string, sourceAttribute: string}>}
 */
export function buildMediaCandidates(html, pageUrl) {
  const results = [];
  const positions = new Map(); // url -> índice no results (primeira ocorrência)

  for (const candidate of extractHtmlCandidates(html)) {
    const url = resolveMediaUrl(candidate.value, pageUrl);
    if (!url) continue;

    const classification = classifyMedia({ url });
    if (!classification) continue; // extensão desconhecida -> nada

    const normalized = {
      url,
      type: classification.type,
      extension: classification.extension,
      sourceTag: candidate.tag,
      sourceAttribute: candidate.attribute,
    };

    if (!positions.has(url)) {
      positions.set(url, results.length);
      results.push(normalized);
      continue;
    }

    // Mesma URL final: mantém o candidato de maior score, sempre no slot da
    // primeira ocorrência; empate preserva o primeiro.
    const index = positions.get(url);
    const current = results[index];
    const newScore = scoreMediaCandidate({ source: candidateSource(normalized) }).score;
    const currentScore = scoreMediaCandidate({ source: candidateSource(current) }).score;
    if (newScore > currentScore) {
      results[index] = normalized;
    }
  }

  return results;
}

// Origem do candidato dentro do HTML (ex.: "generic:meta"). Compartilhada com
// o scraper genérico para que a pontuação e o MediaItem usem o mesmo mapping.
export function candidateSource(candidate) {
  const attribute = candidate.sourceAttribute;
  const tag = candidate.sourceTag;
  if (attribute === 'srcset' || attribute === 'data-srcset') return 'generic:srcset';
  if (tag === 'meta') return 'generic:meta';
  if (attribute === 'json-ld') return 'generic:json-ld';
  if (attribute === 'style') return 'generic:style';
  if (attribute === 'script-url') return 'generic:script';
  return 'generic:html';
}