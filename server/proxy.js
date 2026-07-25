import { isPrivateHost } from './middleware/ssrf.js';

export async function handleProxy(req, res, reqUrl) {
  const targetUrl = reqUrl.searchParams.get('url');
  if (!targetUrl) {
    res.writeHead(400);
    return res.end('URL parameter missing');
  }

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
  try {
    const isPrivate = await isPrivateHost(parsedUrl.hostname);
    if (isPrivate) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Access to private IPs is blocked' }));
    }
  } catch {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Access blocked' }));
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

    const MAX_REDIRECTS = 5;
    let currentUrl = targetUrl;
    let proxyRes;
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      proxyRes = await fetch(currentUrl, { headers, redirect: 'manual' });
      const status = proxyRes.status;
      if (status >= 300 && status < 400) {
        const location = proxyRes.headers.get('location');
        if (!location) break;
        const redirectUrl = new URL(location, currentUrl).href;
        const redirectParsed = new URL(redirectUrl);
        if (redirectParsed.protocol !== 'http:' && redirectParsed.protocol !== 'https:') {
          res.writeHead(502);
          return res.end('Proxy Error: Invalid redirect protocol');
        }
        const isPrivate = await isPrivateHost(redirectParsed.hostname);
        if (isPrivate) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Redirect to private IP blocked' }));
        }
        currentUrl = redirectUrl;
        console.log(`[Proxy] Following redirect ${i + 1}: ${redirectUrl.substring(0, 100)}`);
        continue;
      }
      break;
    }

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
}
