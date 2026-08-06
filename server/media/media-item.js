/**
 * MediaItem — contrato normalizado de dados de mídia.
 *
 * Todos os scrapers devem produzir itens neste formato. Campos opcionais
 * (buffer-to-null container) usam `null` quando desconhecidos.
 *
 * @typedef {Object} MediaItem
 * @property {string} id - Identificador único do item.
 * @property {'video'|'image'|'audio'|'document'} type - Tipo da mídia.
 * @property {string} name - Nome de exibição (e nome base para download/ZIP).
 * @property {string} url - URL direta de download da mídia.
 * @property {string|null} thumbnail - URL da miniatura, se houver.
 * @property {string|null} mimeType - MIME type (ex.: "video/mp4").
 * @property {string|null} extension - Extensão sem ponto (ex.: "mp4").
 * @property {number|null} size - Tamanho em bytes, se conhecido.
 * @property {number|null} width - Largura em pixels, se aplicável.
 * @property {number|null} height - Altura em pixels, se aplicável.
 * @property {number|null} duration - Duração em segundos, se aplicável.
 * @property {string|null} quality - Qualidade/versão (ex.: "1080p").
 * @property {'progressive'|'hls'|'dash'|null} delivery - Forma de entrega
 *   do vídeo (derivada da extensão, a menos que informada explicitamente).
 * @property {string|null} source - Origem/plataforma (ex.: "twitter").
 * @property {number|null} confidenceScore - Confiança do candidato (0-100).
 * @property {string[]} confidenceReasons - Motivos da pontuação.
 */

export const MEDIA_TYPES = ['video', 'image', 'audio', 'document'];

export const DELIVERY_VALUES = ['progressive', 'hls', 'dash'];

const OPTIONAL_FIELDS = [
  'thumbnail',
  'mimeType',
  'extension',
  'size',
  'width',
  'height',
  'duration',
  'quality',
  'source',
];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// Regra de derivação: m3u8 -> hls, mpd -> dash, demais vídeos -> progressive,
// itens que não são vídeo -> null.
function deriveDelivery(type, extension) {
  if (type !== 'video') return null;
  if (extension === 'm3u8') return 'hls';
  if (extension === 'mpd') return 'dash';
  return 'progressive';
}

/**
 * Cria um objeto `MediaItem` normalizado a partir de `input`.
 *
 * - Valida os campos obrigatórios (`id`, `type`, `name`, `url`);
 * - preenche os campos opcionais com `null` quando ausentes;
 * - preserva os valores informados;
 * - retorna um objeto NOVO, nunca modifica `input`;
 * - descarta propriedades fora do contrato.
 *
 * @param {object} input
 * @returns {MediaItem}
 * @throws {Error} Se um campo obrigatório faltar ou `type` for inválido.
 */
export function createMediaItem(input) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('MediaItem: entrada deve ser um objeto');
  }

  const { id, type, name, url } = input;

  if (!isNonEmptyString(id)) {
    throw new TypeError('MediaItem: campo obrigatório ausente ou inválido: "id"');
  }
  if (!isNonEmptyString(name)) {
    throw new TypeError('MediaItem: campo obrigatório ausente ou inválido: "name"');
  }
  if (!isNonEmptyString(url)) {
    throw new TypeError('MediaItem: campo obrigatório ausente ou inválido: "url"');
  }
  if (!MEDIA_TYPES.includes(type)) {
    throw new TypeError(`MediaItem: "type" inválido (esperado um de ${MEDIA_TYPES.join(', ')}): ${JSON.stringify(type)}`);
  }

  const item = { id, type, name, url };

  for (const field of OPTIONAL_FIELDS) {
    item[field] = input[field] === undefined ? null : input[field];
  }

  // `delivery`: valor explícito válido é preservado; inválido é rejeitado;
  // ausente é derivado do tipo/extensão.
  if (input.delivery !== undefined) {
    if (!DELIVERY_VALUES.includes(input.delivery)) {
      throw new TypeError(`MediaItem: "delivery" inválido (esperado um de ${DELIVERY_VALUES.join(', ')}): ${JSON.stringify(input.delivery)}`);
    }
    item.delivery = input.delivery;
  } else {
    item.delivery = deriveDelivery(type, input.extension);
  }

  // `confidenceScore`: número 0-100 ou null (padrão null).
  const confidenceScore = input.confidenceScore === undefined ? null : input.confidenceScore;
  if (confidenceScore !== null && (typeof confidenceScore !== 'number' || !Number.isFinite(confidenceScore) || confidenceScore < 0 || confidenceScore > 100)) {
    throw new TypeError(`MediaItem: "confidenceScore" inválido (esperado número entre 0 e 100 ou null): ${JSON.stringify(confidenceScore)}`);
  }
  item.confidenceScore = confidenceScore;

  // `confidenceReasons`: array de strings (padrão []), copiado para não
  // reutilizar a referência de entrada.
  const confidenceReasons = input.confidenceReasons === undefined ? [] : input.confidenceReasons;
  if (!Array.isArray(confidenceReasons) || confidenceReasons.some(r => typeof r !== 'string')) {
    throw new TypeError('MediaItem: "confidenceReasons" inválido (esperado array de strings)');
  }
  item.confidenceReasons = [...confidenceReasons];

  return item;
}