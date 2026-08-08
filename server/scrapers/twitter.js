import { fetchText, extractOGImage } from '../utils.js';

export async function scrapeTwitter(url) {
  const html = await fetchText(url);
  if (!html) return { title: url, url, items: [] };

  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s*\/\s*X$/, '').replace(/&quot;/g, '"').trim() : url;
  const items = [];
  const seen = new Set();

  const ogImage = extractOGImage(html);

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
      thumbnail: ogImage,
      mimeType: 'video/mp4',
      width: best.width || null,
      height: best.height || null,
      quality: best.width && best.height ? `${best.width}x${best.height}` : null,
      delivery: 'progressive',
      source: 'twitter'
    });
  }

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
        thumbnail: ogImage,
        mimeType: 'application/vnd.apple.mpegurl',
        delivery: 'hls',
        source: 'twitter'
      });
    }
  }

  let imgUrls = [];
  const tweetId = url.match(/\/status\/(\d+)/i)?.[1];

  const metaImgRegex = /<meta[^>]+(?:property|name)\s*=\s*["'](?:og:image|twitter:image(?::src)?)["'][^>]+content\s*=\s*["']([^"']+)["']/gi;
  let mm;
  while ((mm = metaImgRegex.exec(html)) !== null) {
    let url = mm[1].replace(/&amp;/g, '&');
    if (!seen.has(url)) {
      seen.add(url);
      imgUrls.push(url);
    }
  }

  if (tweetId) {
    const photoImgRegex = new RegExp(
      '<img[^>]*src\\s*=\\s*["\'][^"\']*pbs\\.twimg\\.com\\/media\\/[^"\']*["\'][^>]*>(?:(?!<img)[\\s\\S])*?<a[^>]*href\\s*=\\s*["\'][^"\']*\\/status\\/' + tweetId + '\\/photo\\/\\d+["\']',
      'gi'
    );
    let mi;
    while ((mi = photoImgRegex.exec(html)) !== null) {
      const srcMatch = mi[0].match(/src\s*=\s*["']([^"']+)["']/i);
      if (srcMatch) {
        let imgUrl = srcMatch[1].replace(/&amp;/g, '&');
        if (!seen.has(imgUrl)) {
          seen.add(imgUrl);
          imgUrls.push(imgUrl);
        }
      }
    }
  }

  const baseSeen = new Set();
  for (const imgUrl of imgUrls) {
    let key = imgUrl.split('?')[0];
    key = key.replace(/:\w+$/, '');
    key = key.replace(/\.\w{3,4}$/, '');
    if (baseSeen.has(key)) continue;
    baseSeen.add(key);
    const nameMatch = imgUrl.match(/\/([^\/?]+)/);
    let name = nameMatch ? decodeURIComponent(nameMatch[1]) : 'tweet_image.jpg';
    let finalUrl = imgUrl.replace(/\?.*$/, '') + '?format=jpg&name=orig';
    if (imgUrl.match(/\.\w{3,4}(?::|$)/)) {
      finalUrl = imgUrl.replace(/:\w+$/, '');
    }
    const extMatch = imgUrl.match(/\.(\w{3,4})(?:\?|$)/);
    const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
    console.log(`[Twitter] Image: ${finalUrl.substring(0, 100)}`);
    items.push({
      type: 'image',
      name,
      url: finalUrl,
      ext,
      label: 'image',
      size: 0,
      thumbnail: imgUrl,
      mimeType: ext === 'png' ? 'image/png' : 'image/jpeg',
      source: 'twitter'
    });
  }

  return { title, url, items };
}
