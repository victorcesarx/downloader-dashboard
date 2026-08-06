import { fetchText, extractOGImage } from '../utils.js';
import { buildMediaCandidates, candidateSource } from '../media/build-media-candidates.js';
import { createMediaItem } from '../media/media-item.js';
import { scoreMediaCandidate } from '../media/score-media-candidate.js';
import { groupMediaVariants } from '../media/group-media-variants.js';
import { selectBestVariant } from '../media/select-best-variant.js';

// Nome derivado da URL (basename decodificado), com fallback para a extensão.
function nameFromUrl(url, extension) {
  const path = url.split('#')[0].split('?')[0];
  const rawName = path.split('/').pop();
  return decodeURIComponent(rawName) || `media.${extension}`;
}

// Converte um candidato normalizado em um MediaItem válido (tipos validados,
// opcionais em null, id estável = URL). Não faz parte da saída pública.
export function candidateToMediaItem(candidate, pageOGImage) {
  const source = candidateSource(candidate);
  const confidence = scoreMediaCandidate({ source });
  return createMediaItem({
    id: candidate.url,
    type: candidate.type,
    name: nameFromUrl(candidate.url, candidate.extension),
    url: candidate.url,
    thumbnail: candidate.type !== 'image' ? pageOGImage : null,
    extension: candidate.extension,
    mimeType: candidate.mimeType,
    source,
    confidenceScore: confidence.score,
    confidenceReasons: confidence.reasons,
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
  const mediaItems = buildMediaCandidates(html, url)
    .map(candidate => candidateToMediaItem(candidate, pageOGImage));

  annotateVariantMetadata(mediaItems);

  const items = mediaItems.map(item => mediaItemToLegacy(item));
  const groups = buildVariantGroups(mediaItems);

  return { title, url, items, groups };
}

// Resumo público dos grupos de variantes (apenas URLs, nunca objetos
// internos). `key` é a chave do grupo; `bestItemUrl` aponta a variante
// marcada como melhor; `itemUrls` lista todas as variantes na ordem atual.
// Grupos com um único item também aparecem; chaves nulas viram `key: null`.
export function buildVariantGroups(mediaItems) {
  const groups = [];
  const indexByKey = new Map();

  for (const item of mediaItems) {
    const key = item.variantGroupKey;
    const existing = key !== null ? indexByKey.get(key) : undefined;

    if (existing !== undefined) {
      const group = groups[existing];
      group.itemUrls.push(item.url);
      if (item.isBestVariant) group.bestItemUrl = item.url;
    } else {
      if (key !== null) indexByKey.set(key, groups.length);
      groups.push({ key, bestItemUrl: item.isBestVariant ? item.url : null, itemUrls: [item.url] });
    }
  }

  return groups;
}

// Aplica metadados internos de variante aos MediaItem (sem expor na saída
// pública): `variantGroupKey` vem do grupo da URL e `isBestVariant` marca a
// melhor variante do grupo. Agrupa MESMOS objetos (nunca os originais de quem
// chamou), preservando todos os itens e contagens.
export function annotateVariantMetadata(mediaItems) {
  const groups = groupMediaVariants(mediaItems);
  const bestPerGroup = new Set();
  const keyByItem = new Map();

  for (const group of groups) {
    bestPerGroup.add(selectBestVariant(group.items));
    for (const item of group.items) keyByItem.set(item, group.key);
  }

  for (const item of mediaItems) {
    item.variantGroupKey = keyByItem.get(item);
    item.isBestVariant = bestPerGroup.has(item);
  }

  return mediaItems;
}