import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';

import { analyzePage } from './server/scrapers/index.js';
import { scrapeGeneric, candidateToMediaItem, mediaItemToLegacy } from './server/scrapers/generic.js';
import { collectNetworkMedia } from './server/browser/collect-network-media.js';
import { resolveMediaUrl } from './server/media/resolve-media-url.js';
import { classifyMedia } from './server/media/classify-media.js';
import {
  MIME_TYPES, CACHE_DURATIONS, fetchWithCookies, enrichItemSizes,
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

import { PORT, TEMP_DIR, AUTH_TOKEN, BODY_LIMIT_AUTH, BODY_LIMIT_ANALYZE, BODY_LIMIT_ZIP, ZIP_MAX_ITEMS, ZIP_MAX_TASKS_PER_IP, httpsOptions, RATE_LIMIT_MAX } from './server/config.js';
import { rateLimit } from './server/middleware/rate-limit.js';
import { collectBody } from './server/middleware/body-collector.js';
import { requireAuth, sendUnauthorized } from './server/middleware/auth.js';
import { zipTasks, runZipTask, createZipTask, zipTaskQueue, cleanupZipTask, removeZipFile, cleanupOrphanedZips } from './server/zip.js';
import { handleProxy } from './server/proxy.js';
import { serveStatic } from './server/static.js';

// HTTP Server & Route Handler
const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = reqUrl.pathname;
  const method = req.method;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (!pathname.startsWith('/download-zip/status/')) {
    console.log(`[${new Date().toISOString()}] ${method} ${pathname}`);
  }

  if (AUTH_TOKEN && pathname !== '/auth' && !pathname.startsWith('/auth?')) {
    const ext = path.extname(pathname).toLowerCase();
    const isStatic = ['.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.mp4', '.webm', '.mp3'].includes(ext);
    const isLocale = pathname.startsWith('/locales/');
    if (!isStatic && !isLocale && !requireAuth(req, res)) {
      return sendUnauthorized(res);
    }
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
        console.warn(`[Analyze] Missing URL in request body`);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'URL is required' }));
      }
      const mode = body.mode || 'static';
      if (mode !== 'static' && mode !== 'rendered' && mode !== 'auto') {
        console.warn(`[Analyze] Invalid mode: ${mode}`);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: "Invalid mode. Use 'static', 'rendered' or 'auto'." }));
      }

      // Converte candidatos do navegador pelo mesmo pipeline (resolve → classifica
      // com MIME → MediaItem → saída legada), removendo duplicatas pela URL final.
      // Aceita o formato novo { candidates } e o antigo { urls } (temporário).
      const buildRenderedItems = (collected) => {
        const candidates = Array.isArray(collected.candidates)
          ? collected.candidates
          : (collected.urls || []).map(url => ({ url, mimeType: null, source: 'network-response' }));
        const seen = new Set();
        const items = [];
        for (const candidate of candidates) {
          if (!candidate || typeof candidate.url !== 'string') continue;
          const resolved = resolveMediaUrl(candidate.url, body.url);
          if (!resolved || seen.has(resolved)) continue;
          seen.add(resolved);
          const classification = classifyMedia({ url: resolved, mimeType: candidate.mimeType });
          if (!classification) continue;
          items.push(mediaItemToLegacy(candidateToMediaItem({ url: resolved, ...classification, mimeType: candidate.mimeType }, null)));
        }
        return items;
      };

      console.log(`[Analyze] ${mode} mode for: ${body.url}`);
      let result;
      let browserWarnings = [];
      let usedBrowser = false;

      if (mode === 'rendered') {
        const collected = await collectNetworkMedia(body.url);
        usedBrowser = true;
        browserWarnings = Array.isArray(collected.warnings) ? collected.warnings : [];
        result = { title: body.url, url: body.url, items: buildRenderedItems(collected) };
      } else {
        result = await analyzePage(body.url);
        // auto: só cai no navegador quando a análise estática retorna zero itens.
        if (mode === 'auto' && result && result.items.length === 0) {
          console.log(`[Analyze] Static returned 0 items — falling back to rendered for ${body.url}`);
          const collected = await collectNetworkMedia(body.url);
          usedBrowser = true;
          browserWarnings = Array.isArray(collected.warnings) ? collected.warnings : [];
          result = { title: body.url, url: body.url, items: buildRenderedItems(collected) };
        }
      }

      const count = result?.items?.length || 0;
      console.log(`[Analyze] Result: ${count} item(s) for ${body.url}`);
      if (count > 0) {
        await enrichItemSizes(result.items);
      }
      if (count === 0) {
        console.warn(`[Analyze] No items found for URL: ${body.url}`);
      }
      const payload = usedBrowser ? { ...result, warnings: browserWarnings } : result;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    } catch (err) {
      console.error(`[Analyze] Error: ${err.message}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/proxy') {
    await handleProxy(req, res, reqUrl);
    return;
  }

  if (req.method === 'POST' && pathname === '/download-zip') {
    let bodyStr;
    try {
      bodyStr = await collectBody(req, res, BODY_LIMIT_ZIP);
    } catch { return; }
    try {
      const body = JSON.parse(bodyStr);
      const items = body.items || [];
      if (items.length === 0) {
        console.warn(`[ZIP] No items provided`);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'No items provided for ZIP' }));
      }

      if (items.length > ZIP_MAX_ITEMS) {
        console.warn(`[ZIP] Too many items: ${items.length} exceeds max ${ZIP_MAX_ITEMS}`);
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
      console.log(`[ZIP] Creating task ${taskId} with ${items.length} file(s)`);

      // Registra a tarefa com status inicial 'queued' e a coloca na fila.
      createZipTask(taskId, items, { clientIp });
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
      console.error(`[ZIP] Error creating task: ${err.message}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
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
    console.log(`[ZIP] Serving result: ${taskId} (${(stat.size / 1024 / 1024).toFixed(1)} MB) as ${filename}`);

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
    readStream.on('error', cleanupResult);
    readStream.on('end', cleanupResult);
    readStream.pipe(res);
    return;
  }

  if (req.method === 'GET' && pathname.startsWith('/download-zip/cancel/')) {
    const taskId = pathname.replace('/download-zip/cancel/', '');
    const task = zipTasks.get(taskId);
    if (task) {
      console.log(`[ZIP] Cancelling task: ${taskId}`);
      if (task.status === 'queued') {
        // Tarefa ainda na fila: apenas a remove de waiting e marca como
        // cancelada sem nunca executar runZipTask (nem criar ZIP/temporários).
        zipTaskQueue.cancel(taskId);
        task.status = 'cancelled';
        task.finishedAt = Date.now();
      } else {
        await cleanupZipTask(task, { status: 'cancelled', abort: true });
        await removeZipFile(task.zipFilePath);
        zipTasks.delete(taskId);
      }
    } else {
      console.warn(`[ZIP] Cancel request for unknown task: ${taskId}`);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ cancelled: true }));
  }

  serveStatic(req, res, pathname);
});

// Server Startup
const handler = server;

if (process.env.VITEST) {
} else if (httpsOptions) {
  https.createServer(httpsOptions, (req, res) => handler.emit('request', req, res)).listen(PORT, () => {
    console.log(`🚀 WebScope HTTPS running on https://localhost:${PORT}`);
  });
} else {
  handler.listen(PORT, () => {
    const proto = AUTH_TOKEN ? ' (auth enabled)' : '';
    console.log(`🚀 WebScope running on http://localhost:${PORT}${proto}`);
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
