/**
 * Chave de grupo para identificar variantes da mesma mídia.
 *
 * Função pura: recebe um MediaItem e gera uma string estável a partir da URL,
 * ignorando query string, hash e tokens de qualidade no nome (1080p, 720p,
 * 480p, 2160p, 4k, hd, sd, hq, lq, hi, lo). O hostname é normalizado para
 * minúsculas e a extensão é preservada. Não modifica o objeto de entrada.
 */

const QUALITY_TOKENS = ['2160p', '1080p', '720p', '480p', '4k', 'hd', 'sd', 'hq', 'lq', 'hi', 'lo'];
// O `\b` não serve aqui: `_` é caractere de palavra, então sufixos como
// `_hd`/`_lo` jamais casariam. Usamos vizinhança não-alfanumérica, que trata
// `-`, `_`, espaços e ponta de nome como separadores.
const QUALITY_RE = new RegExp(`(?<![a-z0-9])(?:${QUALITY_TOKENS.join('|')})(?![a-z0-9])`, 'gi');

function cleanBasename(basename) {
  const dot = basename.lastIndexOf('.');
  const hasExt = dot > 0;
  const stem = hasExt ? basename.slice(0, dot) : basename;
  const extension = hasExt ? basename.slice(dot) : '';

  const cleaned = stem
    .replace(QUALITY_RE, '')
    .replace(/[-_\s]{2,}/g, '-')
    .replace(/^[-_\s]+|[-_\s]+$/g, '');

  return cleaned + extension;
}

/**
 * @param {{url?: string}|null|undefined} mediaItem
 * @returns {string|null} Chave estável do grupo, ou `null` para URL inválida.
 */
export function createVariantGroupKey(mediaItem) {
  if (!mediaItem || typeof mediaItem.url !== 'string') return null;

  let url;
  try {
    url = new URL(mediaItem.url);
  } catch {
    return null;
  }

  const segments = url.pathname.split('/');
  const last = segments.pop() || '';
  const basename = cleanBasename(last);
  segments.push(basename);

  return `${url.hostname.toLowerCase()}${segments.join('/')}`;
}