import { createHash } from 'crypto';

let cachedGoFileToken = null;
let cachedGoFileWT = null;
let lastGoFileRefresh = 0;
const GOFILE_REFRESH_INTERVAL = 30 * 60 * 1000;

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

function generateWT(token) {
  return createHash('sha256').update(token || '').digest('hex');
}

async function createGoFileToken(retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
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
      if (accRes.status === 429 && attempt < retries) {
        const delay = Math.min(15000 * Math.pow(2, attempt - 1), 60000);
        console.warn(`[GoFile] Rate-limited (attempt ${attempt}/${retries}), waiting ${delay}ms before retry...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
    } catch (e) {
      if (attempt === retries) {
        console.error('GoFile account creation failed:', e.message);
        return null;
      }
      await new Promise(r => setTimeout(r, 2000));
    }
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
      cachedGoFileWT = '4fd6sg89d7s6';
    }
    lastGoFileRefresh = now;
  }
  if (!cachedGoFileToken) {
    cachedGoFileToken = await createGoFileToken();
  }
  return cachedGoFileToken && cachedGoFileWT;
}

async function fetchGoFileContents(contentId, token, signal) {
  const wt = generateWT(token);
  const params = new URLSearchParams({ contentFilter: '', page: '1', pageSize: '1000', sortField: 'createTime', sortDirection: '-1' });
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Authorization': `Bearer ${token}`,
    'X-Website-Token': wt,
    'X-BL': 'en-US',
    'Origin': 'https://gofile.io',
    'Referer': 'https://gofile.io/'
  };
  return fetch(`https://api.gofile.io/contents/${contentId}?${params}`, { headers, signal });
}

export async function scrapeGoFile(url) {
  const match = url.match(/gofile\.io\/d\/([a-zA-Z0-9]+)/);
  if (!match) return null;
  const contentId = match[1];

  const abortController = new AbortController();
  const overallTimeout = setTimeout(() => abortController.abort(), 45000);

  try {
    const sessionOk = await ensureGoFileSession();
    if (sessionOk) {
      let contentRes = await fetchGoFileContents(contentId, cachedGoFileToken, abortController.signal);

      if (!contentRes.ok) {
        console.warn(`[GoFile] API error ${contentRes.status}, refreshing session...`);
        cachedGoFileToken = null;
        cachedGoFileWT = null;
        lastGoFileRefresh = 0;
        const retryOk = await ensureGoFileSession();
        if (retryOk) {
          contentRes = await fetchGoFileContents(contentId, cachedGoFileToken, abortController.signal);
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

export { generateWT, createGoFileToken, fetchGoFileWT, ensureGoFileSession, fetchGoFileContents };
