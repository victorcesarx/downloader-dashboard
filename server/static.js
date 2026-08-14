import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { MIME_TYPES, CACHE_DURATIONS } from './utils.js';
import { AUTH_TOKEN } from './config.js';
import { requireAuth, getLoginPage } from './middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'";

export function getStaticRoot() {
  return process.env.NODE_ENV === 'production'
    ? path.join(projectRoot, 'dist')
    : projectRoot;
}

export function cacheControlFor(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  if (/\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[^/]+$/.test(normalized)) {
    return 'public, max-age=31536000, immutable';
  }
  return CACHE_DURATIONS[path.extname(filePath).toLowerCase()] || 'no-cache';
}

export function isCompressibleContentType(contentType) {
  return contentType.startsWith('text/')
    || contentType.startsWith('application/javascript')
    || contentType.startsWith('application/json');
}

export function serveStatic(req, res, pathname) {
  const requestedPath = pathname === '/' ? 'index.html' : pathname.slice(1);

  if (AUTH_TOKEN && (requestedPath.endsWith('.html') || pathname === '/')) {
    if (!requireAuth(req, res)) {
      res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP });
      return res.end(getLoginPage());
    }
  }

  const rootDir = getStaticRoot();
  let filePath = path.resolve(rootDir, requestedPath);

  const relativePath = path.relative(rootDir, filePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    console.warn(`[Static] Blocked path traversal attempt: ${pathname}`);
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (fs.existsSync(filePath) && !fs.statSync(filePath).isDirectory()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const cacheControl = cacheControlFor(filePath);
    const headers = { 'Content-Type': contentType, 'Cache-Control': cacheControl };
    if (contentType === 'text/html; charset=utf-8') headers['Content-Security-Policy'] = CSP;

    if (isCompressibleContentType(contentType)) {
      const acceptEncoding = req.headers['accept-encoding'] || '';
      if (acceptEncoding.includes('gzip')) {
        headers['Content-Encoding'] = 'gzip';
        res.writeHead(200, headers);
        const stream = fs.createReadStream(filePath);
        stream.pipe(zlib.createGzip()).pipe(res);
        return;
      }
    }

    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/html', 'Content-Security-Policy': CSP });
    res.end('<h1>404 - Page not found</h1>');
  }
}
