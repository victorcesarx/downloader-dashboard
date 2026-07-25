import { RATE_LIMIT_WINDOW, RATE_LIMIT_MAX } from '../config.js';

export const rateLimitStore = new Map();

export function rateLimit(req) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let entry = rateLimitStore.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW) {
    entry = { windowStart: now, count: 0 };
    rateLimitStore.set(ip, entry);
  }
  entry.count++;
  return { allowed: entry.count <= RATE_LIMIT_MAX, remaining: Math.max(0, RATE_LIMIT_MAX - entry.count), reset: entry.windowStart + RATE_LIMIT_WINDOW };
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitStore) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW * 2) rateLimitStore.delete(ip);
  }
}, 60_000);
