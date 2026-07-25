import { fetchWithCookies, fetchText } from '../utils.js';

export async function scrapeCyberDrop(url) {
  try {
    if (!url.includes('cyberdrop.')) return null;
    const html = await fetchText(url);
    if (!html) return null;

    const titleM = html.match(/<title>(.*?)<\/title>/i);
    console.log(`[CyberDrop] title="${titleM ? titleM[1] : 'N/A'}" len=${html.length} og:video=${/og:video/i.test(html)} <video>=${/<video/i.test(html)} <source>=${/<source/i.test(html)} og:image=${/og:image/i.test(html)} img=${/<img\s/i.test(html)}`);

    const cfPatterns = ['cf-browser-', 'challenge-platform', 'Just a moment', 'Attention Required', 'Cloudflare Ray ID', 'cf-error-details'];
    if (cfPatterns.some(p => html.includes(p))) {
      console.warn(`[CyberDrop] Blocked by Cloudflare challenge: ${url}`);
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
    if (items.length === 0) {
      const ogVideo = html.match(/property=["']og:video["']\s+content=["']([^"']+)["']/i)
                   || html.match(/content=["']([^"']+)["']\s+property=["']og:video["']/i);
      if (ogVideo) addItem(ogVideo[1], null, 'video');
    }
    if (items.length === 0) {
      console.log(`[CyberDrop] API + HTML fallback failed for ${url}`);
    }
  }

  else {
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
          type: 'video', name: resolved.name, url: resolved.url,
          ext: (resolved.type || '').split('/')[1] || 'mp4',
          label: 'video', size: resolved.size, thumbnail: resolved.thumbnail
        });
      }
    }

    const textLinkRegex = /<a[^>]+href=["']\/f\/([a-zA-Z0-9]+)["'][^>]*>([^<]+)<\/a>/gi;
    let tl;
    let textMatchCount = 0;
    while ((tl = textLinkRegex.exec(html)) !== null && items.length < 50) {
      textMatchCount++;
      const fileId = tl[1];
      const fileName = tl[2].trim();
      console.log(`[CyberDrop] Step 2b: found fileId=${fileId} name=${fileName}`);
      if (seen.has(fileId)) continue;
      seen.add(fileId);
      const resolved = await resolveCyberDropFile(fileId, null);
      if (resolved) {
        console.log(`[CyberDrop] Step 2b: resolved ${resolved.name}`);
        items.push({
          type: 'video', name: resolved.name, url: resolved.url,
          ext: (resolved.type || '').split('/')[1] || 'mp4',
          label: 'video', size: resolved.size, thumbnail: resolved.thumbnail
        });
      } else {
        console.log(`[CyberDrop] Step 2b: FAILED to resolve ${fileId}`);
      }
    }
    console.log(`[CyberDrop] Step 2b: ${textMatchCount} matches, ${items.length} items`);

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

export { scrapeCyberDropWithHtml };
