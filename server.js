import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';

import { analyzePage, identifyScraper } from './server/scrapers/index.js';
import { scrapeGeneric } from './server/scrapers/generic.js';
import {
  MIME_TYPES, CACHE_DURATIONS, enrichItemSizes,
  extractOGImage, escapeRegex, cookieJar, getCookies, setCookies, fetchText
} from './server/utils.js';
import {
  generateWT, scrapeGoFile, fetchGoFileWT, createGoFileToken,
  ensureGoFileSession, fetchGoFileContents
} from './server/scrapers/gofile.js';
import { scrapePixelDrain } from './server/scrapers/pixeldrain.js';
import { scrapeCyberDrop } from './server/scrapers/cyberdrop.js';
import { scrapeBunkr } from './server/scrapers/bunkr.js';
import { scrapeErome } from './server/scrapers/erome.js';
import { scrapeTwitter } from './server/scrapers/twitter.js';
import { scrapeImagePond } from './server/scrapers/imagepond.js';

import { PORT, TEMP_DIR, AUTH_TOKEN, BODY_LIMIT_AUTH, BODY_LIMIT_ANALYZE, BODY_LIMIT_ZIP, ZIP_MAX_ITEMS, ZIP_MAX_TASKS_PER_IP, httpsOptions, RATE_LIMIT_MAX } from './server/config.js';
import { rateLimit } from './server/middleware/rate-limit.js';
import { collectBody } from './server/middleware/body-collector.js';
import { requireAuth, sendUnauthorized } from './server/middleware/auth.js';
import { zipTasks, zipRetryReports, runZipTask, createZipTask, zipTaskQueue, cleanupZipTask, removeZipFile, cleanupOrphanedZips } from './server/zip.js';
import { handleProxy } from './server/proxy.js';
import { serveStatic } from './server/static.js';
import { probeMedia } from './server/media/probe-media.js';
import { gauge, increment, installConsoleBridge, logger, observe, renderMetrics, withRequestContext } from './server/observability.js';

installConsoleBridge();

function routeLabel(method, pathname) {
  if (pathname.startsWith('/download-zip/status/')) return '/download-zip/status/:taskId';
  if (pathname.startsWith('/download-zip/result/')) return '/download-zip/result/:taskId';
  if (pathname.startsWith('/download-zip/cancel/')) return '/download-zip/cancel/:taskId';
  if (pathname.startsWith('/download-zip/retry/')) return '/download-zip/retry/:taskId';
  const known = ['/health', '/metrics', '/auth', '/analyze', '/proxy', '/media-metadata', '/download-zip'];
  if (known.includes(pathname)) return pathname;
  if (method === 'GET' && path.extname(pathname)) return '/static';
  return pathname === '/' ? '/' : '/unmatched';
}

// HTTP Server & Route Handler
const server = http.createServer(async (req, res) => withRequestContext(req, res, async () => {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = reqUrl.pathname;
  const method = req.method;
  req.observabilityRoute = routeLabel(method, pathname);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  logger.debug('http.request.started', { method, route: req.observabilityRoute });

  if (AUTH_TOKEN && pathname !== '/auth' && !pathname.startsWith('/auth?')) {
    const ext = path.extname(pathname).toLowerCase();
    const isStatic = ['.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.mp4', '.webm', '.mp3'].includes(ext);
    const isLocale = pathname.startsWith('/locales/');
    if (pathname !== '/health' && !isStatic && !isLocale && !requireAuth(req, res)) {
      return sendUnauthorized(res);
    }
  }

  if (req.method === 'GET' && pathname === '/health') {
    let tempWritable = true;
    try {
      fs.accessSync(TEMP_DIR, fs.constants.R_OK | fs.constants.W_OK);
    } catch {
      tempWritable = false;
    }
    const healthy = tempWritable;
    res.writeHead(healthy ? 200 : 503, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    return res.end(JSON.stringify({
      status: healthy ? 'ok' : 'unhealthy',
      uptimeSeconds: Math.floor(process.uptime()),
      checks: { tempWritable },
    }));
  }

  if (req.method === 'GET' && pathname === '/metrics') {
    const tasks = [...zipTasks.values()];
    gauge('webscope_zip_tasks', tasks.filter(task => task.status === 'queued').length, { state: 'queued' });
    gauge('webscope_zip_tasks', tasks.filter(task => task.status === 'processing').length, { state: 'processing' });
    const body = renderMetrics();
    res.writeHead(200, {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(body),
    });
    return res.end(body);
  }

  if (AUTH_TOKEN && method === 'POST' && pathname === '/auth') {
    let bodyStr;
    try {
      bodyStr = await collectBody(req, res, BODY_LIMIT_AUTH);
    } catch { return; }
    try {
      const { token } = JSON.parse(bodyStr);
      if (token === AUTH_TOKEN) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true }));
      }
    } catch (e) {}
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid token' }));
    return;
  }

  if (req.method === 'POST' && pathname === '/analyze') {
    const startedAt = process.hrtime.bigint();
    let scraper = 'unknown';
    const rl = rateLimit(req);
    res.setHeader('X-RateLimit-Limit', RATE_LIMIT_MAX);
    res.setHeader('X-RateLimit-Remaining', rl.remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(rl.reset / 1000));
    if (!rl.allowed) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': Math.ceil((rl.reset - Date.now()) / 1000) });
      return res.end(JSON.stringify({ error: 'Too many requests. Please wait before analyzing another URL.' }));
    }
    let bodyStr;
    try {
      bodyStr = await collectBody(req, res, BODY_LIMIT_ANALYZE);
    } catch { return; }
    try {
      const body = JSON.parse(bodyStr);
      if (!body.url) {
        logger.warn('analysis.rejected', { reason: 'missing_url' });
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'URL is required' }));
      }

      scraper = identifyScraper(body.url);
      logger.info('analysis.started', { scraper });
      const result = await analyzePage(body.url);

      const count = result?.items?.length || 0;
      increment('webscope_analysis_total', { outcome: 'success', scraper });
      increment('webscope_scraper_requests_total', { outcome: 'success', scraper });
      increment('webscope_scraper_items_total', { scraper }, count);
      observe('webscope_analysis_duration_seconds', Number(process.hrtime.bigint() - startedAt) / 1e9, { scraper });
      logger.info('analysis.completed', { scraper, itemCount: count });
      if (count > 0) {
        await enrichItemSizes(result.items);
      }
      if (count === 0) {
        logger.warn('analysis.empty', { scraper });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      increment('webscope_analysis_total', { outcome: 'error', scraper });
      increment('webscope_scraper_requests_total', { outcome: 'error', scraper });
      observe('webscope_analysis_duration_seconds', Number(process.hrtime.bigint() - startedAt) / 1e9, { scraper });
      logger.error('analysis.failed', { scraper, error: err });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/proxy') {
    await handleProxy(req, res, reqUrl);
    return;
  }

  if (req.method === 'GET' && pathname === '/media-metadata') {
    const rl = rateLimit(req);
    res.setHeader('X-RateLimit-Limit', RATE_LIMIT_MAX);
    res.setHeader('X-RateLimit-Remaining', rl.remaining);
    if (!rl.allowed) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Too many requests' }));
    }
    const targetUrl = reqUrl.searchParams.get('url');
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'URL parameter missing' }));
    }
    try {
      const metadata = await probeMedia(targetUrl);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(metadata));
    } catch (error) {
      res.writeHead(error.status || 502, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: error.message || 'Metadata probe failed' }));
    }
  }

  if (req.method === 'POST' && pathname === '/download-zip') {
    let bodyStr;
    try {
      bodyStr = await collectBody(req, res, BODY_LIMIT_ZIP);
    } catch { return; }
    try {
      const body = JSON.parse(bodyStr);
      const items = body.items || [];
      const ignoredItems = Array.isArray(body.ignoredItems) ? body.ignoredItems : [];
      if (items.length === 0) {
        console.warn(`[ZIP] No items provided`);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'No items provided for ZIP' }));
      }

      if (items.length + ignoredItems.length > ZIP_MAX_ITEMS) {
        console.warn(`[ZIP] Too many items: ${items.length + ignoredItems.length} exceeds max ${ZIP_MAX_ITEMS}`);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          error: {
            code: 'ZIP_TOO_MANY_ITEMS',
            message: 'Número máximo de arquivos excedido.'
          }
        }));
      }

      // Limite de tarefas ZIP por IP: conta apenas as tarefas vivas (queued +
      // processing) do mesmo cliente. completed/cancelled/error não entram.
      const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
      let activeForIp = 0;
      for (const t of zipTasks.values()) {
        if (t.clientIp === clientIp && (t.status === 'queued' || t.status === 'processing')) activeForIp++;
      }
      if (activeForIp >= ZIP_MAX_TASKS_PER_IP) {
        console.warn(`[ZIP] IP limit reached for ${clientIp}: ${activeForIp}/${ZIP_MAX_TASKS_PER_IP}`);
        res.writeHead(429, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          error: {
            code: 'ZIP_IP_LIMIT_REACHED',
            message: 'Você já possui muitas tarefas ZIP em andamento.'
          }
        }));
      }

      const taskId = `zip_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      increment('webscope_zip_tasks_total', { outcome: 'accepted' });
      logger.info('zip.task.created', { taskId, itemCount: items.length });

      // Registra a tarefa com status inicial 'queued' e a coloca na fila.
      createZipTask(taskId, items, { clientIp, ignoredItems });
      try {
        zipTaskQueue.enqueue({ taskId, items });
      } catch (err) {
        // Fila cheia: remove a tarefa provisória (nunca chegou a ser enfileirada
        // nem executada) e responde 503 sem deixar órfãs.
        if (err && err.code === 'ZIP_QUEUE_FULL') {
          zipTasks.delete(taskId);
          res.writeHead(503, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            error: {
              code: 'ZIP_QUEUE_FULL',
              message: 'A fila de downloads ZIP está cheia. Tente novamente mais tarde.'
            }
          }));
        }
        throw err;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ taskId }));
    } catch (err) {
      increment('webscope_zip_tasks_total', { outcome: 'error' });
      logger.error('zip.task.create_failed', { error: err });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (req.method === 'POST' && pathname.startsWith('/download-zip/retry/')) {
    const sourceTaskId = pathname.replace('/download-zip/retry/', '');
    const sourceTask = zipTasks.get(sourceTaskId) || zipRetryReports.get(sourceTaskId);
    const failedItems = sourceTask?.itemResults
      ?.filter(result => result.outcome === 'failed' && result.item?.url)
      .map(result => result.item) || [];
    if (!sourceTask || failedItems.length === 0) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { code: 'ZIP_NO_FAILED_ITEMS', message: 'No failed ZIP items to retry' } }));
    }

    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    let activeForIp = 0;
    for (const task of zipTasks.values()) {
      if (task.clientIp === clientIp && (task.status === 'queued' || task.status === 'processing')) activeForIp++;
    }
    if (activeForIp >= ZIP_MAX_TASKS_PER_IP) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { code: 'ZIP_IP_LIMIT_REACHED', message: 'Too many ZIP tasks in progress' } }));
    }

    const taskId = `zip_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    createZipTask(taskId, failedItems, { clientIp, retryOf: sourceTaskId });
    try {
      zipTaskQueue.enqueue({ taskId, items: failedItems });
    } catch (err) {
      zipTasks.delete(taskId);
      const status = err?.code === 'ZIP_QUEUE_FULL' ? 503 : 500;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { code: err?.code || 'ZIP_RETRY_ERROR', message: err?.message || 'ZIP retry failed' } }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ taskId, total: failedItems.length, retryOf: sourceTaskId }));
  }

  if (req.method === 'GET' && pathname.startsWith('/download-zip/status/')) {
    const taskId = pathname.replace('/download-zip/status/', '');
    const task = zipTasks.get(taskId);
    if (!task) {
      console.warn(`[ZIP] Status check for unknown task: ${taskId}`);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Task not found' }));
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    const isLive = task.status === 'queued' || task.status === 'processing';
    return res.end(JSON.stringify({
      processed: task.processed,
      total: task.total,
      currentBytes: task.currentBytes,
      speed: task.speed,
      currentName: task.currentName,
      status: task.status,
      error: task.error,
      retryOf: task.retryOf || null,
      report: [...(task.itemResults || []), ...(task.ignoredResults || [])].map(result => ({
        index: result.index,
        name: result.name,
        ext: result.ext,
        outcome: result.outcome,
        reason: result.reason,
        httpStatus: result.httpStatus
      })),
      queuePosition: isLive ? zipTaskQueue.getPosition(taskId) : null
    }));
  }

  if (req.method === 'GET' && pathname.startsWith('/download-zip/result/')) {
    const taskId = pathname.replace('/download-zip/result/', '');
    const task = zipTasks.get(taskId);
    if (!task || !fs.existsSync(task.zipFilePath)) {
      console.warn(`[ZIP] Result request for missing task: ${taskId}`);
      res.writeHead(404);
      return res.end('ZIP File Not Found');
    }

    const stat = fs.statSync(task.zipFilePath);
    let filename = reqUrl.searchParams.get('filename') || 'webscope_media_pack.zip';
    if (!filename.endsWith('.zip')) filename += '.zip';
    increment('webscope_downloads_total', { kind: 'zip', outcome: 'started' });
    increment('webscope_download_bytes_total', { kind: 'zip' }, stat.size);
    logger.info('zip.result.started', { taskId, bytes: stat.size });

    let cleaned = false;
    let readStream = null;
    // Limpeza idempotente do download final: destrói o read stream, remove o
    // arquivo ZIP e a entrada da tarefa. Roda no fim normal ('end'), na
    // desconexão do cliente ('close') e em erros, sem nunca responder após o
    // início do envio.
    const cleanupResult = () => {
      if (cleaned) return;
      cleaned = true;
      if (readStream) {
        if (readStream.closed) {
          removeZipFile(task.zipFilePath);
        } else {
          readStream.destroy();
          readStream.once('close', () => removeZipFile(task.zipFilePath));
        }
      } else {
        removeZipFile(task.zipFilePath);
      }
      zipRetryReports.set(taskId, {
        itemResults: task.itemResults || [],
        savedAt: Date.now(),
      });
      zipTasks.delete(taskId);
    };

    res.on('close', cleanupResult);
    res.on('error', cleanupResult);

    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename="${filename}"`
    });

    readStream = fs.createReadStream(task.zipFilePath);
    task.resultReadStream = readStream;
    readStream.on('error', cleanupResult);
    readStream.on('end', cleanupResult);
    readStream.pipe(res);
    return;
  }

  if (req.method === 'GET' && pathname.startsWith('/download-zip/cancel/')) {
    const taskId = pathname.replace('/download-zip/cancel/', '');
    const task = zipTasks.get(taskId);
    const hadRetryReport = zipRetryReports.has(taskId);
    if (task) {
      increment('webscope_zip_tasks_total', { outcome: 'cancelled' });
      logger.info('zip.task.cancelled', { taskId });
      if (task.status === 'queued') {
        zipTaskQueue.cancel(taskId);
      }
      task.resultReadStream?.destroy();
      await cleanupZipTask(task, { status: 'cancelled', abort: true });
      await removeZipFile(task.zipFilePath);
      zipTasks.delete(taskId);
    } else {
      console.warn(`[ZIP] Cancel request for unknown task: ${taskId}`);
    }
    zipRetryReports.delete(taskId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ cancelled: true, removed: Boolean(task || hadRetryReport) }));
  }

  serveStatic(req, res, pathname);
}));

// Server Startup
const handler = server;

if (process.env.VITEST) {
} else if (httpsOptions) {
  https.createServer(httpsOptions, (req, res) => handler.emit('request', req, res)).listen(PORT, () => {
    logger.info('server.started', { protocol: 'https', port: PORT, authEnabled: Boolean(AUTH_TOKEN) });
  });
} else {
  handler.listen(PORT, () => {
    logger.info('server.started', { protocol: 'http', port: PORT, authEnabled: Boolean(AUTH_TOKEN) });
  });
}

export {
  server,
  extractOGImage,
  escapeRegex,
  generateWT,
  getCookies,
  setCookies,
  requireAuth,
  fetchText,
  analyzePage,
  fetchGoFileWT,
  createGoFileToken,
  ensureGoFileSession,
  fetchGoFileContents,
  scrapeGoFile,
  scrapePixelDrain,
  scrapeCyberDrop,
  scrapeBunkr,
  scrapeGeneric,
  scrapeErome,
  scrapeTwitter,
  scrapeImagePond,
  cookieJar,
  zipTasks,
  runZipTask,
  zipTaskQueue,
  enrichItemSizes,
  MIME_TYPES,
  CACHE_DURATIONS,
  cleanupOrphanedZips,
  PORT,
  TEMP_DIR,
  AUTH_TOKEN,
};
