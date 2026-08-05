import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import { Readable, Transform } from 'stream';
import { fileURLToPath } from 'url';
import { TEMP_DIR, ZIP_CONCURRENCY, PORT } from './config.js';

const SERVER_BASE = `http://localhost:${PORT}`;
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

    // Diretórios de itens temporários (<taskId>_items) deixados por crash.
    for (const dir of files) {
      const dirPath = path.join(TEMP_DIR, dir);
      try {
        const stat = fs.statSync(dirPath);
        if (stat.isDirectory() && dir.endsWith('_items') && now - stat.mtimeMs > ZIP_RETENTION_MS) {
          fs.rmSync(dirPath, { recursive: true, force: true });
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

const STATUS_RANK = { completed: 1, error: 2, cancelled: 3 };

// Número de tentativas por item em caso de erro de rede no meio do download
// (ex.: undici 'terminated' quando o host corta a conexão).
const MAX_ITEM_RETRIES = 2;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Remove o diretório de itens temporários da tarefa. No Windows, arquivos
// ainda abertos por read streams do archiver podem falhar no primeiro rm;
// tenta algumas vezes antes de desistir.
async function removeItemTmpDir(task) {
  if (!task.tmpDir) return;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await fs.promises.rm(task.tmpDir, { recursive: true, force: true });
      return;
    } catch (err) {
      if (attempt === 4) {
        console.error(`[ZIP] Task ${task.taskId}: failed to remove item temp dir - ${err.message}`);
      } else {
        await delay(100);
      }
    }
  }
}

// Aplica o estado final respeitando precedência: cancelled > error > completed.
// Uma tarefa finalizada (finishedAt setado) nunca muda de estado novamente.
function applyFinalStatus(task, status, error) {
  if (task.finishedAt !== null) return;
  const rank = STATUS_RANK[status] ?? 0;
  const currentRank = STATUS_RANK[task.status] ?? 0;
  if (rank >= currentRank) {
    task.status = status;
    if (error !== undefined && error !== null) task.error = error;
  }
  task.finishedAt = Date.now();
}

// ENOENT é tratado como sucesso; outros erros são registrados sem derrubar o servidor.
export async function removeZipFile(zipFilePath) {
  try {
    await fs.promises.unlink(zipFilePath);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`[ZIP] Failed to remove ${zipFilePath}: ${err.message}`);
    }
  }
}

function closeWriteStream(output) {
  return new Promise((resolve) => {
    if (output.closed) {
      resolve();
      return;
    }
    output.once('close', resolve);
    output.destroy();
  });
}

// Finalização/limpeza idempotente de uma tarefa. Só a primeira chamada executa:
// destroy do archiver e do write stream, abort de fetches/streams ativos,
// remoção do ZIP e aplicação do estado final. Nunca lança.
export async function cleanupZipTask(task, { status, error, abort = false, removeZip = true, destroyStreams = true } = {}) {
  if (task._cleaned) return task;
  task._cleaned = true;
  try {
    if (status) {
      applyFinalStatus(task, status, error);
    } else if (task.finishedAt === null) {
      task.finishedAt = Date.now();
    }
    if (abort) {
      try { task.abortController?.abort(); } catch (e) {}
    }
    if (destroyStreams) {
      const { archive, output } = task;
      if (archive && !archive.destroyed) {
        try { archive.destroy(); } catch (e) {}
      }
      if (output) await closeWriteStream(output);
    }
    if (removeZip) await removeZipFile(task.zipFilePath);
    await removeItemTmpDir(task);
  } catch (err) {
    console.error(`[ZIP] Task ${task.taskId}: cleanup failed - ${err.message}`);
  }
  return task;
}

export async function runZipTask(taskId, items, options = {}) {
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
    // options.tempDir permite injetar um diretório temporário isolado em testes; em produção TEMP_DIR é usado.
    zipFilePath: path.join(options.tempDir || TEMP_DIR, `${taskId}.zip`),
    tmpDir: null,
    abortController,
    archive: null,
    output: null,
    _cleaned: false
  };

  zipTasks.set(taskId, task);
  console.log(`[ZIP] Task ${taskId}: processing ${items.length} file(s) with concurrency ${ZIP_CONCURRENCY}`);

  const output = fs.createWriteStream(task.zipFilePath);
  const archive = archiver('zip', { zlib: { level: 5 } });
  task.archive = archive;
  task.output = output;

  archive.pipe(output);

  // Arquivos de item temporários anexados ao archiver: a fila do archiver é
  // FIFO (concurrency 1), então cada evento 'entry' corresponde ao próximo
  // arquivo da lista; o arquivo só pode ser removido depois que o archiver
  // terminou de lê-lo (no Windows, unlink com handle aberto falharia).
  const pendingTmp = [];
  archive.on('entry', () => {
    const tmpPath = pendingTmp.shift();
    if (tmpPath) removeZipFile(tmpPath);
  });

  archive.on('error', (err) => {
    // Durante o teardown (cleanupZipTask), o archiver pode emitir erros de
    // stream já destruído; a tarefa está sendo finalizada, então é silenciado.
    if (err && (err.code === 'ERR_STREAM_DESTROYED' || err.code === 'ERR_STREAM_WRITE_AFTER_END')) return;
    console.error(`[ZIP] Task ${taskId}: archive error - ${err.message}`);
    cleanupZipTask(task, { status: 'error', error: err.message, abort: true });
  });

  output.on('error', (err) => {
    // Em ZIPs grandes a limpeza pode destruir o output no meio de uma escrita
    // do archiver ("Cannot call writev after a stream was destroyed"); a tarefa
    // já está sendo finalizada e o erro é esperado, então é silenciado.
    if (err && (err.code === 'ERR_STREAM_DESTROYED' || err.code === 'ERR_STREAM_WRITE_AFTER_END')) return;
    console.error(`[ZIP] Task ${taskId}: write stream error - ${err.message}`);
    cleanupZipTask(task, { status: 'error', error: err.message, abort: true });
  });

  output.on('close', () => {
    if (task.status === 'completed') {
      console.log(`[ZIP] Task ${taskId}: finalized (${(archive.pointer() / 1024 / 1024).toFixed(1)} MB)`);
    }
  });

  try {
    let index = 0;
    let completed = 0;
    const errors = [];
    task.tmpDir = path.join(options.tempDir || TEMP_DIR, `${taskId}_items`);
    fs.mkdirSync(task.tmpDir, { recursive: true });

    function createProgressTransform() {
      return new Transform({
        transform(chunk, encoding, callback) {
          task.currentBytes += chunk.length;
          const elapsed = (Date.now() - task.startTime) / 1000;
          task.speed = elapsed > 0 ? Math.round(task.currentBytes / elapsed) : 0;
          callback(null, chunk);
        }
      });
    }

    // Baixa o corpo para um arquivo temporário em disco (streaming, sem
    // buffer em memória). O archiver nunca recebe um stream que pode falhar:
    // apenas arquivos completos são anexados, o que evita entrada truncada e
    // a trava da fila do archiver (que não sabe descartar uma entrada parcial).
    function streamItemToDisk(body, tmpPath) {
      return new Promise((resolve) => {
        const tmpOutput = fs.createWriteStream(tmpPath);
        const nodeStream = Readable.fromWeb(body);
        const progressStream = createProgressTransform();
        let settled = false;
        let failure = null;
        const done = (result) => {
          if (settled) return;
          settled = true;
          task.abortController.signal.removeEventListener('abort', onAbort);
          resolve(result);
        };
        const onAbort = () => {
          nodeStream.destroy();
          progressStream.destroy();
          tmpOutput.destroy();
          done({ outcome: 'cancelled' });
        };
        const onNodeError = (err) => {
          failure = err;
          if (!progressStream.destroyed) progressStream.destroy(err);
        };
        const onProgressError = () => {
          tmpOutput.destroy();
          done({ outcome: 'error', error: failure });
        };
        const onTmpError = (err) => {
          nodeStream.destroy();
          progressStream.destroy();
          done({ outcome: 'error', error: err });
        };
        task.abortController.signal.addEventListener('abort', onAbort, { once: true });
        nodeStream.once('error', onNodeError);
        progressStream.once('error', onProgressError);
        tmpOutput.once('error', onTmpError);
        tmpOutput.once('close', () => done({ outcome: 'completed' }));
        nodeStream.pipe(progressStream).pipe(tmpOutput);
      });
    }

    async function fetchAndAppend(itemIdx) {
      if (task.status === 'cancelled') return;
      const item = items[itemIdx];
      const safeName = sanitizeZipName(item.name) || `file_${itemIdx + 1}.${item.ext || 'bin'}`;
      const tmpPath = path.join(task.tmpDir, `${itemIdx}.part`);
      const fetchHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      };
      if (item.url.includes('erome.com')) {
        fetchHeaders['Referer'] = 'https://www.erome.com/';
      }
      const fetchUrl = item.url.startsWith('/') ? `${SERVER_BASE}${item.url}` : item.url;

      // Erros de rede no meio do download (ex.: undici 'terminated' quando o
      // host corta a conexão) são transientes: o item é baixado de novo até
      // MAX_ITEM_RETRIES vezes; só depois disso conta como item falho. O resto
      // da tarefa nunca é afetado.
      for (let attempt = 0; attempt <= MAX_ITEM_RETRIES; attempt++) {
        if (task.status !== 'processing') return;
        console.log(`[ZIP] Task ${taskId}: fetching [${itemIdx + 1}/${items.length}] ${item.name}`);
        try {
          const itemRes = await fetch(fetchUrl, { headers: fetchHeaders, signal: abortController.signal });
          if (!itemRes.ok) {
            console.warn(`[ZIP] Task ${taskId}: HTTP ${itemRes.status} for ${item.url}`);
            errors.push({ name: item.name, status: itemRes.status });
            break;
          }
          if (task.status !== 'processing') return;

          if (itemRes.body && typeof itemRes.body.getReader === 'function') {
            const result = await streamItemToDisk(itemRes.body, tmpPath);
            if (result.outcome === 'cancelled') {
              await removeZipFile(tmpPath);
              return;
            }
            if (result.outcome === 'error') {
              await removeZipFile(tmpPath);
              console.error(`[ZIP] Task ${taskId}: fetch error for ${item.name}: ${result.error?.message || 'download failed'} (attempt ${attempt + 1}/${MAX_ITEM_RETRIES + 1})`);
              if (attempt < MAX_ITEM_RETRIES) {
                await delay(500 * (attempt + 1));
                continue;
              }
              errors.push({ name: item.name, error: result.error?.message || 'download failed' });
              break;
            }
            archive.append(fs.createReadStream(tmpPath), { name: safeName });
            pendingTmp.push(tmpPath);
            console.log(`[ZIP] Task ${taskId}: appended ${item.name} (${(task.currentBytes / 1024 / 1024).toFixed(1)} MB total)`);
          } else {
            const buffer = Buffer.from(await itemRes.arrayBuffer());
            task.currentBytes += buffer.length;
            archive.append(buffer, { name: safeName });
            pendingTmp.push(null);
            console.log(`[ZIP] Task ${taskId}: appended ${item.name} (${(task.currentBytes / 1024 / 1024).toFixed(1)} MB total)`);
          }
          break;
        } catch (err) {
          if (err.name === 'AbortError') return;
          console.error(`[ZIP] Task ${taskId}: fetch error for ${item.name}: ${err.message} (attempt ${attempt + 1}/${MAX_ITEM_RETRIES + 1})`);
          if (attempt < MAX_ITEM_RETRIES) {
            await delay(500 * (attempt + 1));
            continue;
          }
          errors.push({ name: item.name, error: err.message });
          break;
        }
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

    if (task.status === 'processing') {
      try {
        await archive.finalize();
      } catch (err) {
        console.error(`[ZIP] Task ${taskId}: finalize error - ${err.message}`);
        await cleanupZipTask(task, { status: 'error', error: err.message, abort: true });
        return;
      }
      await cleanupZipTask(task, {
        status: 'completed',
        removeZip: false,
        destroyStreams: false,
        error: errors.length > 0 ? `${errors.length} file(s) failed to download` : null
      });
      console.log(`[ZIP] Task ${taskId}: completed (${items.length - errors.length}/${items.length} files)`);
    } else {
      await cleanupZipTask(task, { abort: true });
    }
  } catch (err) {
    console.error(`[ZIP] Task ${taskId}: fatal error - ${err.message}`);
    await cleanupZipTask(task, { status: 'error', error: err.message, abort: true });
  }
}
