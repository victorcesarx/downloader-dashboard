import { fetchText, extractOGImage } from '../utils.js';
import { buildMediaCandidates } from '../media/build-media-candidates.js';
import { createMediaItem } from '../media/media-item.js';

// Nome derivado da URL (basename decodificado), com fallback para a extensão.
function nameFromUrl(url, extension) {
  const path = url.split('#')[0].split('?')[0];
  const rawName = path.split('/').pop();
  return decodeURIComponent(rawName) || `media.${extension}`;
}

// Converte um candidato normalizado em um MediaItem válido (tipos validados,
// opcionais em null, id estável = URL). Não faz parte da saída pública.
export function candidateToMediaItem(candidate, pageOGImage) {
  return createMediaItem({
    id: candidate.url,
    type: candidate.type,
    name: nameFromUrl(candidate.url, candidate.extension),
    url: candidate.url,
    thumbnail: candidate.type !== 'image' ? pageOGImage : null,
    extension: candidate.extension,
    mimeType: candidate.mimeType,
    source: 'generic',
  });
}

// Converte um MediaItem para a estrutura legada consumida pelo frontend.
// Usada apenas na saída final — expõe também `delivery` (progressive/hls/
// dash/null) sem afetar os demais campos.
export function mediaItemToLegacy(item) {
  return {
    type: item.type,
    name: item.name,
    url: item.url,
    ext: item.extension,
    label: item.type,
    size: item.size || 0,
    thumbnail: item.thumbnail,
    delivery: item.delivery
  };
}

export async function scrapeGeneric(url) {
  const html = await fetchText(url);
  if (!html) {
    return { title: url, url, items: [] };
  }

  const titleMatch = html.match(/<title>(.*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : url;
  const pageOGImage = extractOGImage(html);

  // Extração principal: atributos, srcset, style, metatags sociais, JSON-LD
  // e URLs de mídia em scripts — com URLs resolvidas, tipos classificados e
  // itens normalizados.
  const items = buildMediaCandidates(html, url)
    .map(candidate => mediaItemToLegacy(candidateToMediaItem(candidate, pageOGImage)));

  return { title, url, items };
}