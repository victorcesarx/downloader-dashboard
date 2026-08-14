import path from 'path';
import { fetchText } from '../utils.js';

const IMAGEPOND_ORIGIN = 'https://www.imagepond.net';
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'aac', 'ogg', 'wav', 'flac']);

function decodeHtml(value = '') {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .trim();
}

function getAttribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return match ? decodeHtml(match[2]) : '';
}

function getMeta(html, key) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const identifier = getAttribute(tag, 'property') || getAttribute(tag, 'name');
    if (identifier.toLowerCase() === key.toLowerCase()) return getAttribute(tag, 'content');
  }
  return '';
}

function getExtension(nameOrUrl) {
  try {
    return path.extname(new URL(nameOrUrl).pathname).slice(1).toLowerCase();
  } catch {
    return path.extname(nameOrUrl).slice(1).toLowerCase();
  }
}

function classifyMedia(ext, mime = '') {
  if (mime.startsWith('video/') || VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (mime.startsWith('audio/') || AUDIO_EXTENSIONS.has(ext)) return 'audio';
  return 'image';
}

export function parseImagePondItemPage(pageUrl, html) {
  if (!html) return null;

  const videoUrl = getMeta(html, 'og:video') || getMeta(html, 'og:video:url');
  const imageUrl = getMeta(html, 'og:image');
  const directUrl = videoUrl || imageUrl;
  if (!directUrl) return null;

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const pageTitle = decodeHtml(titleMatch?.[1] || '').replace(/\s+-\s+ImagePond\s*$/i, '').trim();
  const urlName = decodeURIComponent(new URL(directUrl, pageUrl).pathname.split('/').pop() || 'media');
  const name = pageTitle || urlName;
  const mime = videoUrl ? (getMeta(html, 'og:video:type') || 'video/mp4') : (getMeta(html, 'og:image:type') || '');
  const ext = getExtension(name) || getExtension(directUrl);
  const type = classifyMedia(ext, mime);
  const width = Number(getMeta(html, videoUrl ? 'og:video:width' : 'og:image:width')) || undefined;
  const height = Number(getMeta(html, videoUrl ? 'og:video:height' : 'og:image:height')) || undefined;

  return {
    type,
    name,
    url: new URL(directUrl, pageUrl).href,
    ext,
    label: mime || type,
    size: 0,
    thumbnail: imageUrl ? new URL(imageUrl, pageUrl).href : null,
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
  };
}

export function extractImagePondItemUrls(html, baseUrl = IMAGEPOND_ORIGIN) {
  const urls = [];
  const seen = new Set();
  // Album cards use Alpine's `:href` with a JavaScript expression instead of
  // a plain href. Looking for canonical item paths handles both variants.
  const hrefPattern = /https?:\/\/(?:www\.)?imagepond\.net\/i\/[a-zA-Z0-9]+|(?<![a-zA-Z0-9.])\/i\/[a-zA-Z0-9]+/gi;
  let match;

  while ((match = hrefPattern.exec(html || ''))) {
    try {
      const itemUrl = new URL(decodeHtml(match[0]), baseUrl);
      if (!/(?:^|\.)imagepond\.net$/i.test(itemUrl.hostname) || !/^\/i\/[a-zA-Z0-9]+\/?$/.test(itemUrl.pathname)) continue;
      itemUrl.hash = '';
      itemUrl.search = '';
      const normalized = itemUrl.href.replace(/\/$/, '');
      if (!seen.has(normalized)) {
        seen.add(normalized);
        urls.push(normalized);
      }
    } catch {
      // Ignore malformed links found in third-party markup.
    }
  }
  return urls;
}

async function mapWithConcurrency(values, limit, mapper) {
  const results = new Array(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await mapper(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function scrapeImagePond(url) {
  const parsedUrl = new URL(url);
  if (!/(?:^|\.)imagepond\.net$/i.test(parsedUrl.hostname)) return null;
  const html = await fetchText(parsedUrl.href, { Referer: `${IMAGEPOND_ORIGIN}/` });
  if (!html) return null;

  if (/^\/i\/[a-zA-Z0-9]+\/?$/.test(parsedUrl.pathname)) {
    const item = parseImagePondItemPage(parsedUrl.href, html);
    return item ? { title: item.name, url: parsedUrl.href, items: [item] } : null;
  }

  if (/^\/a\/[a-zA-Z0-9]+\/?$/.test(parsedUrl.pathname)) {
    const itemUrls = extractImagePondItemUrls(html, parsedUrl.origin);
    const items = await mapWithConcurrency(itemUrls, 6, async itemUrl => {
      const itemHtml = await fetchText(itemUrl, { Referer: parsedUrl.href });
      return parseImagePondItemPage(itemUrl, itemHtml);
    });
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = decodeHtml(titleMatch?.[1] || 'ImagePond Album').replace(/\s+-\s+ImagePond\s*$/i, '').trim();
    return { title: title || 'ImagePond Album', url: parsedUrl.href, items: items.filter(Boolean) };
  }

  return null;
}
