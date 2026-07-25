export const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg'
};

export const CACHE_DURATIONS = {
  '.html': 'no-cache',
  '.css': 'max-age=3600',
  '.js': 'max-age=3600',
  '.json': 'no-cache',
  '.png': 'max-age=86400',
  '.jpg': 'max-age=86400',
  '.jpeg': 'max-age=86400',
  '.gif': 'max-age=86400',
  '.svg': 'max-age=86400',
  '.ico': 'max-age=86400',
  '.mp4': 'max-age=3600',
  '.webm': 'max-age=3600',
  '.mp3': 'max-age=3600'
};

export const cookieJar = new Map();

function getCookies(domain) {
  return cookieJar.get(domain) || '';
}

function setCookies(domain, cookieString) {
  if (!cookieString) return;
  const existing = cookieJar.get(domain) || '';
  const newCookies = cookieString.split(';').map(c => c.trim()).filter(Boolean);
  const merged = new Map();
  existing.split(';').filter(Boolean).forEach(c => {
    const [k, ...v] = c.split('=');
    if (k) merged.set(k.trim(), v.join('='));
  });
  newCookies.forEach(c => {
    const [k, ...v] = c.split('=');
    if (k) merged.set(k.trim(), v.join('='));
  });
  const result = [...merged.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  cookieJar.set(domain, result);
}

export async function fetchWithCookies(url, options = {}) {
  const domain = new URL(url).hostname;
  const cookies = getCookies(domain);
  if (cookies) {
    options.headers = { ...options.headers, Cookie: cookies };
  }
  const res = await fetch(url, options);
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    setCookies(domain, setCookie);
  }
  return res;
}

export async function fetchText(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const origin = new URL(url).origin;
    const res = await fetchWithCookies(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': origin + '/',
        ...headers
      },
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.warn(`[fetchText] ${res.status} for ${url}`);
      return null;
    }
    const text = await res.text();
    if (!text || text.length < 50) {
      console.warn(`[fetchText] Empty or too short body from ${url} (${text?.length || 0} chars)`);
      return null;
    }
    return text;
  } catch (err) {
    clearTimeout(timer);
    console.warn(`[fetchText] Error ${url}: ${err.message}`);
    return null;
  }
}

export function extractOGImage(html) {
  const match = html.match(/property=["']og:image["']\s+content=["']([^"']+)["']/i) ||
                html.match(/content=["']([^"']+)["']\s+property=["']og:image["']/i) ||
                html.match(/name=["']twitter:image["']\s+content=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

export function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function enrichItemSizes(items) {
  const todo = items.filter(i => !i.size && i.url);
  if (todo.length === 0) return;
  console.log(`[Sizes] Fetching sizes for ${todo.length} item(s)`);
  const fetchSize = async (url) => {
    for (const method of ['HEAD', 'GET']) {
      try {
        const headers = { 'User-Agent': 'Mozilla/5.0' };
        if (method === 'GET') headers['Range'] = 'bytes=0-0';
        const res = await fetch(url, { method, headers, signal: AbortSignal.timeout(5000) });
        const cl = res.headers.get('content-length');
        if (cl) return parseInt(cl, 10);
        const cr = res.headers.get('content-range');
        if (cr) {
          const m = cr.match(/\/(\d+)$/);
          if (m) return parseInt(m[1], 10);
        }
      } catch (e) {
        console.log(`[Sizes] ${method} failed for ${url.substring(0, 80)}: ${e.message}`);
      }
    }
    return 0;
  };
  await Promise.allSettled(todo.map(async (item) => {
    const size = await fetchSize(item.url);
    if (size) {
      item.size = size;
      console.log(`[Sizes] ${item.name || 'item'}: ${(size / 1024 / 1024).toFixed(1)} MB`);
    } else {
      console.log(`[Sizes] ${item.name || 'item'}: no size (${item.url.substring(0, 80)})`);
    }
    if (item.qualities) {
      await Promise.allSettled(item.qualities.map(async (q) => {
        if (q.size) return;
        const qs = await fetchSize(q.url);
        if (qs) q.size = qs;
      }));
    }
  }));
}

export function sanitizeZipName(name) {
  if (!name) return null;
  let safe = name.replace(/\\/g, '/').split('/').pop();
  safe = safe.replace(/\.\./g, '').replace(/[\x00-\x1f]/g, '').trim();
  return safe || null;
}

export { getCookies, setCookies };
