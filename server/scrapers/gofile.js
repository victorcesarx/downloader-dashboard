import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { GOFILE_TOKEN, GOFILE_WT_SALT, GOFILE_WT_SALT_OVERRIDE, TEMP_DIR } from '../config.js';
import { extractGoFileWTSalts, isValidGoFileWTSalt } from './gofile-wt.js';

const GOFILE_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const GOFILE_LANGUAGE = 'en-US';
const GOFILE_TIME_WINDOW_SECONDS = 4 * 60 * 60;
const GOFILE_COOLDOWN_MS = 15 * 60 * 1000;
const GOFILE_WT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const GOFILE_WT_CACHE_PATH = path.join(TEMP_DIR, '.gofile-wt-salt.json');
const GOFILE_MIME_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/x-matroska': 'mkv',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
};
let cachedGoFileToken = GOFILE_TOKEN;
let sessionPromise = null;
let cooldownUntil = 0;
let saltDiscoveryPromise = null;
let lastSaltCheckAt = 0;

function readCachedGoFileWTSalt() {
  if (GOFILE_WT_SALT_OVERRIDE) return null;
  try {
    const cached = JSON.parse(fs.readFileSync(GOFILE_WT_CACHE_PATH, 'utf8'));
    return isValidGoFileWTSalt(cached?.salt) ? cached.salt : null;
  } catch {
    return null;
  }
}

const initialCachedGoFileWTSalt = readCachedGoFileWTSalt();
let activeGoFileWTSalt = initialCachedGoFileWTSalt || GOFILE_WT_SALT;
let activeGoFileWTSaltSource = GOFILE_WT_SALT_OVERRIDE
  ? 'environment'
  : (initialCachedGoFileWTSalt ? 'cache' : 'bundled');

async function persistGoFileWTSalt(salt) {
  if (process.env.NODE_ENV === 'test') return;
  try {
    await fs.promises.mkdir(TEMP_DIR, { recursive: true });
    const payload = JSON.stringify({ salt, validatedAt: new Date().toISOString() });
    const tempPath = `${GOFILE_WT_CACHE_PATH}.${process.pid}.tmp`;
    await fs.promises.writeFile(tempPath, payload, { encoding: 'utf8', mode: 0o600 });
    await fs.promises.rename(tempPath, GOFILE_WT_CACHE_PATH);
  } catch (error) {
    console.warn(`[GoFile] Could not persist the validated website-token salt: ${error.message}`);
  }
}

async function fetchGoFileWT(signal) {
  try {
    const res = await fetch('https://gofile.io/js/wt.obf.js', {
      headers: { 'User-Agent': GOFILE_USER_AGENT, 'Accept': 'application/javascript,*/*;q=0.8' },
      signal: signal || AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;
    const source = await res.text();
    if (source.length > 1024 * 1024) return null;
    const candidates = extractGoFileWTSalts(source);
    return candidates.length === 1 ? candidates[0] : null;
  } catch {
    return null;
  }
}

function generateWT(token, now = Date.now(), salt = activeGoFileWTSalt) {
  const timeWindow = Math.floor(now / 1000 / GOFILE_TIME_WINDOW_SECONDS);
  const payload = `${GOFILE_USER_AGENT}::${GOFILE_LANGUAGE}::${token || ''}::${timeWindow}::${salt}`;
  return createHash('sha256').update(payload).digest('hex');
}

async function createGoFileToken() {
  if (Date.now() < cooldownUntil) return null;
  try {
      const accRes = await fetch('https://api.gofile.io/accounts', {
        method: 'POST',
        headers: {
          'User-Agent': GOFILE_USER_AGENT,
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
      if (accRes.status === 429 || accRes.status >= 500) {
        cooldownUntil = Date.now() + GOFILE_COOLDOWN_MS;
        console.warn(`[GoFile] API unavailable (${accRes.status}); guest account creation paused for 15 minutes`);
      }
  } catch (e) {
    cooldownUntil = Date.now() + GOFILE_COOLDOWN_MS;
    console.error('GoFile account creation failed:', e.message);
  }
  return null;
}

async function ensureGoFileSession() {
  if (cachedGoFileToken) return true;
  if (Date.now() < cooldownUntil) return false;
  if (!sessionPromise) {
    sessionPromise = createGoFileToken()
      .then(token => {
        if (token) cachedGoFileToken = token;
        return Boolean(token);
      })
      .finally(() => { sessionPromise = null; });
  }
  return sessionPromise;
}

async function fetchGoFileContents(contentId, token, signal, salt = activeGoFileWTSalt) {
  const wt = generateWT(token, Date.now(), salt);
  const params = new URLSearchParams({ contentFilter: '', page: '1', pageSize: '1000', sortField: 'createTime', sortDirection: '-1' });
  const headers = {
    'User-Agent': GOFILE_USER_AGENT,
    'Authorization': `Bearer ${token}`,
    'X-Website-Token': wt,
    'X-BL': GOFILE_LANGUAGE,
    'Cookie': `accountToken=${token}`,
    'Origin': 'https://gofile.io',
    'Referer': 'https://gofile.io/'
  };
  return fetch(`https://api.gofile.io/contents/${contentId}?${params}`, { headers, signal });
}

async function validateGoFileWTSalt(salt, signal) {
  const accountRes = await fetch('https://api.gofile.io/accounts', {
    method: 'POST',
    headers: {
      'User-Agent': GOFILE_USER_AGENT,
      'Origin': 'https://gofile.io',
      'Referer': 'https://gofile.io/'
    },
    signal,
  });
  if (!accountRes.ok) return null;
  const account = await accountRes.json().catch(() => null);
  const token = account?.data?.token;
  const rootFolder = account?.data?.rootFolder;
  if (account?.status !== 'ok' || !token || !rootFolder) return null;

  const contentRes = await fetchGoFileContents(rootFolder, token, signal, salt);
  if (!contentRes.ok) return null;
  const content = await contentRes.json().catch(() => null);
  return content?.status === 'ok' && content?.data ? token : null;
}

export async function refreshGoFileWTSalt({ force = false, signal } = {}) {
  if (GOFILE_WT_SALT_OVERRIDE) {
    return { salt: activeGoFileWTSalt, source: 'environment', changed: false };
  }
  if (!force && Date.now() - lastSaltCheckAt < GOFILE_WT_CHECK_INTERVAL_MS) {
    return { salt: activeGoFileWTSalt, source: 'cache', changed: false };
  }
  if (saltDiscoveryPromise) return saltDiscoveryPromise;

  saltDiscoveryPromise = (async () => {
    lastSaltCheckAt = Date.now();
    const candidate = await fetchGoFileWT(signal);
    if (!candidate || !isValidGoFileWTSalt(candidate)) {
      return { salt: activeGoFileWTSalt, source: 'fallback', changed: false };
    }
    if (candidate === activeGoFileWTSalt) {
      activeGoFileWTSaltSource = 'website';
      return { salt: activeGoFileWTSalt, source: 'website', changed: false };
    }

    const validationToken = await validateGoFileWTSalt(candidate, signal).catch(() => null);
    if (!validationToken) {
      console.warn('[GoFile] Discovered website-token salt was rejected; keeping the last known working value');
      return { salt: activeGoFileWTSalt, source: 'fallback', changed: false };
    }

    activeGoFileWTSalt = candidate;
    activeGoFileWTSaltSource = 'website';
    if (!cachedGoFileToken) cachedGoFileToken = validationToken;
    await persistGoFileWTSalt(candidate);
    console.info('[GoFile] Website-token salt was updated automatically after validation');
    return { salt: activeGoFileWTSalt, source: 'website', changed: true };
  })().finally(() => { saltDiscoveryPromise = null; });
  return saltDiscoveryPromise;
}

function goFileExtension(file) {
  const name = String(file?.name || '');
  const dot = name.lastIndexOf('.');
  if (dot > 0 && dot < name.length - 1) return name.slice(dot + 1).toLowerCase();
  return GOFILE_MIME_EXTENSIONS[String(file?.mimetype || '').toLowerCase()] || '';
}

export function isGoFileUrl(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === 'gofile.io' || hostname.endsWith('.gofile.io');
  } catch {
    return false;
  }
}

// File links are protected by the accountToken cookie. Browsers receive it on
// the parent domain; backend downloads must add it explicitly. The token never
// leaves the server and callers must only apply these headers to GoFile hosts.
export async function getGoFileDownloadHeaders() {
  if (!await ensureGoFileSession() || !cachedGoFileToken) return {};
  return {
    'Authorization': `Bearer ${cachedGoFileToken}`,
    'Cookie': `accountToken=${cachedGoFileToken}`,
    'Origin': 'https://gofile.io',
    'Referer': 'https://gofile.io/',
  };
}

export async function scrapeGoFile(url) {
  const match = url.match(/gofile\.io\/d\/([a-zA-Z0-9]+)/);
  if (!match) return null;
  const contentId = match[1];

  const abortController = new AbortController();
  const overallTimeout = setTimeout(() => abortController.abort(), 45000);

  try {
    // Check the public frontend asset at most once every six hours. Failure is
    // non-fatal: the last validated/bundled salt remains active.
    await refreshGoFileWTSalt({ signal: abortController.signal });
    const sessionOk = await ensureGoFileSession();
    if (sessionOk) {
      let contentRes = await fetchGoFileContents(contentId, cachedGoFileToken, abortController.signal);
      let contentData = contentRes.ok ? await contentRes.json().catch(() => null) : null;

      const websiteTokenRejected = contentRes.status === 401
        || contentRes.status === 403
        || ['error-notPremium', 'error-notAuthenticated', 'error-websiteToken'].includes(contentData?.status);
      if (websiteTokenRejected) {
        const refresh = await refreshGoFileWTSalt({ force: true, signal: abortController.signal });
        if (refresh.changed) {
          contentRes = await fetchGoFileContents(contentId, cachedGoFileToken, abortController.signal);
          contentData = contentRes.ok ? await contentRes.json().catch(() => null) : null;
        }
      }

      if (!contentRes.ok) {
        console.warn(`[GoFile] API error ${contentRes.status}; keeping the existing session`);
        if (contentRes.status === 429 || contentRes.status >= 500) {
          cooldownUntil = Date.now() + GOFILE_COOLDOWN_MS;
        }
      }

      if (contentRes && contentRes.ok) {
        if (contentData?.status === 'ok' && contentData.data) {
          const folder = contentData.data;
          const items = [];
          const children = folder.children || {};

          for (const key of Object.keys(children)) {
            const file = children[key];
            if (file.type === 'file') {
              const ext = goFileExtension(file);
              let type = 'document';
              const mimeGroup = String(file.mimetype || '').split('/')[0].toLowerCase();
              if (mimeGroup === 'video' || ['mp4', 'mkv', 'webm', 'mov', 'avi'].includes(ext)) type = 'video';
              else if (mimeGroup === 'image' || ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) type = 'image';
              else if (mimeGroup === 'audio' || ['mp3', 'wav', 'flac', 'm4a', 'ogg'].includes(ext)) type = 'audio';

              items.push({
                type, name: file.name, url: file.link, ext,
                label: file.mimetype || type, size: file.size || 0,
                thumbnail: file.thumbnail || null,
                mimeType: file.mimetype || null,
                source: 'gofile'
              });
            }
          }

          clearTimeout(overallTimeout);
          return { title: folder.name || `GoFile (${contentId})`, url, items };
        }
      }
    }
  } catch (apiErr) {
    console.error('GoFile API unreachable, trying HTML fallback:', apiErr.message);
  }

  try {
    const pageRes = await fetch(url, {
      signal: abortController.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br'
      }
    });

    if (!pageRes.ok) {
      clearTimeout(overallTimeout);
      return { title: `GoFile (${contentId})`, url, items: [] };
    }

    const html = await pageRes.text();
    const items = [];
    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    const pageTitle = titleMatch ? titleMatch[1].replace('Gofile', '').trim() : `GoFile (${contentId})`;

    const ogVideoMatches = [...html.matchAll(/property=["']og:video["']\s+content=["']([^"']+)["']/gi),
                            ...html.matchAll(/content=["']([^"']+)["']\s+property=["']og:video["']/gi)];
    for (const m of ogVideoMatches) {
      const mediaUrl = m[1];
      const name = mediaUrl.split('/').pop().split('?')[0] || 'gofile_video';
      const ext = (name.split('.').pop() || 'mp4').toLowerCase();
      items.push({ type: 'video', name, url: mediaUrl, ext, label: 'video', size: 0 });
    }

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

    clearTimeout(overallTimeout);
    return { title: pageTitle, url, items };
  } catch (htmlErr) {
    clearTimeout(overallTimeout);
    console.error('GoFile HTML fallback failed:', htmlErr.message);
    return null;
  }
}

export function resetGoFileSessionForTests() {
  cachedGoFileToken = GOFILE_TOKEN;
  sessionPromise = null;
  cooldownUntil = 0;
  saltDiscoveryPromise = null;
  lastSaltCheckAt = 0;
  activeGoFileWTSalt = GOFILE_WT_SALT;
  activeGoFileWTSaltSource = GOFILE_WT_SALT_OVERRIDE ? 'environment' : 'bundled';
}

export function getGoFileWTStatus() {
  return {
    salt: activeGoFileWTSalt,
    source: activeGoFileWTSaltSource,
    lastCheckedAt: lastSaltCheckAt || null,
  };
}

export { generateWT, createGoFileToken, fetchGoFileWT, ensureGoFileSession, fetchGoFileContents };
