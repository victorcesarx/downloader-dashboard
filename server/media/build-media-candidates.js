import { extractHtmlCandidates } from './extract-html-candidates.js';
import { resolveMediaUrl } from './resolve-media-url.js';
import { classifyMedia } from './classify-media.js';

/**
 * Transforma candidatos brutos do HTML em candidatos normalizados de mídia,
 * já com a URL absoluta resolvida e o tipo classificado.
 *
 * Descarta URLs inválidas e tipos desconhecidos, preserva a ordem de aparição,
 * remove duplicatas pela URL final (mantendo a primeira origem) e NÃO cria
 * `MediaItem` — isso acontece em uma etapa posterior.
 *
 * @param {string} html
 * @param {string} pageUrl
 * @returns {Array<{url: string, type: string, extension: string, sourceTag: string, sourceAttribute: string}>}
 */
export function buildMediaCandidates(html, pageUrl) {
  const results = [];
  const seen = new Set();

  for (const candidate of extractHtmlCandidates(html)) {
    const url = resolveMediaUrl(candidate.value, pageUrl);
    if (!url) continue;

    const classification = classifyMedia({ url });
    if (!classification) continue; // extensão desconhecida -> nada

    if (seen.has(url)) continue; // mantém a primeira origem
    seen.add(url);

    results.push({
      url,
      type: classification.type,
      extension: classification.extension,
      sourceTag: candidate.tag,
      sourceAttribute: candidate.attribute,
    });
  }

  return results;
}