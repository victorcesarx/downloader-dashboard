import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import archiver from 'archiver';
import { createHash } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3006;
const TEMP_DIR = path.join(__dirname, 'temp_zips');

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

// -------------------------------------------------------------
// Scrapers Implementation
// -------------------------------------------------------------

// Helper: Standard Fetch text helper with User-Agent
async function fetchText(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const origin = new URL(url).origin;
    const res = await fetch(url, {
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

// GoFile In-Memory Token Cache
let cachedGoFileToken = null;

// generateWT: GoFile uses SHA-256(token) as the X-Website-Token header.
// This replicates the wt.obf.js logic natively using Node's crypto module.
function generateWT(token) {
  return createHash('sha256').update(token || '').digest('hex');
}

const GOFILE_WT = '4fd6sg89d7s6';

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
  return fetch(`https://api.gofile.io/contents/${contentId}?wt=${GOFILE_WT}&page=1&pageSize=1000`, { headers });
}

// 1. GoFile Scraper
async function scrapeGoFile(url) {
  const match = url.match(/gofile\.io\/d\/([a-zA-Z0-9]+)/);
  if (!match) return null;
  const contentId = match[1];

  // --- Strategy 1: Official GoFile API ---
  try {
    if (!cachedGoFileToken) {
      cachedGoFileToken = await createGoFileToken();
    }

    if (cachedGoFileToken) {
      let contentRes = await fetchGoFileContents(contentId, cachedGoFileToken);

      // Refresh token on 401/403 and retry
      if (!contentRes.ok && (contentRes.status === 401 || contentRes.status === 403)) {
        cachedGoFileToken = await createGoFileToken();
        if (cachedGoFileToken) {
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

    const items = [];
    const seen = new Set();
    const isFilePage = url.includes('/f/');

    // Diagnostic log
    const titleM = html.match(/<title>(.*?)<\/title>/i);
    console.log(`[CyberDrop] title="${titleM ? titleM[1] : 'N/A'}" len=${html.length} og:video=${/og:video/i.test(html)} <video>=${/<video/i.test(html)} <source>=${/<source/i.test(html)} og:image=${/og:image/i.test(html)} img=${/<img\s/i.test(html)}`);

    // Detect Cloudflare challenge
    if (html.includes('cf-browser-') || html.includes('challenge-platform') || html.includes('Just a moment') || html.includes('name="clckd"') || html.includes("name='clckd'")) {
      console.warn(`[CyberDrop] Blocked by Cloudflare challenge: ${url}`);
      return null;
    }

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
        const infoRes = await fetch(`https://api.cyberdrop.cr/api/file/info/${slug}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'Accept': 'application/json' }
        });
        if (!infoRes.ok) return null;
        const info = await infoRes.json();
        if (!info || !info.auth_url) return null;

        const authRes = await fetch(info.auth_url, {
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
  } catch (err) {
    console.error('CyberDrop Scrape Error:', err);
    return null;
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

          const signRes = await fetch(`https://glb-apisign.cdn.cr/sign?path=${encodeURIComponent(rawUrl.pathname)}`);
          if (signRes.ok) {
            const signData = await signRes.json();
            rawUrl.searchParams.set('token', signData.token);
            rawUrl.searchParams.set('ex', signData.ex);

            const directUrl = rawUrl.toString();
            const name = meta.original || rawUrl.pathname.split('/').pop() || 'bunkr_file';
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

  // Fallback to generic extractor
  return await scrapeGeneric(url);
}

// -------------------------------------------------------------
// ZIP Batch Task Manager
// -------------------------------------------------------------
async function runZipTask(taskId, items) {
  const task = {
    taskId,
    status: 'processing', // 'processing' | 'completed' | 'error' | 'cancelled'
    total: items.length,
    processed: 0,
    currentBytes: 0,
    speed: 0,
    startTime: Date.now(),
    error: null,
    zipFilePath: path.join(TEMP_DIR, `${taskId}.zip`)
  };

  zipTasks.set(taskId, task);

  const output = fs.createWriteStream(task.zipFilePath);
  const archive = archiver('zip', { zlib: { level: 5 } });

  archive.pipe(output);

  archive.on('error', (err) => {
    task.status = 'error';
    task.error = err.message;
  });

  try {
    for (let i = 0; i < items.length; i++) {
      if (task.status === 'cancelled') break;

      const item = items[i];
      task.currentName = item.name;

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
        }
      } catch (err) {
        console.error(`Failed to fetch ${item.url} for ZIP:`, err.message);
      }

      task.processed = i + 1;
      const elapsedSec = (Date.now() - task.startTime) / 1000;
      task.speed = elapsedSec > 0 ? Math.round(task.currentBytes / elapsedSec) : 0;
    }

    if (task.status !== 'cancelled') {
      await archive.finalize();
      task.status = 'completed';
    }
  } catch (err) {
    task.status = 'error';
    task.error = err.message;
  }
}

// -------------------------------------------------------------
// HTTP Server & Route Handler
// -------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = reqUrl.pathname;

  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // 1. POST /analyze
  if (req.method === 'POST' && pathname === '/analyze') {
    let bodyStr = '';
    req.on('data', chunk => bodyStr += chunk);
    req.on('end', async () => {
      try {
        const body = JSON.parse(bodyStr);
        if (!body.url) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'URL é obrigatória' }));
        }

        const result = await analyzePage(body.url);
        if (!result || !result.items || result.items.length === 0) {
          console.warn(`[Analyze] No items found for URL: ${body.url}`);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
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
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Nenhum item informado para ZIP' }));
        }

        const taskId = `zip_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        runZipTask(taskId, items);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ taskId }));
      } catch (err) {
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
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Task não encontrada' }));
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
      res.writeHead(404);
      return res.end('ZIP File Not Found');
    }

    const stat = fs.statSync(task.zipFilePath);
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Length': stat.size,
      'Content-Disposition': 'attachment; filename="downdash_media_pack.zip"'
    });

    const readStream = fs.createReadStream(task.zipFilePath);
    readStream.pipe(res);

    readStream.on('end', () => {
      // Auto-cleanup after download
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
      task.status = 'cancelled';
      if (fs.existsSync(task.zipFilePath)) {
        try { fs.unlinkSync(task.zipFilePath); } catch (e) {}
      }
      zipTasks.delete(taskId);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ cancelled: true }));
  }

  // 7. Static File Serving (HTML, CSS, JS, Locales)
  let filePath = path.join(__dirname, pathname === '/' ? 'dashboard.html' : pathname);

  // If path is directory, try index.html
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (fs.existsSync(filePath) && !fs.statSync(filePath).isDirectory()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('<h1>404 - Página não encontrada</h1>');
  }
});

server.listen(PORT, () => {
  console.log(`🚀 DownDash Server running on http://localhost:${PORT}`);
});
