import { isPrivateHost } from './middleware/ssrf.js';
import { increment, logger, observe } from './observability.js';
import { getGoFileDownloadHeaders, isGoFileUrl } from './scrapers/gofile.js';

export async function handleProxy(req, res, reqUrl) {
  const startedAt = process.hrtime.bigint();
  let clientClosed = false;
  res.once('close', () => { clientClosed = true; });
  // Desconexões no proxy de desenvolvimento não podem virar eventos de erro
  // sem listener e derrubar o processo Node.
  res.on('error', error => {
    logger.warn('proxy.response_error', { error });
  });
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

  logger.info('proxy.started', { rangeRequested: Boolean(req.headers.range) });
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
    } else if (targetUrl.includes('imagepond.net')) {
      headers['Referer'] = 'https://www.imagepond.net/';
    }

    const MAX_REDIRECTS = 5;
    let currentUrl = targetUrl;
    let proxyRes;
    const goFileHeaders = isGoFileUrl(targetUrl) ? await getGoFileDownloadHeaders() : null;
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      const requestHeaders = isGoFileUrl(currentUrl) && goFileHeaders
        ? { ...headers, ...goFileHeaders }
        : headers;
      proxyRes = await fetch(currentUrl, { headers: requestHeaders, redirect: 'manual' });
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
        logger.debug('proxy.redirect_followed', { redirectNumber: i + 1 });
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
    let transferredBytes = 0;

    if (proxyRes.body && typeof proxyRes.body.getReader === 'function') {
      const reader = proxyRes.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (clientClosed || res.writableEnded || res.destroyed) {
          await reader.cancel().catch(() => {});
          break;
        }
        transferredBytes += value.byteLength;
        res.write(Buffer.from(value));
      }
      if (!clientClosed && !res.writableEnded && !res.destroyed) res.end();
    } else {
      const buffer = Buffer.from(await proxyRes.arrayBuffer());
      transferredBytes = buffer.length;
      res.end(buffer);
    }
    const outcome = proxyRes.ok || proxyRes.status === 206 ? 'success' : 'upstream_error';
    increment('webscope_proxy_requests_total', { outcome, status_class: `${Math.floor(proxyRes.status / 100)}xx` });
    increment('webscope_downloads_total', { kind: 'proxy', outcome });
    increment('webscope_download_bytes_total', { kind: 'proxy' }, transferredBytes);
    observe('webscope_proxy_duration_seconds', Number(process.hrtime.bigint() - startedAt) / 1e9, { outcome });
    logger.info('proxy.completed', { statusCode: proxyRes.status, transferredBytes, outcome });
  } catch (err) {
    increment('webscope_proxy_requests_total', { outcome: 'error', status_class: '5xx' });
    observe('webscope_proxy_duration_seconds', Number(process.hrtime.bigint() - startedAt) / 1e9, { outcome: 'error' });
    logger.error('proxy.failed', { error: err });
    if (!res.headersSent) res.writeHead(502);
    if (!res.writableEnded && !res.destroyed) res.end('Proxy Error');
  }
}
