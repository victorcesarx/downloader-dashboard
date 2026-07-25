import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';

import { analyzePage } from './server/scrapers/index.js';
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
import { scrapeGeneric } from './server/scrapers/generic.js';
import { scrapeErome } from './server/scrapers/erome.js';
import { scrapeTwitter } from './server/scrapers/twitter.js';

import { PORT, TEMP_DIR, AUTH_TOKEN, BODY_LIMIT_AUTH, BODY_LIMIT_ANALYZE, BODY_LIMIT_ZIP, httpsOptions, RATE_LIMIT_MAX } from './server/config.js';
import { rateLimit } from './server/middleware/rate-limit.js';
import { collectBody } from './server/middleware/body-collector.js';
import { requireAuth, sendUnauthorized } from './server/middleware/auth.js';
import { zipTasks, runZipTask, cleanupOrphanedZips } from './server/zip.js';
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
      console.log(`[Analyze] Analyzing: ${body.url}`);
      const result = await analyzePage(body.url);
      const count = result?.items?.length || 0;
      console.log(`[Analyze] Result: ${count} item(s) for ${body.url}`);
      if (count > 0) {
        await enrichItemSizes(result.items);
      }
      if (count === 0) {
        console.warn(`[Analyze] No items found for URL: ${body.url}`);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
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

      const taskId = `zip_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      console.log(`[ZIP] Starting task ${taskId} with ${items.length} file(s)`);
      runZipTask(taskId, items);

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
    return res.end(JSON.stringify({
      processed: task.processed,
      total: task.total,
      currentBytes: task.currentBytes,
      speed: task.speed,
      currentName: task.currentName,
      status: task.status,
      error: task.error
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
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename="${filename}"`
    });

    const readStream = fs.createReadStream(task.zipFilePath);
    readStream.pipe(res);

    readStream.on('end', () => {
      console.log(`[ZIP] Download complete, cleaning up task: ${taskId}`);
      try {
        fs.unlinkSync(task.zipFilePath);
        zipTasks.delete(taskId);
      } catch (e) {}
    });
    return;
  }

  if (req.method === 'GET' && pathname.startsWith('/download-zip/cancel/')) {
    const taskId = pathname.replace('/download-zip/cancel/', '');
    const task = zipTasks.get(taskId);
    if (task) {
      console.log(`[ZIP] Cancelling task: ${taskId}`);
      task.status = 'cancelled';
      if (task.abortController) {
        task.abortController.abort();
      }
      if (fs.existsSync(task.zipFilePath)) {
        try { fs.unlinkSync(task.zipFilePath); } catch (e) {}
      }
      zipTasks.delete(taskId);
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
  enrichItemSizes,
  MIME_TYPES,
  CACHE_DURATIONS,
  cleanupOrphanedZips,
  PORT,
  TEMP_DIR,
  AUTH_TOKEN,
};
