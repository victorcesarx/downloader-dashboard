/**
 * Resolve uma URL de mídia contra a URL da página.
 *
 * - Aceita URL absoluta (http/https), relativa, iniciada com "/" e
 *   protocol-relative ("//cdn.site.com/file.mp4");
 * - remove espaços nas bordas;
 * - rejeita valor vazio, protocolos diferentes de http/https e URLs
 *   malformadas, retornando `null`.
 *
 * @param {string|null|undefined} value - URL bruta extraída do HTML.
 * @param {string} pageUrl - URL da página (base para resolução).
 * @returns {string|null} URL absoluta normalizada, ou `null` se inválida.
 */
export function resolveMediaUrl(value, pageUrl) {
  if (typeof value !== 'string' || value.trim().length === 0) return null;

  try {
    const parsed = new URL(value.trim(), pageUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.href;
  } catch {
    return null;
  }
}