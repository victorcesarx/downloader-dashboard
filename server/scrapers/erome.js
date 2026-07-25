import { fetchText } from '../utils.js';

export async function scrapeErome(url) {
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
