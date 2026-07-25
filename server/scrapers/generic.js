import { fetchText, extractOGImage } from '../utils.js';

export async function scrapeGeneric(url) {
  const html = await fetchText(url);
  if (!html) {
    return { title: url, url, items: [] };
  }

  const titleMatch = html.match(/<title>(.*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : url;
  const items = [];
  const seen = new Set();

  const pageOGImage = extractOGImage(html);

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
