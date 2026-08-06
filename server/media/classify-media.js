/**
 * Classifica uma mídia a partir do MIME type e/ou da URL, devolvendo o tipo
 * normalizado e a extensão (sem ponto, minúscula). Retorna `null` quando
 * nenhuma extensão conhecida for encontrada.
 */

// MIME type -> extensão canônica.
const MIME_TYPE_EXTENSION = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  'video/x-m4v': 'm4v',
  'application/vnd.apple.mpegurl': 'm3u8',
  'application/x-mpegurl': 'm3u8',
  'application/dash+xml': 'mpd',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/flac': 'flac',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/x-rar-compressed': 'rar',
  'application/vnd.rar': 'rar',
  'application/x-7z-compressed': '7z',
};

// Extensão -> tipo normalizado.
const EXTENSION_TYPE = {
  mp4: 'video',
  webm: 'video',
  mov: 'video',
  mkv: 'video',
  m4v: 'video',
  m3u8: 'video',
  mpd: 'video',
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  webp: 'image',
  gif: 'image',
  avif: 'image',
  mp3: 'audio',
  wav: 'audio',
  ogg: 'audio',
  m4a: 'audio',
  flac: 'audio',
  pdf: 'document',
  zip: 'document',
  rar: 'document',
  '7z': 'document',
};

function extensionFromUrl(url) {
  if (typeof url !== 'string') return null;
  // Ignora hash e query string.
  const path = url.split('#')[0].split('?')[0];
  const match = path.match(/\.([a-z0-9]{2,5})$/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * @param {{url?: string, mimeType?: string}} input
 * @returns {{type: string, extension: string}|null}
 */
export function classifyMedia({ url, mimeType } = {}) {
  let extension = null;

  if (typeof mimeType === 'string' && mimeType.trim()) {
    const base = mimeType.split(';')[0].trim().toLowerCase();
    extension = MIME_TYPE_EXTENSION[base] || null;
  }

  if (!extension) {
    extension = extensionFromUrl(url);
  }

  const type = extension ? EXTENSION_TYPE[extension] : null;
  if (!type) return null;

  return { type, extension };
}