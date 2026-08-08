import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carrega .env da raiz do projeto, se existir. Parser mínimo, sem
// dependências: ignora linhas em branco e comentários, e NUNCA sobrescreve
// variáveis já definidas no ambiente do sistema.
function loadEnvFile() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2) {
      const first = value[0];
      const last = value[value.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1);
      }
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile();

export const PORT = parseInt(process.env.PORT, 10) || 3006;
export const TEMP_DIR = path.join(__dirname, '..', 'temp_zips');
export const AUTH_TOKEN = process.env.DOWNDASH_TOKEN || null;

export const RATE_LIMIT_WINDOW = 60_000;
export const RATE_LIMIT_MAX = 20;

export const BODY_LIMIT_AUTH = 10 * 1024;
export const BODY_LIMIT_ANALYZE = 100 * 1024;
export const BODY_LIMIT_ZIP = 10 * 1024 * 1024;

export const ZIP_CONCURRENCY = 3;
export const ZIP_TASK_CONCURRENCY = 1;
export const ZIP_MAX_QUEUED_TASKS = 5;
export const ZIP_MAX_TASKS_PER_IP = positiveInt(process.env.ZIP_MAX_TASKS_PER_IP, 2);

function positiveInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export const ZIP_MAX_ITEMS = positiveInt(process.env.ZIP_MAX_ITEMS, 200);
export const ZIP_FETCH_TIMEOUT_MS = positiveInt(process.env.ZIP_FETCH_TIMEOUT_MS, 30000);
export const ZIP_MAX_TOTAL_BYTES = positiveInt(process.env.ZIP_MAX_TOTAL_BYTES, 20 * 1024 * 1024 * 1024);
export const ZIP_MAX_TEMP_BYTES = positiveInt(process.env.ZIP_MAX_TEMP_BYTES, 50 * 1024 * 1024 * 1024);

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
