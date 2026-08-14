import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

const contexts = new AsyncLocalStorage();
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const configuredLevel = Object.hasOwn(LEVELS, process.env.LOG_LEVEL)
  ? process.env.LOG_LEVEL
  : 'info';
const configuredFormat = ['json', 'pretty'].includes(process.env.LOG_FORMAT)
  ? process.env.LOG_FORMAT
  : (process.env.NODE_ENV === 'production' || process.env.VITEST ? 'json' : 'pretty');
const counters = new Map();
const gauges = new Map();
const COLORS = {
  debug: '\u001b[90m',
  info: '\u001b[36m',
  warn: '\u001b[33m',
  error: '\u001b[31m',
  reset: '\u001b[0m',
  dim: '\u001b[2m',
};

function cleanText(value) {
  return String(value)
    .replace(/https?:\/\/[^\s"']+/gi, '[redacted-url]')
    .replace(/(bearer\s+)[^\s"']+/gi, '$1[redacted]');
}

function safeValue(key, value) {
  if (/token|authorization|cookie|password|secret|(^|_)url$/i.test(key)) return '[redacted]';
  if (value instanceof Error) return { name: value.name, message: cleanText(value.message), code: value.code };
  if (typeof value === 'string') return cleanText(value);
  if (Array.isArray(value)) return value.slice(0, 20).map(item => safeValue('', item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, safeValue(childKey, child)]));
  }
  return value;
}

export function log(level, event, fields = {}) {
  if (!Object.hasOwn(LEVELS, level) || LEVELS[level] < LEVELS[configuredLevel]) return;
  const context = contexts.getStore() || {};
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...safeValue('', context),
    ...safeValue('', fields),
  };
  const output = configuredFormat === 'pretty'
    ? `${formatPrettyLog(entry, Boolean(process.stdout.isTTY))}\n`
    : `${JSON.stringify(entry)}\n`;
  (level === 'error' ? process.stderr : process.stdout).write(output);
}

function compactValue(value) {
  if (typeof value === 'string') return /\s/.test(value) ? JSON.stringify(value) : value;
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function formatPrettyLog(entry, color = false) {
  const time = entry.timestamp?.slice(11, 19) || '--:--:--';
  const level = String(entry.level || 'info').toUpperCase().padEnd(5);
  const requestId = entry.requestId ? String(entry.requestId).slice(0, 8) : null;
  const omitted = new Set(['timestamp', 'level', 'event', 'requestId']);
  const details = Object.entries(entry)
    .filter(([key, value]) => !omitted.has(key) && value !== undefined)
    .map(([key, value]) => `${key}=${compactValue(value)}`);
  if (requestId) details.unshift(`request=${requestId}`);
  const plain = `${time} ${level} ${entry.event}${details.length ? `  ${details.join(' ')}` : ''}`;
  if (!color) return plain;
  const tone = COLORS[entry.level] || '';
  return `${COLORS.dim}${time}${COLORS.reset} ${tone}${level}${COLORS.reset} ${plain.slice(15)}`;
}

export const logger = {
  debug: (event, fields) => log('debug', event, fields),
  info: (event, fields) => log('info', event, fields),
  warn: (event, fields) => log('warn', event, fields),
  error: (event, fields) => log('error', event, fields),
};

export function installConsoleBridge() {
  if (console.__webscopeStructured) return;
  Object.defineProperty(console, '__webscopeStructured', { value: true });
  for (const [method, level] of [['log', 'debug'], ['warn', 'warn'], ['error', 'error']]) {
    console[method] = (...args) => {
      const message = args.map(value => {
        if (value instanceof Error) return `${value.name}: ${value.message}`;
        if (typeof value === 'object') {
          try { return JSON.stringify(value); } catch { return '[unserializable]'; }
        }
        return String(value);
      }).join(' ');
      log(level, 'legacy.console', { message });
    };
  }
}

function validRequestId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(value);
}

function metricKey(name, labels = {}) {
  const normalized = Object.entries(labels)
    .filter(([, value]) => value !== undefined && value !== null)
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify([name, normalized]);
}

function updateMetric(store, name, labels, value, mode) {
  const key = metricKey(name, labels);
  const current = store.get(key) || { name, labels: { ...labels }, value: 0 };
  current.value = mode === 'set' ? value : current.value + value;
  store.set(key, current);
}

export function increment(name, labels = {}, value = 1) {
  updateMetric(counters, name, labels, value, 'add');
}

export function gauge(name, value, labels = {}) {
  updateMetric(gauges, name, labels, value, 'set');
}

export function observe(name, seconds, labels = {}) {
  increment(`${name}_count`, labels);
  increment(`${name}_sum`, labels, seconds);
}

function formatLabels(labels) {
  const entries = Object.entries(labels);
  if (entries.length === 0) return '';
  const values = entries.map(([key, value]) => `${key}="${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  return `{${values.join(',')}}`;
}

export function renderMetrics() {
  const runtime = [
    { name: 'webscope_process_uptime_seconds', labels: {}, value: process.uptime() },
    { name: 'webscope_process_resident_memory_bytes', labels: {}, value: process.memoryUsage().rss },
  ];
  return [...counters.values(), ...gauges.values(), ...runtime]
    .sort((a, b) => metricKey(a.name, a.labels).localeCompare(metricKey(b.name, b.labels)))
    .map(metric => `${metric.name}${formatLabels(metric.labels)} ${metric.value}`)
    .join('\n') + '\n';
}

export function resetMetrics() {
  counters.clear();
  gauges.clear();
}

export function withContext(values, callback) {
  return contexts.run({ ...(contexts.getStore() || {}), ...values }, callback);
}

export function getContext() {
  return contexts.getStore() || {};
}

export function withRequestContext(req, res, callback) {
  const incomingId = req.headers['x-request-id'];
  const requestId = validRequestId(incomingId) ? incomingId : randomUUID();
  const startedAt = process.hrtime.bigint();
  res.setHeader('X-Request-ID', requestId);

  return withContext({ requestId }, async () => {
    res.once('finish', () => {
      const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
      const route = req.observabilityRoute || 'unmatched';
      const statusClass = `${Math.floor(res.statusCode / 100)}xx`;
      increment('webscope_http_requests_total', { method: req.method, route, status_class: statusClass });
      observe('webscope_http_request_duration_seconds', durationSeconds, { method: req.method, route });
      logger.info('http.request.completed', {
        method: req.method,
        route,
        statusCode: res.statusCode,
        durationMs: Math.round(durationSeconds * 1000),
      });
    });
    return callback();
  });
}
