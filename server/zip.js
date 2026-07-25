import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import { fileURLToPath } from 'url';
import { TEMP_DIR, ZIP_CONCURRENCY } from './config.js';
import { sanitizeZipName } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ZIP_RETENTION_MS = 30 * 60 * 1000;
export const zipTasks = new Map();

function pruneExpiredZipTasks(now = Date.now()) {
  let removedTasks = 0;
  for (const [taskId, task] of zipTasks.entries()) {
    if (task.status !== 'completed' && task.status !== 'cancelled' && task.status !== 'error') continue;
    if (!task.finishedAt) task.finishedAt = now;
    if (now - task.finishedAt > ZIP_RETENTION_MS) {
      zipTasks.delete(taskId);
      removedTasks++;
    }
  }
  return removedTasks;
}

export function cleanupOrphanedZips() {
  try {
    const files = fs.readdirSync(TEMP_DIR);
    const now = Date.now();
    let removed = 0;
    for (const file of files) {
      if (!file.endsWith('.zip')) continue;
      const filePath = path.join(TEMP_DIR, file);
      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > ZIP_RETENTION_MS) {
          fs.unlinkSync(filePath);
          removed++;
        }
      } catch (e) {}
    }

    const removedTasks = pruneExpiredZipTasks(now);
    if (removed > 0 || removedTasks > 0) {
      console.log(`[Cleanup] Removed ${removed} orphaned ZIP file(s) and ${removedTasks} stale task entry(ies)`);
    }
  } catch (e) {}
}

cleanupOrphanedZips();
setInterval(cleanupOrphanedZips, 5 * 60 * 1000);

export async function runZipTask(taskId, items) {
  const abortController = new AbortController();
  const task = {
    taskId,
    status: 'processing',
    total: items.length,
    processed: 0,
    currentBytes: 0,
    speed: 0,
    startTime: Date.now(),
    finishedAt: null,
    error: null,
    zipFilePath: path.join(TEMP_DIR, `${taskId}.zip`),
    abortController
  };

  zipTasks.set(taskId, task);
  console.log(`[ZIP] Task ${taskId}: processing ${items.length} file(s) with concurrency ${ZIP_CONCURRENCY}`);

  const output = fs.createWriteStream(task.zipFilePath);
  const archive = archiver('zip', { zlib: { level: 5 } });

  archive.pipe(output);

  const removeCancelledZip = () => {
    const unlinkIfExists = () => {
      try {
        if (fs.existsSync(task.zipFilePath)) fs.unlinkSync(task.zipFilePath);
      } catch (e) {}
    };

    if (output.closed || output.destroyed) {
      unlinkIfExists();
      return;
    }

    output.once('close', unlinkIfExists);
    output.destroy();
  };

  archive.on('error', (err) => {
    task.status = 'error';
    task.finishedAt = Date.now();
    task.error = err.message;
    console.error(`[ZIP] Task ${taskId}: archive error - ${err.message}`);
  });

  output.on('close', () => {
    console.log(`[ZIP] Task ${taskId}: finalized (${(archive.pointer() / 1024 / 1024).toFixed(1)} MB)`);
  });

  try {
    let index = 0;
    let completed = 0;
    const errors = [];

    async function fetchAndAppend(itemIdx) {
      if (task.status === 'cancelled') return;
      const item = items[itemIdx];
      console.log(`[ZIP] Task ${taskId}: fetching [${itemIdx + 1}/${items.length}] ${item.name}`);

      try {
        const fetchHeaders = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };
        if (item.url.includes('erome.com')) {
          fetchHeaders['Referer'] = 'https://www.erome.com/';
        }
        const itemRes = await fetch(item.url, { headers: fetchHeaders, signal: abortController.signal });

        if (itemRes.ok && task.status !== 'cancelled') {
          const chunks = [];
          if (itemRes.body && typeof itemRes.body.getReader === 'function') {
            const reader = itemRes.body.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
              task.currentBytes += value.length;
              const elapsed = (Date.now() - task.startTime) / 1000;
              task.speed = elapsed > 0 ? Math.round(task.currentBytes / elapsed) : 0;
            }
          } else {
            const buffer = Buffer.from(await itemRes.arrayBuffer());
            chunks.push(buffer);
            task.currentBytes += buffer.length;
          }
          const safeName = sanitizeZipName(item.name) || `file_${itemIdx + 1}.${item.ext || 'bin'}`;
          archive.append(Buffer.concat(chunks), { name: safeName });
          console.log(`[ZIP] Task ${taskId}: appended ${item.name} (${(task.currentBytes / 1024 / 1024).toFixed(1)} MB total)`);
        } else {
          console.warn(`[ZIP] Task ${taskId}: HTTP ${itemRes.status} for ${item.url}`);
          errors.push({ name: item.name, status: itemRes.status });
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.error(`[ZIP] Task ${taskId}: fetch error for ${item.name}: ${err.message}`);
        errors.push({ name: item.name, error: err.message });
      }

      completed++;
      task.processed = completed;
      const elapsedSec = (Date.now() - task.startTime) / 1000;
      task.speed = elapsedSec > 0 ? Math.round(task.currentBytes / elapsedSec) : 0;
    }

    const running = new Set();
    while (index < items.length && running.size < ZIP_CONCURRENCY) {
      const p = fetchAndAppend(index++);
      running.add(p);
      p.finally(() => running.delete(p));
    }

    while (running.size > 0) {
      if (task.status === 'cancelled') break;
      await Promise.race(running);
      while (index < items.length && running.size < ZIP_CONCURRENCY) {
        const p = fetchAndAppend(index++);
        running.add(p);
        p.finally(() => running.delete(p));
      }
    }

    if (task.status !== 'cancelled') {
      await archive.finalize();
      task.status = 'completed';
      task.finishedAt = Date.now();
      if (errors.length > 0) {
        task.error = `${errors.length} file(s) failed to download`;
      }
      console.log(`[ZIP] Task ${taskId}: completed (${items.length - errors.length}/${items.length} files)`);
    } else {
      task.finishedAt = Date.now();
      archive.destroy();
      removeCancelledZip();
    }
  } catch (err) {
    task.status = 'error';
    task.finishedAt = Date.now();
    task.error = err.message;
    console.error(`[ZIP] Task ${taskId}: fatal error - ${err.message}`);
    try { if (fs.existsSync(task.zipFilePath)) fs.unlinkSync(task.zipFilePath); } catch (e) {}
    archive.destroy();
    output.destroy();
  }
}
