import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import archiver from 'archiver';
import { createHash } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT, 10) || 3006;
const TEMP_DIR = path.join(__dirname, 'temp_zips');

// Auth — set DOWNDASH_TOKEN env var to enable
const AUTH_TOKEN = process.env.DOWNDASH_TOKEN || null;

// HTTPS — place cert.pem + key.pem in a "certs" folder next to server.js
const CERTS_DIR = path.join(__dirname, 'certs');
let httpsOptions = null;
try {
  const certPath = path.join(CERTS_DIR, 'cert.pem');
  const keyPath = path.join(CERTS_DIR, 'key.pem');
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    httpsOptions = {
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath)
    };
  }
} catch (e) {
  console.warn('[HTTPS] Failed to load cert files, falling back to HTTP only');
}

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// In-memory Store for ZIP tasks
const zipTasks = new Map();

// Helper: Content-Type MIME Mapping for static files
const MIME_TYPES = {
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

// Static cache durations by extension
const CACHE_DURATIONS = {
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

// Auth helper — returns 401 if token is required but missing/invalid
function requireAuth(req, res) {
  if (!AUTH_TOKEN) return true;
  const header = req.headers['authorization'] || '';
  const queryToken = new URL(req.url, `http://${req.headers.host}`).searchParams.get('token');
  const provided = header.startsWith('Bearer ') ? header.slice(7) : queryToken;
  if (provided === AUTH_TOKEN) return true;
  if (req.method === 'OPTIONS') return true;
  return false;
}

function sendUnauthorized(res) {
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Unauthorized — provide DOWNDASH_TOKEN via Authorization header or ?token=' }));
}

// -------------------------------------------------------------
// Scrapers Implementation
// -------------------------------------------------------------

// Simple cookie jar for persisting cookies across requests per domain
const cookieJar = new Map();

function getCookies(domain) {
  return cookieJar.get(domain) || '';
}

function setCookies(domain, cookieString) {
  if (!cookieString) return;
  const existing = cookieJar.get(domain) || '';
  const newCookies = cookieString.split(';').map(c => c.trim()).filter(Boolean);
  const merged = new Map();
  // Parse existing cookies
  existing.split(';').filter(Boolean).forEach(c => {
    const [k, ...v] = c.split('=');
    if (k) merged.set(k.trim(), v.join('='));
  });
  // Merge new cookies
  newCookies.forEach(c => {
    const [k, ...v] = c.split('=');
    if (k) merged.set(k.trim(), v.join('='));
  });
  const result = [...merged.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  cookieJar.set(domain, result);
}

async function fetchWithCookies(url, options = {}) {
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

// Helper: Standard Fetch text helper with User-Agent
async function fetchText(url, headers = {}) {
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

// Helper: extract og:image from HTML as fallback thumbnail
function extractOGImage(html) {
  const match = html.match(/property=["']og:image["']\s+content=["']([^"']+)["']/i) ||
                html.match(/content=["']([^"']+)["']\s+property=["']og:image["']/i) ||
                html.match(/name=["']twitter:image["']\s+content=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// GoFile In-Memory Token & WT Cache
let cachedGoFileToken = null;
let cachedGoFileWT = null;
let lastGoFileRefresh = 0;
const GOFILE_REFRESH_INTERVAL = 30 * 60 * 1000; // 30 min

// Fetch and extract the WT from GoFile's config.js
async function fetchGoFileWT() {
  try {
    const res = await fetch('https://gofile.io/dist/js/config.js', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;
    const js = await res.text();
    const match = js.match(/appdata\.wt\s*=\s*"([^"]+)"/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// generateWT: GoFile uses SHA-256(token) as the X-Website-Token header.
function generateWT(token) {
  return createHash('sha256').update(token || '').digest('hex');
}

async function createGoFileToken() {
  try {
    const accRes = await fetch('https://api.gofile.io/accounts', {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Origin': 'https://gofile.io',
        'Referer': 'https://gofile.io/'
      }
    });
    if (accRes.ok) {
      const accData = await accRes.json();
      if (accData.status === 'ok' && accData.data && accData.data.token) {
        return accData.data.token;
      }
    }
    if (accRes.status === 429) {
      console.warn('[GoFile] Rate-limited, waiting 15s before retry...');
      await new Promise(r => setTimeout(r, 15000));
      const retryRes = await fetch('https://api.gofile.io/accounts', {
        method: 'POST',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Origin': 'https://gofile.io',
          'Referer': 'https://gofile.io/'
        }
      });
      if (retryRes.ok) {
        const retryData = await retryRes.json();
        if (retryData.status === 'ok' && retryData.data && retryData.data.token) {
          return retryData.data.token;
        }
      }
    }
  } catch (e) {
    console.error('GoFile account creation failed:', e.message);
  }
  return null;
}

async function ensureGoFileSession() {
  const now = Date.now();
  if (!cachedGoFileWT || (now - lastGoFileRefresh) > GOFILE_REFRESH_INTERVAL) {
    const freshWT = await fetchGoFileWT();
    if (freshWT) {
      cachedGoFileWT = freshWT;
      console.log(`[GoFile] WT refreshed: ${cachedGoFileWT}`);
    } else if (!cachedGoFileWT) {
      cachedGoFileWT = '4fd6sg89d7s6'; // fallback
    }
    lastGoFileRefresh = now;
  }
  if (!cachedGoFileToken) {
    cachedGoFileToken = await createGoFileToken();
  }
  return cachedGoFileToken && cachedGoFileWT;
}

async function fetchGoFileContents(contentId, token) {
  const wt = generateWT(token);
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Authorization': `Bearer ${token}`,
    'X-Website-Token': wt,
    'X-BL': 'en-US',
    'Cookie': `accountToken=${token}`,
    'Origin': 'https://gofile.io',
    'Referer': 'https://gofile.io/'
  };
  return fetch(`https://api.gofile.io/contents/${contentId}?wt=${cachedGoFileWT}&page=1&pageSize=1000`, { headers });
}

// 1. GoFile Scraper
async function scrapeGoFile(url) {
  const match = url.match(/gofile\.io\/d\/([a-zA-Z0-9]+)/);
  if (!match) return null;
  const contentId = match[1];

  // --- Strategy 1: Official GoFile API ---
  try {
    const sessionOk = await ensureGoFileSession();
    if (sessionOk) {
      let contentRes = await fetchGoFileContents(contentId, cachedGoFileToken);

      // Refresh session on failure and retry once
      if (!contentRes.ok) {
        console.warn(`[GoFile] API error ${contentRes.status}, refreshing session...`);
        cachedGoFileToken = null;
        cachedGoFileWT = null;
        lastGoFileRefresh = 0;
        const retryOk = await ensureGoFileSession();
        if (retryOk) {
          contentRes = await fetchGoFileContents(contentId, cachedGoFileToken);
        }
      }

      if (contentRes && contentRes.ok) {
        const contentData = await contentRes.json();
        if (contentData.status === 'ok' && contentData.data) {
          const folder = contentData.data;
          const items = [];
          const children = folder.children || {};

          for (const key of Object.keys(children)) {
            const file = children[key];
            if (file.type === 'file') {
              const ext = (file.name.split('.').pop() || '').toLowerCase();
              let type = 'document';
              if (['mp4', 'mkv', 'webm', 'mov', 'avi'].includes(ext)) type = 'video';
              else if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) type = 'image';
              else if (['mp3', 'wav', 'flac', 'm4a', 'ogg'].includes(ext)) type = 'audio';

              items.push({
                type, name: file.name, url: file.link, ext,
                label: file.mimetype || type, size: file.size || 0,
                thumbnail: file.thumbnail || null
              });
            }
          }

          return { title: folder.name || `GoFile (${contentId})`, url, items };
        }
      }
    }
  } catch (apiErr) {
    console.error('GoFile API unreachable, trying HTML fallback:', apiErr.message);
  }

  // --- Strategy 2: HTML page scraping fallback ---
  // GoFile renders file data into the page HTML as JSON in a <script> tag
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);

    const pageRes = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br'
      }
    });
    clearTimeout(timer);

    if (!pageRes.ok) {
      return { title: `GoFile (${contentId})`, url, items: [] };
    }

    const html = await pageRes.text();
    const items = [];
    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    const pageTitle = titleMatch ? titleMatch[1].replace('Gofile', '').trim() : `GoFile (${contentId})`;

    // Extract direct download URLs from JSON embedded in HTML:
    // GoFile embeds file data in a global JS variable or in og meta tags

    // 1. Try og:video tags (single file pages)
    const ogVideoMatches = [...html.matchAll(/property=["']og:video["']\s+content=["']([^"']+)["']/gi),
                            ...html.matchAll(/content=["']([^"']+)["']\s+property=["']og:video["']/gi)];
    for (const m of ogVideoMatches) {
      const mediaUrl = m[1];
      const name = mediaUrl.split('/').pop().split('?')[0] || 'gofile_video';
      const ext = (name.split('.').pop() || 'mp4').toLowerCase();
      items.push({ type: 'video', name, url: mediaUrl, ext, label: 'video', size: 0 });
    }

    // 2. Try og:image (if no video)
    if (items.length === 0) {
      const ogImageMatch = html.match(/property=["']og:image["']\s+content=["']([^"']+)["']/i) ||
                           html.match(/content=["']([^"']+)["']\s+property=["']og:image["']/i);
      if (ogImageMatch && !ogImageMatch[1].includes('logo')) {
        const mediaUrl = ogImageMatch[1];
        const name = mediaUrl.split('/').pop().split('?')[0] || 'gofile_image';
        const ext = (name.split('.').pop() || 'jpg').toLowerCase();
        items.push({ type: 'image', name, url: mediaUrl, ext, label: 'image', size: 0 });
      }
    }

    // 3. Scan for any direct CDN/store.gofile.io links in the HTML
    if (items.length === 0) {
      const cdnRegex = /https?:\/\/store[0-9]*\.gofile\.io\/[^\s"'<>]+/gi;
      const cdnMatches = [...html.matchAll(cdnRegex)];
      const seen = new Set();
      for (const m of cdnMatches) {
        const mediaUrl = m[0].replace(/['"\\]/g, '');
        if (seen.has(mediaUrl)) continue;
        seen.add(mediaUrl);
        const name = mediaUrl.split('/').pop().split('?')[0] || 'gofile_file';
        const ext = (name.split('.').pop() || '').toLowerCase();
        let type = 'document';
        if (['mp4', 'mkv', 'webm', 'mov'].includes(ext)) type = 'video';
        else if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) type = 'image';
        else if (['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) type = 'audio';
        items.push({ type, name, url: mediaUrl, ext, label: type, size: 0 });
      }
    }

    // 4. Generic media link scan as last resort
    if (items.length === 0) {
      const mediaRegex = /(?:href|src|content)=["'](https?:\/\/[^\s"'<>]+\.(?:mp4|mkv|webm|mov|jpg|jpeg|png|gif|webp|mp3|wav))["']/gi;
      const seen = new Set();
      let match;
      while ((match = mediaRegex.exec(html)) !== null) {
        const mediaUrl = match[1];
        if (seen.has(mediaUrl)) continue;
        seen.add(mediaUrl);
        const name = mediaUrl.split('/').pop().split('?')[0] || 'gofile_file';
        const ext = (name.split('.').pop() || '').toLowerCase();
        let type = 'document';
        if (['mp4', 'mkv', 'webm', 'mov'].includes(ext)) type = 'video';
        else if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) type = 'image';
        else if (['mp3', 'wav', 'ogg'].includes(ext)) type = 'audio';
        items.push({ type, name, url: mediaUrl, ext, label: type, size: 0 });
      }
    }

    return { title: pageTitle, url, items };
  } catch (htmlErr) {
    console.error('GoFile HTML fallback failed:', htmlErr.message);
    return null;
  }
}

// 2. PixelDrain Scraper
async function scrapePixelDrain(url) {
  try {
    const fileMatch = url.match(/pixeldrain\.com\/u\/([a-zA-Z0-9]+)/);
    const listMatch = url.match(/pixeldrain\.com\/l\/([a-zA-Z0-9]+)/);

    if (fileMatch) {
      const fileId = fileMatch[1];
      const directUrl = `https://pixeldrain.com/api/file/${fileId}`;
      let name = `PixelDrain_${fileId}`;
      let size = 0;
      let mime = '';

      try {
        const infoRes = await fetch(`https://pixeldrain.com/api/file/${fileId}/info`);
        if (infoRes.ok) {
          const info = await infoRes.json();
          name = info.name || name;
          size = info.size || 0;
          mime = info.mime_type || '';
        }
      } catch (e) {}

      const ext = (name.split('.').pop() || '').toLowerCase();
      let type = 'document';
      if (['mp4', 'webm', 'mkv'].includes(ext) || mime.startsWith('video/')) type = 'video';
      else if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext) || mime.startsWith('image/')) type = 'image';
      else if (['mp3', 'wav', 'ogg'].includes(ext) || mime.startsWith('audio/')) type = 'audio';

      let thumbnail = null;
      if (type === 'video') {
        try {
          const pageHtml = await fetchText(url);
          if (pageHtml) {
            thumbnail = extractOGImage(pageHtml);
          }
        } catch (e) {}
      }

      return {
        title: name,
        url,
        items: [{ type, name, url: directUrl, ext, label: mime || type, size, thumbnail }]
      };
    }

    if (listMatch) {
      const listId = listMatch[1];
      const listRes = await fetch(`https://pixeldrain.com/api/list/${listId}`);
      if (!listRes.ok) return null;
      const listData = await listRes.json();
      const files = listData.files || [];

      const items = files.map(f => {
        const ext = (f.name.split('.').pop() || '').toLowerCase();
        let type = 'document';
        if (['mp4', 'webm', 'mkv'].includes(ext)) type = 'video';
        else if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) type = 'image';
        else if (['mp3', 'wav', 'ogg'].includes(ext)) type = 'audio';

        return {
          type,
          name: f.name,
          url: `https://pixeldrain.com/api/file/${f.id}`,
          ext,
          label: type,
          size: f.size || 0
        };
      });

      return {
        title: listData.title || `PixelDrain List (${listId})`,
        url,
        items
      };
    }
  } catch (err) {
    console.error('PixelDrain Scrape Error:', err);
  }
  return null;
}

// 3. CyberDrop Scraper (album + single-file)
async function scrapeCyberDrop(url) {
  try {
    if (!url.includes('cyberdrop.')) return null;
    const html = await fetchText(url);
    if (!html) return null;

    // Diagnostic log
    const titleM = html.match(/<title>(.*?)<\/title>/i);
    console.log(`[CyberDrop] title="${titleM ? titleM[1] : 'N/A'}" len=${html.length} og:video=${/og:video/i.test(html)} <video>=${/<video/i.test(html)} <source>=${/<source/i.test(html)} og:image=${/og:image/i.test(html)} img=${/<img\s/i.test(html)}`);

    // Detect Cloudflare challenge (exclude Turnstile widget which just adds a widget to the page)
    const cfPatterns = ['cf-browser-', 'challenge-platform', 'Just a moment', 'Attention Required', 'Cloudflare Ray ID', 'cf-error-details'];
    if (cfPatterns.some(p => html.includes(p))) {
      console.warn(`[CyberDrop] Blocked by Cloudflare challenge: ${url}`);
      // Retry once after a brief delay — sometimes Cloudflare releases after a moment
      await new Promise(r => setTimeout(r, 3000));
      const retryHtml = await fetchText(url);
      if (retryHtml && !cfPatterns.some(p => retryHtml.includes(p))) {
        return scrapeCyberDropWithHtml(url, retryHtml);
      }
      return null;
    }

    return await scrapeCyberDropWithHtml(url, html);

  } catch (err) {
    console.error('CyberDrop Scrape Error:', err);
    return null;
  }
}

async function scrapeCyberDropWithHtml(url, html) {
  const items = [];
  const seen = new Set();
  const isFilePage = url.includes('/f/');

  // Collect potential video thumbnails from the page (skip icons/logos)
  const thumbUrls = [];
  const imgTagRegex = /<img[^>]*src=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp|gif))["'][^>]*>/gi;
  let imgMatch;
  while ((imgMatch = imgTagRegex.exec(html)) !== null) {
    const src = imgMatch[1];
    if (/icon|logo|avatar|spinner|loading|thumb-|emoji|favicon/i.test(src)) continue;
    if (thumbUrls.length < 5 && !thumbUrls.includes(src)) thumbUrls.push(src);
  }

  function isMediaUrl(urlStr) {
    if (/icon|logo|avatar|spinner|loading|banner|sprite|favicon|emoji|placeholder/i.test(urlStr)) return false;
    if (/\/assets?\//i.test(urlStr)) return false;
    return true;
  }

  function parseUrl(mediaUrl) {
    const rawName = mediaUrl.split('/').pop()?.split('?')[0] || 'media_file';
    const name = decodeURIComponent(rawName);
    const ext = (name.split('.').pop() || '').toLowerCase();
    let type = 'document';
    if (['mp4', 'webm', 'mkv', 'mov'].includes(ext)) type = 'video';
    else if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) type = 'image';
    else if (['mp3', 'wav', 'ogg'].includes(ext)) type = 'audio';
    return { name, ext, type };
  }

  function addItem(mediaUrl, thumb = null, forcedType = null) {
    if (seen.has(mediaUrl)) return;
    if (!isMediaUrl(mediaUrl)) return;
    seen.add(mediaUrl);
    const { name, ext, type: detectedType } = parseUrl(mediaUrl);
    const finalType = forcedType || detectedType;
    items.push({
      type: finalType, name, url: mediaUrl, ext,
      label: finalType, size: 0,
      thumbnail: finalType !== 'image' ? (thumb || null) : null
    });
  }

  const titleMatch = html.match(/<title>(.*?)<\/title>/i);
  const pageTitle = titleMatch ? titleMatch[1].trim() : 'CyberDrop';

  async function resolveCyberDropFile(slug, thumb = null) {
    try {
      const infoRes = await fetchWithCookies(`https://api.cyberdrop.cr/api/file/info/${slug}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'Accept': 'application/json' }
      });
      if (!infoRes.ok) return null;
      const info = await infoRes.json();
      if (!info || !info.auth_url) return null;

      const authRes = await fetchWithCookies(info.auth_url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'Accept': 'application/json' }
      });
      if (!authRes.ok) return null;
      const authData = await authRes.json();
      if (!authData || !authData.url) return null;

      return {
        url: authData.url,
        name: info.name || `cyberdrop_${slug}`,
        size: info.size || 0,
        type: info.type || 'video/mp4',
        thumbnail: info.thumbnail_url || (thumb && isMediaUrl(thumb) ? thumb : null)
      };
    } catch (e) { return null; }
  }

  // ----- SINGLE FILE PAGE (/f/) -----
  if (isFilePage) {

    // Collect potential video thumbnails from the page (skip icons/logos)
    const thumbUrls = [];
    const imgTagRegex = /<img[^>]*src=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp|gif))["'][^>]*>/gi;
    let imgMatch;
    while ((imgMatch = imgTagRegex.exec(html)) !== null) {
      const src = imgMatch[1];
      if (/icon|logo|avatar|spinner|loading|thumb-|emoji|favicon/i.test(src)) continue;
      if (thumbUrls.length < 5 && !thumbUrls.includes(src)) thumbUrls.push(src);
    }

    // Check if a URL is likely a real media file (not a layout asset)
    function isMediaUrl(urlStr) {
      if (/icon|logo|avatar|spinner|loading|banner|sprite|favicon|emoji|placeholder/i.test(urlStr)) return false;
      if (/\/assets?\//i.test(urlStr)) return false;
      return true;
    }

    // Compute extension, type, and name from a URL
    function parseUrl(mediaUrl) {
      const rawName = mediaUrl.split('/').pop()?.split('?')[0] || 'media_file';
      const name = decodeURIComponent(rawName);
      const ext = (name.split('.').pop() || '').toLowerCase();
      let type = 'document';
      if (['mp4', 'webm', 'mkv', 'mov'].includes(ext)) type = 'video';
      else if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) type = 'image';
      else if (['mp3', 'wav', 'ogg'].includes(ext)) type = 'audio';
      return { name, ext, type };
    }

    function addItem(mediaUrl, thumb = null, forcedType = null) {
      if (seen.has(mediaUrl)) return;
      if (!isMediaUrl(mediaUrl)) return;
      seen.add(mediaUrl);
      const { name, ext, type: detectedType } = parseUrl(mediaUrl);
      const finalType = forcedType || detectedType;
      items.push({
        type: finalType, name, url: mediaUrl, ext,
        label: finalType, size: 0,
        thumbnail: finalType !== 'image' ? (thumb || null) : null
      });
    }

    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    const pageTitle = titleMatch ? titleMatch[1].trim() : 'CyberDrop';

    // API client for resolving CyberDrop file slugs
    async function resolveCyberDropFile(slug, thumb = null) {
      try {
        const infoRes = await fetchWithCookies(`https://api.cyberdrop.cr/api/file/info/${slug}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'Accept': 'application/json' }
        });
        if (!infoRes.ok) return null;
        const info = await infoRes.json();
        if (!info || !info.auth_url) return null;

        const authRes = await fetchWithCookies(info.auth_url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'Accept': 'application/json' }
        });
        if (!authRes.ok) return null;
        const authData = await authRes.json();
        if (!authData || !authData.url) return null;

        return {
          url: authData.url,
          name: info.name || `cyberdrop_${slug}`,
          size: info.size || 0,
          type: info.type || 'video/mp4',
          thumbnail: info.thumbnail_url || (thumb && isMediaUrl(thumb) ? thumb : null)
        };
      } catch (e) { return null; }
    }

    // ----- SINGLE FILE PAGE (/f/) -----
    if (isFilePage) {
      const slug = url.match(/\/[a-z]\/([a-zA-Z0-9]+)/)?.[1];
      if (slug) {
        const resolved = await resolveCyberDropFile(slug);
        if (resolved) {
          items.push({
            type: 'video',
            name: resolved.name,
            url: resolved.url,
            ext: (resolved.type || '').split('/')[1] || 'mp4',
            label: 'video',
            size: resolved.size,
            thumbnail: resolved.thumbnail
          });
        }
      }
      // Fallback: only if API failed, try HTML parsing
      if (items.length === 0) {
        const ogVideo = html.match(/property=["']og:video["']\s+content=["']([^"']+)["']/i)
                     || html.match(/content=["']([^"']+)["']\s+property=["']og:video["']/i);
        if (ogVideo) addItem(ogVideo[1], extractOGImage(html) || thumbUrls[0] || null, 'video');
      }
      if (items.length === 0) {
        console.log(`[CyberDrop] API + HTML fallback failed for ${url}`);
      }
    }

    // ----- ALBUM PAGE -----
    else {
      // 1. <a href="..."> with known extensions
      const linkRegex = /href=["'](https?:\/\/[^"']+\.(?:mp4|mkv|webm|jpg|jpeg|png|webp|gif|mp3|wav))["']/gi;
      let match;
      let thumbIdx = 0;
      while ((match = linkRegex.exec(html)) !== null) {
        const mediaUrl = match[1];
        if (seen.has(mediaUrl)) continue;
        if (!isMediaUrl(mediaUrl)) continue;
        seen.add(mediaUrl);
        const { name, ext, type } = parseUrl(mediaUrl);
        const thumbForItem = type === 'video' && thumbIdx < thumbUrls.length ? thumbUrls[thumbIdx++] : null;
        items.push({ type, name, url: mediaUrl, ext, label: type, size: 0, thumbnail: thumbForItem });
      }

      // 2. <a href="/f/xxxxx"> file page links (common in albums)
      // Each links to a file page; try to resolve via API
      const fileLinkRegex = /<a[^>]*href=["'](?:\/f\/|https?:\/\/[^"']*\/f\/)([a-zA-Z0-9]+)["'][^>]*>[\s\S]*?<img[^>]*src=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp|gif))["']/gi;
      let fm;
      while ((fm = fileLinkRegex.exec(html)) !== null && items.length < 50) {
        const fileId = fm[1];
        const thumbUrl = fm[2];
        if (seen.has(fileId)) continue;
        seen.add(fileId);
        if (thumbUrls.length < 10 && !thumbUrls.includes(thumbUrl) && isMediaUrl(thumbUrl)) thumbUrls.push(thumbUrl);

        const resolved = await resolveCyberDropFile(fileId, thumbUrl);
        if (resolved) {
          items.push({
            type: 'video',
            name: resolved.name,
            url: resolved.url,
            ext: (resolved.type || '').split('/')[1] || 'mp4',
            label: 'video',
            size: resolved.size,
            thumbnail: resolved.thumbnail
          });
        }
      }

      // 3. Fallback: video/img src attributes
      if (items.length === 0) {
        const fallbackRegex = /src=["'](https?:\/\/[^"']+\.(?:mp4|mkv|webm|mov|jpg|jpeg|png|webp|gif))["']/gi;
        while ((match = fallbackRegex.exec(html)) !== null) {
          const mediaUrl = match[1];
          if (seen.has(mediaUrl)) continue;
          if (!isMediaUrl(mediaUrl)) continue;
          seen.add(mediaUrl);
          const { name, ext, type } = parseUrl(mediaUrl);
          items.push({ type, name, url: mediaUrl, ext, label: type, size: 0 });
        }
      }

      // 4. Try video source tags
      if (items.length === 0) {
        const videoSrcRegex = /<source[^>]+src=["'](https?:\/\/[^"']+\.(?:mp4|mkv|webm|mov))["']/gi;
        while ((match = videoSrcRegex.exec(html)) !== null) {
          const mediaUrl = match[1];
          if (seen.has(mediaUrl)) continue;
          if (!isMediaUrl(mediaUrl)) continue;
          seen.add(mediaUrl);
          const { name, ext } = parseUrl(mediaUrl);
          items.push({ type: 'video', name, url: mediaUrl, ext, label: 'video', size: 0 });
        }
      }
    }

    if (items.length === 0 && isFilePage) {
      console.warn(`[CyberDrop] No media found for ${url} — page may require JS to load video`);
    }
    return { title: pageTitle, url, items };
  }
}

// 4. Bunkr Scraper (Supports single file resolution & albums)
async function scrapeBunkr(url) {
  try {
    if (!url.includes('bunkr.')) return null;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!res.ok) return null;
    const html = await res.text();
    const items = [];

    // Check for single file download page link e.g. href="https://dl.bunkr.cr/file/46805720"
    const dlLinkMatch = html.match(/href=["'](https?:\/\/dl\.bunkr\.[a-z]+\/file\/([0-9]+))["']/i) || html.match(/href=["'](https?:\/\/[^"']+\/file\/([0-9]+))["']/i);

    if (dlLinkMatch) {
      const dlPageUrl = dlLinkMatch[1];
      const fileId = dlLinkMatch[2];
      const dlHost = new URL(dlPageUrl).origin;

      try {
        const metaRes = await fetch(`${dlHost}/api/_001_v2`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          },
          body: JSON.stringify({ id: fileId })
        });

        if (metaRes.ok) {
          const meta = await metaRes.json();
          const rawUrl = new URL(meta.mediafiles + meta.path);
          if (meta.original) rawUrl.searchParams.set('n', meta.original);

          let directUrl = null;
          let name = meta.original || rawUrl.pathname.split('/').pop() || 'bunkr_file';

          // Try signing API; if it fails, attempt to extract signed URL from page HTML
          try {
            const signRes = await fetch(`https://glb-apisign.cdn.cr/sign?path=${encodeURIComponent(rawUrl.pathname)}`);
            if (signRes.ok) {
              const signData = await signRes.json();
              rawUrl.searchParams.set('token', signData.token);
              rawUrl.searchParams.set('ex', signData.ex);
              directUrl = rawUrl.toString();
            }
          } catch (signErr) {
            console.warn(`[Bunkr] Signing API failed, trying HTML fallback: ${signErr.message}`);
          }

          // Fallback: try to extract signed URL directly from page HTML
          if (!directUrl) {
            const signedInHtml = html.match(new RegExp(escapeRegex(rawUrl.origin + rawUrl.pathname) + '\\?[^"\'\\s<>]+'));
            if (signedInHtml) {
              directUrl = signedInHtml[0];
            } else {
              // Try <video src> or <source src> on the download page
              const dlPageRes = await fetch(dlPageUrl);
              if (dlPageRes.ok) {
                const dlHtml = await dlPageRes.text();
                const videoSrc = dlHtml.match(/<video[^>]*src=["']([^"']+)["']/i) || dlHtml.match(/<source[^>]*src=["']([^"']+)["']/i);
                if (videoSrc) {
                  directUrl = videoSrc[1].startsWith('http') ? videoSrc[1] : new URL(videoSrc[1], dlPageUrl).href;
                }
              }
            }
            // Last resort: use unsigned URL
            if (!directUrl) {
              directUrl = rawUrl.toString();
            }
          }
          const ext = (name.split('.').pop() || '').toLowerCase();
          let type = 'document';
          if (['mp4', 'mkv', 'webm', 'mov'].includes(ext)) type = 'video';
          else if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) type = 'image';

          let thumbnail = null;
          if (type === 'video') {
            thumbnail = extractOGImage(html);
          }

          items.push({ type, name, url: directUrl, ext, label: type, size: 0, thumbnail });
        }
      } catch (err) {
        console.error('Bunkr metadata resolution error:', err);
      }
    }

    // Fallback / Album scraping: search for direct media links in HTML
    if (items.length === 0) {
      const linkRegex = /href=["'](https?:\/\/[^"']+\.(?:mp4|mkv|webm|jpg|jpeg|png|webp|gif|mp3))["']/gi;
      let match;
      const seen = new Set();

      // Extract thumbnail preview images from the page
      const thumbUrls = [];
      const imgRegex = /<img[^>]*src=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp|gif))["'][^>]*>/gi;
      let imgMatch;
      while ((imgMatch = imgRegex.exec(html)) !== null) {
        const src = imgMatch[1];
        if (!thumbUrls.includes(src) && !src.includes('icon') && !src.includes('logo') && !src.includes('avatar')) {
          thumbUrls.push(src);
        }
      }

      let thumbIdx = 0;
      while ((match = linkRegex.exec(html)) !== null) {
        const mediaUrl = match[1];
        if (seen.has(mediaUrl)) continue;
        seen.add(mediaUrl);

        const name = mediaUrl.split('/').pop() || 'bunkr_file';
        const ext = (name.split('.').pop() || '').toLowerCase();
        let type = 'document';
        if (['mp4', 'webm', 'mkv'].includes(ext)) type = 'video';
        else if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) type = 'image';

        const thumbForItem = type === 'video' && thumbIdx < thumbUrls.length ? thumbUrls[thumbIdx++] : null;

        items.push({ type, name, url: mediaUrl, ext, label: type, size: 0, thumbnail: thumbForItem });
      }
    }

    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    return {
      title: titleMatch ? titleMatch[1].replace('| Bunkr', '').trim() : 'Bunkr Media',
      url,
      items
    };
  } catch (err) {
    console.error('Bunkr Scrape Error:', err);
    return null;
  }
}

// 5. Generic Web Extractor
async function scrapeGeneric(url) {
  const html = await fetchText(url);
  if (!html) {
    return { title: url, url, items: [] };
  }

  const titleMatch = html.match(/<title>(.*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : url;
  const items = [];
  const seen = new Set();

  const pageOGImage = extractOGImage(html);

  // Extract <source src="...">, <video src="...">, <img src="...">, <a href="...">
  // Also data-src, data-url (common for lazy-loaded content)
  const mediaRegex = /(?:src|href|data-src|data-url|data-lazy-src|data-original)=["'](https?:\/\/[^"'\s>]+?\.(mp4|mkv|webm|mov|jpg|jpeg|png|webp|gif|mp3|wav|ogg|pdf|zip))["']/gi;
  let match;

  while ((match = mediaRegex.exec(html)) !== null) {
    const mediaUrl = match[1];
    const ext = match[2].toLowerCase();

    if (seen.has(mediaUrl)) continue;
    seen.add(mediaUrl);

    let type = 'document';
    if (['mp4', 'mkv', 'webm', 'mov'].includes(ext)) type = 'video';
    else if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) type = 'image';
    else if (['mp3', 'wav', 'ogg'].includes(ext)) type = 'audio';

    const urlParts = mediaUrl.split('/');
    const rawName = urlParts[urlParts.length - 1].split('?')[0];
    const name = decodeURIComponent(rawName) || `media.${ext}`;

    const thumbnail = type !== 'image' ? pageOGImage : null;

    items.push({
      type,
      name,
      url: mediaUrl,
      ext,
      label: type,
      size: 0,
      thumbnail
    });
  }

  // 2nd pass: look for URLs in <script> tags (JSON embeds, config objects)
  if (items.length === 0) {
    const scriptContents = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
    for (const sc of scriptContents) {
      const c = sc[1];
      const urlMatches = c.match(/"(https?:\/\/[^"]+\.(mp4|mkv|webm|mov|jpg|jpeg|png|webp|gif|mp3|wav|ogg))"/gi);
      if (urlMatches) {
        for (const u of urlMatches) {
          const cleaned = u.slice(1, -1);
          if (seen.has(cleaned)) continue;
          seen.add(cleaned);
          const extMatch = cleaned.match(/\.(\w+)(?:\?|$)/);
          const ext = extMatch ? extMatch[1].toLowerCase() : 'mp4';
          let type = 'document';
          if (['mp4', 'mkv', 'webm', 'mov'].includes(ext)) type = 'video';
          else if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) type = 'image';
          else if (['mp3', 'wav', 'ogg'].includes(ext)) type = 'audio';
          const urlParts = cleaned.split('/');
          const rawName = urlParts[urlParts.length - 1].split('?')[0];
          const name = decodeURIComponent(rawName) || `media.${ext}`;
          items.push({ type, name, url: cleaned, ext, label: type, size: 0, thumbnail: type !== 'image' ? pageOGImage : null });
        }
      }
    }
  }

  // 3rd pass: try to find video URLs from <video> tags without extension in src
  if (items.length === 0) {
    const videoTagRegex = /<video[^>]+src=["'](https?:\/\/[^"']+)["']/gi;
    let vm;
    while ((vm = videoTagRegex.exec(html)) !== null) {
      const videoUrl = vm[1];
      if (seen.has(videoUrl)) continue;
      seen.add(videoUrl);
      items.push({ type: 'video', name: `video_${items.length + 1}`, url: videoUrl, ext: 'mp4', label: 'video', size: 0, thumbnail: pageOGImage });
    }
  }

  return { title, url, items };
}

async function scrapeErome(url) {
  const html = await fetchText(url);
  if (!html) return { title: url, url, items: [] };

  const titleMatch = html.match(/<title>(.*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : url;
  const items = [];
  const seen = new Set();

  const videoRegex = /<video[^>]*poster="([^"]*)"[^>]*>[\s\S]*?<source[^>]*src="([^"]*\.(?:mp4|mkv|webm|mov))"[^>]*>/gi;
  let videoMatch;
  while ((videoMatch = videoRegex.exec(html)) !== null) {
    const posterUrl = videoMatch[1];
    const videoUrl = videoMatch[2];

    if (seen.has(videoUrl)) continue;
    seen.add(videoUrl);

    const extMatch = videoUrl.match(/\.(\w+)(?:\?|$)/);
    const ext = extMatch ? extMatch[1].toLowerCase() : 'mp4';
    const urlParts = videoUrl.split('/');
    const rawName = urlParts[urlParts.length - 1].split('?')[0];
    const name = decodeURIComponent(rawName) || `video.${ext}`;

    items.push({
      type: 'video',
      name,
      url: videoUrl,
      ext,
      label: 'video',
      size: 0,
      thumbnail: posterUrl
    });
  }

  const imgRegex = /<img[^>]*src="(https?:\/\/[^"']*\.(?:jpg|jpeg|png|webp|gif))"[^>]*>/gi;
  let imgMatch;
  while ((imgMatch = imgRegex.exec(html)) !== null) {
    const imgUrl = imgMatch[1];

    if (seen.has(imgUrl) || !imgUrl.includes('.erome.com')) continue;
    if (imgUrl.includes('avatar.erome.com')) continue;
    seen.add(imgUrl);

    const extMatch = imgUrl.match(/\.(\w+)(?:\?|$)/);
    const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
    const urlParts = imgUrl.split('/');
    const rawName = urlParts[urlParts.length - 1].split('?')[0];
    const name = decodeURIComponent(rawName) || `image.${ext}`;

    items.push({
      type: 'image',
      name,
      url: imgUrl,
      ext,
      label: 'image',
      size: 0,
      thumbnail: imgUrl
    });
  }

  return { title, url, items };
}

// Twitter / X.com scraper
async function scrapeTwitter(url) {
  const html = await fetchText(url);
  if (!html) return { title: url, url, items: [] };

  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s*\/\s*X$/, '').replace(/&quot;/g, '"').trim() : url;
  const items = [];
  const seen = new Set();

  const ogImage = extractOGImage(html);

  // Collect all video.twimg.com MP4 URLs with their resolutions
  const found = [];
  const videoRegex = /https?:\/\/video\.twimg\.com\/[^"'\s>]+?\.mp4(?:\?[^"'\s>]*)?/gi;
  let vm;
  while ((vm = videoRegex.exec(html)) !== null) {
    const videoUrl = vm[0].replace(/&amp;/g, '&');
    if (seen.has(videoUrl)) continue;
    seen.add(videoUrl);
    const resMatch = videoUrl.match(/(\d+)x(\d+)/);
    const w = resMatch ? parseInt(resMatch[1]) : 0;
    const h = resMatch ? parseInt(resMatch[2]) : 0;
    const area = w * h;
    found.push({ url: videoUrl, width: w, height: h, area });
  }

  if (found.length > 0) {
    found.sort((a, b) => b.area - a.area);
    const best = found[0];
    const nameMatch = best.url.match(/\/([^\/]+\.mp4)/);
    const name = nameMatch ? decodeURIComponent(nameMatch[1]) : 'tweet_video.mp4';
    const qualities = found
      .filter(f => f.width > 0)
      .map(f => ({ url: f.url, width: f.width, height: f.height, label: `${f.width}x${f.height}` }));

    console.log(`[Twitter] Best video: ${best.url.substring(0, 100)} (${best.width}x${best.height})`);
    items.push({
      type: 'video',
      name,
      url: best.url,
      qualities,
      ext: 'mp4',
      label: 'video',
      size: 0,
      thumbnail: ogImage
    });
  }

  // Fallback: try HLS playlist if no MP4 found
  if (items.length === 0) {
    const hlsRegex = /https?:\/\/video\.twimg\.com\/[^"'\s>]+?\.m3u8(?:\?[^"'\s>]*)?/gi;
    let hm;
    while ((hm = hlsRegex.exec(html)) !== null) {
      const hlsUrl = hm[0].replace(/&amp;/g, '&');
      if (seen.has(hlsUrl)) continue;
      seen.add(hlsUrl);
      console.log(`[Twitter] Found HLS: ${hlsUrl.substring(0, 100)}`);
      items.push({
        type: 'video',
        name: 'tweet_video.mp4',
        url: hlsUrl,
        ext: 'mp4',
        label: 'video',
        size: 0,
        thumbnail: ogImage
      });
    }
  }

  return { title, url, items };
}

// Main Analyze Router
async function analyzePage(url) {
  if (url.includes('gofile.io')) {
    const gfData = await scrapeGoFile(url);
    if (gfData && gfData.items.length > 0) return gfData;
  }

  if (url.includes('pixeldrain.com')) {
    const pdData = await scrapePixelDrain(url);
    if (pdData && pdData.items.length > 0) return pdData;
  }

  if (url.includes('cyberdrop.')) {
    const cdData = await scrapeCyberDrop(url);
    if (cdData && cdData.items.length > 0) return cdData;
  }

  if (url.includes('bunkr.')) {
    const bkData = await scrapeBunkr(url);
    if (bkData && bkData.items.length > 0) return bkData;
  }

  if (url.includes('erome.com')) {
    const erData = await scrapeErome(url);
    if (erData && erData.items.length > 0) return erData;
  }

  if (url.includes('x.com') || url.includes('twitter.com')) {
    const twData = await scrapeTwitter(url);
    if (twData && twData.items.length > 0) return twData;
  }

  // Fallback to generic extractor
  return await scrapeGeneric(url);
}

// -------------------------------------------------------------
// ZIP Batch Task Manager
// -------------------------------------------------------------
async function runZipTask(taskId, items) {
  const task = {
    taskId,
    status: 'processing',
    total: items.length,
    processed: 0,
    currentBytes: 0,
    speed: 0,
    startTime: Date.now(),
    error: null,
    zipFilePath: path.join(TEMP_DIR, `${taskId}.zip`)
  };

  zipTasks.set(taskId, task);
  console.log(`[ZIP] Task ${taskId}: processing ${items.length} file(s)`);

  const output = fs.createWriteStream(task.zipFilePath);
  const archive = archiver('zip', { zlib: { level: 5 } });

  archive.pipe(output);

  archive.on('error', (err) => {
    task.status = 'error';
    task.error = err.message;
    console.error(`[ZIP] Task ${taskId}: archive error - ${err.message}`);
  });

  output.on('close', () => {
    console.log(`[ZIP] Task ${taskId}: finalized (${(archive.pointer() / 1024 / 1024).toFixed(1)} MB)`);
  });

  try {
    for (let i = 0; i < items.length; i++) {
      if (task.status === 'cancelled') {
        console.log(`[ZIP] Task ${taskId}: cancelled at file ${i}/${items.length}`);
        break;
      }

      const item = items[i];
      task.currentName = item.name;
      console.log(`[ZIP] Task ${taskId}: fetching [${i + 1}/${items.length}] ${item.name}`);

      try {
        const fetchHeaders = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };
        if (item.url.includes('erome.com')) {
          fetchHeaders['Referer'] = 'https://www.erome.com/';
        }
        const itemRes = await fetch(item.url, { headers: fetchHeaders });

        if (itemRes.ok) {
          const chunks = [];
          if (itemRes.body && typeof itemRes.body.getReader === 'function') {
            const reader = itemRes.body.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
              task.currentBytes += value.length;
              const elapsed = (Date.now() - task.startTime) / 1000;
              task.speed = elapsed > 0 ? Math.round(task.currentBytes / elapsed) : 0;
            }
          } else {
            const buffer = Buffer.from(await itemRes.arrayBuffer());
            chunks.push(buffer);
            task.currentBytes += buffer.length;
          }
          archive.append(Buffer.concat(chunks), { name: item.name || `file_${i + 1}.${item.ext || 'bin'}` });
          console.log(`[ZIP] Task ${taskId}: appended ${item.name} (${(task.currentBytes / 1024 / 1024).toFixed(1)} MB total)`);
        } else {
          console.warn(`[ZIP] Task ${taskId}: HTTP ${itemRes.status} for ${item.url}`);
        }
      } catch (err) {
        console.error(`[ZIP] Task ${taskId}: fetch error for ${item.name}: ${err.message}`);
      }

      task.processed = i + 1;
      const elapsedSec = (Date.now() - task.startTime) / 1000;
      task.speed = elapsedSec > 0 ? Math.round(task.currentBytes / elapsedSec) : 0;
    }

    if (task.status !== 'cancelled') {
      await archive.finalize();
      task.status = 'completed';
      console.log(`[ZIP] Task ${taskId}: completed successfully`);
    }
  } catch (err) {
    task.status = 'error';
    task.error = err.message;
    console.error(`[ZIP] Task ${taskId}: fatal error - ${err.message}`);
  }
}

// Enrich items with real file sizes via HEAD/Range requests
async function enrichItemSizes(items) {
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

// -------------------------------------------------------------
// HTTP Server & Route Handler
// -------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = reqUrl.pathname;
  const method = req.method;

  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (!pathname.startsWith('/download-zip/status/')) {
    console.log(`[${new Date().toISOString()}] ${method} ${pathname}`);
  }

  // Auth check — skip OPTIONS, static assets, and /auth itself
  if (AUTH_TOKEN && pathname !== '/auth' && !pathname.startsWith('/auth?')) {
    const ext = path.extname(pathname).toLowerCase();
    const isStatic = ['.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.mp4', '.webm', '.mp3'].includes(ext);
    const isLocale = pathname.startsWith('/locales/');
    if (!isStatic && !isLocale && !requireAuth(req, res)) {
      return sendUnauthorized(res);
    }
  }

  // Auth login endpoint (only valid when AUTH_TOKEN is set)
  if (AUTH_TOKEN && method === 'POST' && pathname === '/auth') {
    let bodyStr = '';
    req.on('data', chunk => bodyStr += chunk);
    req.on('end', () => {
      try {
        const { token } = JSON.parse(bodyStr);
        if (token === AUTH_TOKEN) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: true }));
        }
      } catch (e) {}
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid token' }));
    });
    return;
  }

  // 1. POST /analyze
  if (req.method === 'POST' && pathname === '/analyze') {
    let bodyStr = '';
    req.on('data', chunk => bodyStr += chunk);
    req.on('end', async () => {
      try {
        const body = JSON.parse(bodyStr);
        if (!body.url) {
          console.warn(`[Analyze] Missing URL in request body`);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'URL is required' }));
        }
        console.log(`[Analyze] Analyzing: ${body.url}`);
        const result = await analyzePage(body.url);
        const count = result?.items?.length || 0;
        console.log(`[Analyze] Result: ${count} item(s) for ${body.url}`);
        if (count > 0) {
          await enrichItemSizes(result.items);
        }
        if (count === 0) {
          console.warn(`[Analyze] No items found for URL: ${body.url}`);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        console.error(`[Analyze] Error: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 2. GET /proxy
  if (req.method === 'GET' && pathname === '/proxy') {
    const targetUrl = reqUrl.searchParams.get('url');
    if (!targetUrl) {
      res.writeHead(400);
      return res.end('URL parameter missing');
    }

    // Validate target URL to prevent SSRF
    let parsedUrl;
    try {
      parsedUrl = new URL(targetUrl);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid URL' }));
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Only http/https URLs allowed' }));
    }
    // Block requests to local/private IP ranges
    const hostname = parsedUrl.hostname.toLowerCase();
    const blockedPatterns = ['localhost', '127.0.0.1', '::1', '0.0.0.0', '10.', '172.16.', '172.17.', '172.18.', '172.19.', '172.20.', '172.21.', '172.22.', '172.23.', '172.24.', '172.25.', '172.26.', '172.27.', '172.28.', '172.29.', '172.30.', '172.31.', '192.168.'];
    if (blockedPatterns.some(p => hostname.startsWith(p) || hostname === p)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Access to private IPs is blocked' }));
    }

    const rangeHint = req.headers.range ? ` range=${req.headers.range}` : '';
    console.log(`[Proxy] ${targetUrl.substring(0, 120)}${rangeHint}`);
    try {
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      };
      if (req.headers.range) {
        headers['Range'] = req.headers.range;
      }
      if (targetUrl.includes('erome.com')) {
        headers['Referer'] = 'https://www.erome.com/';
      } else if (targetUrl.includes('cyberdrop') || targetUrl.includes('gigachad-cdn')) {
        headers['Referer'] = 'https://cyberdrop.cr/';
      } else if (targetUrl.includes('bunkr')) {
        headers['Referer'] = 'https://bunkr.xxx/';
      } else if (targetUrl.includes('pixeldrain.com')) {
        headers['Referer'] = 'https://pixeldrain.com/';
      }

      const proxyRes = await fetch(targetUrl, { headers });
      
      const resHeaders = {};
      if (proxyRes.headers.get('content-type')) resHeaders['Content-Type'] = proxyRes.headers.get('content-type');
      if (proxyRes.headers.get('content-length')) resHeaders['Content-Length'] = proxyRes.headers.get('content-length');
      if (proxyRes.headers.get('content-range')) resHeaders['Content-Range'] = proxyRes.headers.get('content-range');
      if (proxyRes.headers.get('accept-ranges')) resHeaders['Accept-Ranges'] = proxyRes.headers.get('accept-ranges');

      res.writeHead(proxyRes.status, resHeaders);
      console.log(`[Proxy] Response ${proxyRes.status} for ${targetUrl.substring(0, 80)}`);

      if (proxyRes.body && typeof proxyRes.body.getReader === 'function') {
        const reader = proxyRes.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
      } else {
        const buffer = Buffer.from(await proxyRes.arrayBuffer());
        res.end(buffer);
        return;
      }
      res.end();
    } catch (err) {
      console.error('Proxy Error:', err);
      res.writeHead(502);
      res.end('Proxy Error');
    }
    return;
  }

  // 3. POST /download-zip
  if (req.method === 'POST' && pathname === '/download-zip') {
    let bodyStr = '';
    req.on('data', chunk => bodyStr += chunk);
    req.on('end', () => {
      try {
        const body = JSON.parse(bodyStr);
        const items = body.items || [];
        if (items.length === 0) {
          console.warn(`[ZIP] No items provided`);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'No items provided for ZIP' }));
        }

        const taskId = `zip_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        console.log(`[ZIP] Starting task ${taskId} with ${items.length} file(s)`);
        runZipTask(taskId, items);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ taskId }));
      } catch (err) {
        console.error(`[ZIP] Error creating task: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 4. GET /download-zip/status/:taskId
  if (req.method === 'GET' && pathname.startsWith('/download-zip/status/')) {
    const taskId = pathname.replace('/download-zip/status/', '');
    const task = zipTasks.get(taskId);
    if (!task) {
      console.warn(`[ZIP] Status check for unknown task: ${taskId}`);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Task not found' }));
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      processed: task.processed,
      total: task.total,
      currentBytes: task.currentBytes,
      speed: task.speed,
      currentName: task.currentName,
      status: task.status,
      error: task.error
    }));
  }

  // 5. GET /download-zip/result/:taskId
  if (req.method === 'GET' && pathname.startsWith('/download-zip/result/')) {
    const taskId = pathname.replace('/download-zip/result/', '');
    const task = zipTasks.get(taskId);
    if (!task || !fs.existsSync(task.zipFilePath)) {
      console.warn(`[ZIP] Result request for missing task: ${taskId}`);
      res.writeHead(404);
      return res.end('ZIP File Not Found');
    }

    const stat = fs.statSync(task.zipFilePath);
    console.log(`[ZIP] Serving result: ${taskId} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Length': stat.size,
      'Content-Disposition': 'attachment; filename="webscope_media_pack.zip"'
    });

    const readStream = fs.createReadStream(task.zipFilePath);
    readStream.pipe(res);

    readStream.on('end', () => {
      console.log(`[ZIP] Download complete, cleaning up task: ${taskId}`);
      try {
        fs.unlinkSync(task.zipFilePath);
        zipTasks.delete(taskId);
      } catch (e) {}
    });
    return;
  }

  // 6. GET /download-zip/cancel/:taskId
  if (req.method === 'GET' && pathname.startsWith('/download-zip/cancel/')) {
    const taskId = pathname.replace('/download-zip/cancel/', '');
    const task = zipTasks.get(taskId);
    if (task) {
      console.log(`[ZIP] Cancelling task: ${taskId}`);
      task.status = 'cancelled';
      if (fs.existsSync(task.zipFilePath)) {
        try { fs.unlinkSync(task.zipFilePath); } catch (e) {}
      }
      zipTasks.delete(taskId);
    } else {
      console.warn(`[ZIP] Cancel request for unknown task: ${taskId}`);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ cancelled: true }));
  }

  // 7. Static File Serving (HTML, CSS, JS, Locales) with Cache Headers + Gzip
  const requestedPath = pathname === '/' ? 'dashboard.html' : pathname.slice(1);

  // Protect HTML pages behind auth
  if (AUTH_TOKEN && (requestedPath.endsWith('.html') || pathname === '/')) {
    if (!requireAuth(req, res)) {
      res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(getLoginPage());
    }
  }

  let filePath = path.resolve(__dirname, requestedPath);

  // Ensure file stays within project root
  const rootDir = path.resolve(__dirname);
  if (!filePath.startsWith(rootDir)) {
    console.warn(`[Static] Blocked path traversal attempt: ${pathname}`);
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }

  // If path is directory, try index.html
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (fs.existsSync(filePath) && !fs.statSync(filePath).isDirectory()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const cacheControl = CACHE_DURATIONS[ext] || 'no-cache';
    const headers = { 'Content-Type': contentType, 'Cache-Control': cacheControl };

    // Gzip compress text responses
    if (contentType.startsWith('text/') || contentType === 'application/javascript' || contentType === 'application/json') {
      const acceptEncoding = req.headers['accept-encoding'] || '';
      if (acceptEncoding.includes('gzip')) {
        headers['Content-Encoding'] = 'gzip';
        res.writeHead(200, headers);
        const stream = fs.createReadStream(filePath);
        stream.pipe(zlib.createGzip()).pipe(res);
        return;
      }
    }

    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('<h1>404 - Page not found</h1>');
  }
});

// -------------------------------------------------------------
// Server Startup
// -------------------------------------------------------------
const handler = server; // reuse the createServer result

if (httpsOptions) {
  https.createServer(httpsOptions, (req, res) => handler.emit('request', req, res)).listen(PORT, () => {
    console.log(`🚀 WebScope HTTPS running on https://localhost:${PORT}`);
  });
} else {
  handler.listen(PORT, () => {
    const proto = AUTH_TOKEN ? ' (auth enabled)' : '';
    console.log(`🚀 WebScope running on http://localhost:${PORT}${proto}`);
  });
}

// Login page HTML (served inline when auth is required)
function getLoginPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>WebScope — Login</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0f0f13; color: #e0e0e0;
    display: flex; align-items: center; justify-content: center;
    min-height: 100vh;
  }
  .login-box {
    background: #1a1a24; border-radius: 12px;
    padding: 40px; width: 360px; box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  }
  h1 { font-size: 1.4rem; margin-bottom: 8px; color: #fff; }
  p { font-size: 0.85rem; color: #888; margin-bottom: 24px; }
  input {
    width: 100%; padding: 12px 14px; border-radius: 8px;
    border: 1px solid #333; background: #0f0f13; color: #e0e0e0;
    font-size: 0.95rem; outline: none; margin-bottom: 16px;
  }
  input:focus { border-color: #6366f1; }
  button {
    width: 100%; padding: 12px; border-radius: 8px; border: none;
    background: #6366f1; color: #fff; font-size: 0.95rem;
    cursor: pointer; font-weight: 600;
  }
  button:hover { background: #5558e6; }
  .error { color: #f87171; font-size: 0.85rem; margin-top: 12px; display: none; }
</style>
</head>
<body>
<div class="login-box">
  <h1>WebScope</h1>
  <p>Enter your access token to continue</p>
  <input type="password" id="token-input" placeholder="Access token" autofocus>
  <button id="login-btn">Login</button>
  <div class="error" id="error-msg">Invalid token</div>
</div>
<script>
  document.getElementById('login-btn').addEventListener('click', login);
  document.getElementById('token-input').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
  async function login() {
    const token = document.getElementById('token-input').value;
    const btn = document.getElementById('login-btn');
    btn.disabled = true; btn.textContent = 'Checking...';
    try {
      const res = await fetch('/auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      if (res.ok) {
        localStorage.setItem('downdash_token', token);
        window.location.href = '/';
      } else {
        document.getElementById('error-msg').style.display = 'block';
      }
    } catch (e) {
      document.getElementById('error-msg').style.display = 'block';
    }
    btn.disabled = false; btn.textContent = 'Login';
  }
  // Auto-redirect if already stored
  if (localStorage.getItem('downdash_token')) {
    (async () => {
      const tok = localStorage.getItem('downdash_token');
      const res = await fetch('/auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tok })
      });
      if (res.ok) window.location.href = '/';
      else localStorage.removeItem('downdash_token');
    })();
  }
</script>
</body>
</html>`;
}
