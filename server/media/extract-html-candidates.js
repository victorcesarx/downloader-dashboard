/**
 * Extrai candidatas a URL de mídia do HTML: valores dos atributos
 * `src`, `href`, `data-src`, `data-url` e `poster` nas tags
 * `video`, `source`, `audio`, `img` e `a`. Para as tags `img` e `source`
 * também lê `srcset` e `data-srcset`, gerando um candidato por entrada
 * (ignorando descritores `480w`, `2x`, etc.). Também coleta `url(...)`
 * de `background`/`background-image` em atributos `style` e URLs HTTP/HTTPS
 * com extensões de mídia dentro de blocos `<script>` comuns.
 *
 * Não resolve URLs nem classifica mídia — apenas coleta em ordem do HTML,
 * ignorando valores vazios e removendo duplicatas idênticas.
 */

const TAGS = ['video', 'source', 'audio', 'img', 'a'];
const ATTRIBUTES = ['src', 'href', 'data-src', 'data-url', 'poster'];

const SRCSET_TAGS = ['img', 'source'];
const SRCSET_ATTRIBUTES = ['srcset', 'data-srcset'];

// Metatags sociais cujo `content` aponta para mídia.
const META_PROPERTIES = new Set([
  'og:video',
  'og:video:url',
  'og:video:secure_url',
  'og:image',
  'og:image:url',
  'twitter:player:stream',
  'twitter:image',
]);

// Chaves procuradas dentro de blocos <script type="application/ld+json">.
const JSON_LD_KEYS = ['contentUrl', 'embedUrl', 'thumbnailUrl', 'image', 'video', 'audio', 'url'];

// `url(...)` dentro das propriedades CSS `background` e `background-image`
// (aceita aspas simples, duplas ou sem aspas).
const STYLE_URL_RE = /background(?:-image)?\s*:\s*[^;]*?url\(\s*(['"]?)([^'")]*?)\1\s*\)/gi;

// URLs HTTP/HTTPS terminando em extensões de mídia conhecidas, citadas dentro
// de blocos <script> comuns. Aceita `\/` (JavaScript autocontido/JSON escapado)
// e sufixos como query strings; o valor é "desescapado" em collectScriptUrls.
const SCRIPT_MEDIA_EXTENSIONS = 'mp4|mkv|webm|mov|m3u8|mpd|jpg|jpeg|png|webp|gif|mp3|wav|ogg';
const SCRIPT_URL_RE = new RegExp(
  `https?:\\\\?\\/\\\\?\\/[^"'\\s]+?\\.(?:${SCRIPT_MEDIA_EXTENSIONS})[^"'\\s]*(?=["'\\s\\\\\\),;}\\]\`]|$)`,
  'gi'
);

function collectAttribute(html, tag, attribute) {
  // As bordas usam lookbehind para não capturar substrings de atributos
  // compostos (ex.: "data-src" não deve casar com a regra de "src").
  const regex = new RegExp(`<${tag}\\b[^>]*(?<![a-zA-Z0-9-])${attribute}\\s*=\\s*["']([^"']*?)["']`, 'gi');
  const matches = [];
  let match;
  while ((match = regex.exec(html)) !== null) {
    matches.push({ raw: match[1].trim(), index: match.index });
  }
  return matches;
}

// Cada entrada do srcset vira um candidato. Descritores ("480w", "2x") são
// removidos; entradas vazias são puladas.
function collectSrcsetEntries(raw, index) {
  const entries = [];
  raw.split(',').forEach((part, i) => {
    const trimmed = part.trim();
    if (!trimmed) return;
    const url = trimmed.split(/\s+/)[0].trim();
    if (!url) return;
    entries.push({ value: url, index: index + i * 0.001 });
  });
  return entries;
}

// Percorre o JSON-LD recursivamente e coleta strings cuja chave imediata
// esteja em `keys` (aceita strings, arrays e objetos aninhados).
function walkJsonLd(node, keys, push) {
  if (typeof node === 'string') {
    push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) walkJsonLd(child, keys, push);
    return;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (keys.includes(key)) walkJsonLd(value, keys, push);
    }
  }
}

// URLs dentro do atributo `style` (propriedades `background-image` e
// `background`). Ignora valores vazios e `data:`; cada ocorrência mantém a
// ordem dentro do próprio atributo via fração do índice do elemento.
function collectStyle(html) {
  const styleRegex = /<([a-z][a-z0-9-]*)\b[^>]*(?<![a-zA-Z0-9-])style\s*=\s*(["'])([\s\S]*?)\2/gi;
  const matches = [];
  let match;
  while ((match = styleRegex.exec(html)) !== null) {
    const tagName = match[1];
    const content = match[3];
    let order = 0;
    STYLE_URL_RE.lastIndex = 0;
    let cssMatch;
    while ((cssMatch = STYLE_URL_RE.exec(content)) !== null) {
      const value = cssMatch[2].trim();
      if (!value || value.toLowerCase().startsWith('data:')) continue;
      matches.push({ value, tag: tagName, attribute: 'style', index: match.index + order * 0.001 });
      order++;
    }
  }
  return matches;
}

// URLs de mídia dentro de blocos <script> comuns. Blocos JSON-LD são
// ignorados (já tratados separadamente). Ordem interna preservada por fração
// do índice do bloco; `\/` é desescapado para gerar uma URL válida.
function collectScriptUrls(html) {
  const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  const matches = [];
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    const openTag = match[1];
    if (/type\s*=\s*["']application\/ld\+json["']/i.test(openTag)) continue;
    const content = match[2];
    if (!content.trim()) continue;
    let order = 0;
    SCRIPT_URL_RE.lastIndex = 0;
    let urlMatch;
    while ((urlMatch = SCRIPT_URL_RE.exec(content)) !== null) {
      const value = urlMatch[0].replace(/\\\//g, '/');
      if (!value) continue;
      matches.push({ value, tag: 'script', attribute: 'script-url', index: match.index + order * 0.001 });
      order++;
    }
  }
  return matches;
}

/**
 * @param {string} html
 * @returns {Array<{value: string, tag: string, attribute: string}>}
 */
export function extractHtmlCandidates(html) {
  if (typeof html !== 'string' || !html) return [];

  const found = [];

  for (const tag of TAGS) {
    for (const attribute of ATTRIBUTES) {
      for (const { raw, index } of collectAttribute(html, tag, attribute)) {
        if (!raw) continue;
        found.push({ value: raw, tag, attribute, index });
      }
    }
  }

  for (const tag of SRCSET_TAGS) {
    for (const attribute of SRCSET_ATTRIBUTES) {
      for (const { raw, index } of collectAttribute(html, tag, attribute)) {
        for (const { value, index: entryIndex } of collectSrcsetEntries(raw, index)) {
          found.push({ value, tag, attribute, index: entryIndex });
        }
      }
    }
  }

  for (const { value, tag, attribute, index } of collectStyle(html)) {
    found.push({ value, tag, attribute, index });
  }

  for (const { value, tag, attribute, index } of collectScriptUrls(html)) {
    found.push({ value, tag, attribute, index });
  }

  // Metatags sociais: <meta property="og:video" content="..."> etc.
  const metaRegex = /<meta\b[^>]*>/gi;
  let metaMatch;
  while ((metaMatch = metaRegex.exec(html)) !== null) {
    const tagText = metaMatch[0];
    const propertyMatch = tagText.match(/\b(?:property|name)\s*=\s*["']([^"']*?)["']/i);
    if (!propertyMatch) continue;
    if (!META_PROPERTIES.has(propertyMatch[1].trim().toLowerCase())) continue;
    const contentMatch = tagText.match(/\bcontent\s*=\s*["']([^"']*?)["']/i);
    const value = (contentMatch ? contentMatch[1].trim() : '');
    if (!value) continue;
    found.push({ value, tag: 'meta', attribute: 'content', index: metaMatch.index });
  }

  // Blocos JSON-LD: <script type="application/ld+json">...
  const jsonLdRegex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let jsonLdMatch;
  while ((jsonLdMatch = jsonLdRegex.exec(html)) !== null) {
    let parsed;
    try {
      parsed = JSON.parse(jsonLdMatch[1].trim());
    } catch {
      continue; // JSON inválido é ignorado.
    }
    let order = 0;
    const pushJsonLd = (raw) => {
      const value = raw.trim();
      if (!value) return;
      found.push({ value, tag: 'script', attribute: 'json-ld', index: jsonLdMatch.index + order * 0.001 });
      order++;
    };
    walkJsonLd(parsed, JSON_LD_KEYS, pushJsonLd);
  }

  // Preserva a ordem de aparição no HTML.
  found.sort((a, b) => a.index - b.index);

  // Remove duplicatas idênticas mantendo a primeira ocorrência.
  const seen = new Set();
  const result = [];
  for (const candidate of found) {
    if (seen.has(candidate.value)) continue;
    seen.add(candidate.value);
    const { index, ...rest } = candidate;
    result.push(rest);
  }

  return result;
}