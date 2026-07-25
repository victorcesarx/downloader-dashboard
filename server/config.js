import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PORT = parseInt(process.env.PORT, 10) || 3006;
export const TEMP_DIR = path.join(__dirname, '..', 'temp_zips');
export const AUTH_TOKEN = process.env.DOWNDASH_TOKEN || null;

export const RATE_LIMIT_WINDOW = 60_000;
export const RATE_LIMIT_MAX = 20;

export const BODY_LIMIT_AUTH = 10 * 1024;
export const BODY_LIMIT_ANALYZE = 100 * 1024;
export const BODY_LIMIT_ZIP = 10 * 1024 * 1024;

export const ZIP_CONCURRENCY = 3;

const CERTS_DIR = path.join(__dirname, '..', 'certs');
export let httpsOptions = null;
try {
  const certPath = path.join(CERTS_DIR, 'cert.pem');
  const keyPath = path.join(CERTS_DIR, 'key.pem');
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    httpsOptions = {
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath)
    };
  }
} catch (e) {
  console.warn('[HTTPS] Failed to load cert files, falling back to HTTP only');
}

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

export const PRIVATE_IPV4 = [
  { addr: '10.', mask: 8 },
  { addr: '127.', mask: 8 },
  { addr: '169.254.', mask: 16 },
  { addr: '172.16.', mask: 12 },
  { addr: '192.168.', mask: 16 },
  { addr: '0.', mask: 8 },
  { addr: '100.64.', mask: 10 },
];
