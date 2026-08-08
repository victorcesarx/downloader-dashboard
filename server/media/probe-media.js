import { isPrivateHost } from '../middleware/ssrf.js';
import { parseMediaMetadata } from './parse-media-metadata.js';

const MAX_REDIRECTS = 5;
const PROBE_TIMEOUT_MS = 8000;
const MAX_PROBE_BYTES = 524288;

function positiveHeaderInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function totalSize(headers) {
  const range = headers.get('content-range');
  const match = range?.match(/\/(\d+)$/);
  return match ? positiveHeaderInt(match[1]) : positiveHeaderInt(headers.get('content-length'));
}

async function assertPublicUrl(value) {
  let parsed;
  try { parsed = new URL(value); } catch { throw Object.assign(new Error('Invalid URL'), { status: 400 }); }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw Object.assign(new Error('Only http/https URLs allowed'), { status: 400 });
  }
  if (await isPrivateHost(parsed.hostname)) {
    throw Object.assign(new Error('Access to private IPs is blocked'), { status: 403 });
  }
  return parsed;
}

async function requestWithSafeRedirects(targetUrl, method, range = null) {
  let current = (await assertPublicUrl(targetUrl)).href;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const headers = { 'User-Agent': 'Mozilla/5.0' };
    if (range) headers.Range = range;
    const response = await fetch(current, {
      method,
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (response.status < 300 || response.status >= 400) return { response, finalUrl: current };
    const location = response.headers.get('location');
    if (!location) return { response, finalUrl: current };
    if (redirects === MAX_REDIRECTS) throw Object.assign(new Error('Too many redirects'), { status: 502 });
    current = (await assertPublicUrl(new URL(location, current).href)).href;
  }
  throw Object.assign(new Error('Probe failed'), { status: 502 });
}

async function readBodyLimited(response, limit = MAX_PROBE_BYTES) {
  if (!response.body?.getReader) return Buffer.from(await response.arrayBuffer()).subarray(0, limit);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (total < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      const remaining = limit - total;
      chunks.push(chunk.subarray(0, remaining));
      total += Math.min(chunk.length, remaining);
    }
  } finally {
    try { await reader.cancel(); } catch { /* leitura limitada concluída */ }
  }
  return Buffer.concat(chunks, total);
}

export async function probeMedia(targetUrl) {
  const head = await requestWithSafeRedirects(targetUrl, 'HEAD');
  const prefix = await requestWithSafeRedirects(targetUrl, 'GET', 'bytes=0-262143');
  const result = prefix.response.ok || prefix.response.status === 206 ? prefix : head;
  const { response, finalUrl } = result;
  if (!response.ok && response.status !== 206) {
    throw Object.assign(new Error(`Remote server returned ${response.status}`), { status: 502 });
  }
  const prefixBuffer = prefix.response.ok || prefix.response.status === 206
    ? await readBodyLimited(prefix.response, 262144) : Buffer.alloc(0);
  let parsed = parseMediaMetadata(prefixBuffer);
  const headSize = totalSize(head.response.headers);
  const size = headSize ?? totalSize(prefix.response.headers);
  if (parsed.container === 'mp4' && (!parsed.duration || !parsed.width || !parsed.height) && size > prefixBuffer.length) {
    const suffix = await requestWithSafeRedirects(targetUrl, 'GET', 'bytes=-524288');
    if (suffix.response.ok || suffix.response.status === 206) {
      const suffixParsed = parseMediaMetadata(await readBodyLimited(suffix.response));
      parsed = {
        container: parsed.container || suffixParsed.container,
        width: parsed.width || suffixParsed.width,
        height: parsed.height || suffixParsed.height,
        duration: parsed.duration || suffixParsed.duration,
      };
    }
  }
  const contentType = head.response.headers.get('content-type') || response.headers.get('content-type');
  return {
    size,
    mimeType: contentType?.split(';')[0]?.trim() || null,
    container: parsed.container,
    width: parsed.width,
    height: parsed.height,
    duration: parsed.duration,
    acceptRanges: head.response.headers.get('accept-ranges') || response.headers.get('accept-ranges') || null,
    contentDisposition: head.response.headers.get('content-disposition') || response.headers.get('content-disposition') || null,
    etag: head.response.headers.get('etag') || response.headers.get('etag') || null,
    lastModified: head.response.headers.get('last-modified') || response.headers.get('last-modified') || null,
    finalUrl,
    probedAt: new Date().toISOString(),
    unavailable: {
      size: size === null ? 'missing_header' : null,
      dimensions: parsed.width && parsed.height ? null : 'not_found_in_bounded_probe',
      duration: Number.isFinite(parsed.duration) ? null : 'not_found_in_bounded_probe',
    },
  };
}
