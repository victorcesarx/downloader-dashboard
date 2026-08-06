import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import { Readable, Transform } from 'stream';
import { fileURLToPath } from 'url';
import { TEMP_DIR, ZIP_CONCURRENCY, PORT, ZIP_TASK_CONCURRENCY, ZIP_MAX_QUEUED_TASKS, ZIP_FETCH_TIMEOUT_MS, ZIP_MAX_TEMP_BYTES, ZIP_MAX_TOTAL_BYTES } from './config.js';
import { createZipTaskQueue } from './zip-queue.js';

const SERVER_BASE = `http://localhost:${PORT}`;
import { sanitizeZipName } from './utils.js';
import { isPrivateHost } from './middleware/ssrf.js';

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

// Tamanho total (bytes) de um diretório, calculado recursivamente — inclui os
// subdiretórios de itens ("<taskId>_items"). Retorna 0 se o diretório não
// existir ou não puder ser lido.
export async function getDirSizeBytes(dirPath) {
  let total = 0;
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      try {
        if (entry.isDirectory()) {
          total += await getDirSizeBytes(fullPath);
        } else {
          total += (await fs.promises.stat(fullPath)).size;
        }
      } catch (e) {}
    }
  } catch (e) {}
  return total;
}

// Resolve a URL de um item antes do fetch, bloqueando destinos não autorizados
// (proteção SSRF reutilizada de middleware/ssrf.js). URLs relativas são
// endpoints internos desta aplicação (ex.: /api/yt-download) e são sempre
// permitidas — apontam para SERVER_BASE, que nós controlamos. URLs absolutas
// só passam se forem http/https e o host não for privado/interno. Quando
// bloqueada, retorna erro para o item ser marcado como falho sem fetch.
async function resolveItemFetchUrl(itemUrl) {
  if (itemUrl.startsWith('/')) {
    return { url: `${SERVER_BASE}${itemUrl}` };
  }
  let parsed;
  try {
    parsed = new URL(itemUrl);
  } catch {
    return { error: `invalid URL: ${itemUrl}` };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { error: `blocked protocol: ${parsed.protocol}` };
  }
  const isPrivate = await isPrivateHost(parsed.hostname);
  if (isPrivate) {
    return { error: `blocked private network host: ${parsed.hostname}` };
  }
  return { url: parsed.href };
}

// Limite máximo de redirecionamentos seguidos manualmente por item.
const MAX_REDIRECTS = 5;

// Resolve e valida o destino de um redirect antes de segui-lo. O Location pode
// ser relativo e é resolvido contra a URL atual (new URL(location, base)).
// Aplica as mesmas regras da validação inicial: apenas http/https e host não
// privado (isPrivateHost). Retorna { url } ou { error }.
async function resolveRedirectUrl(location, currentUrl) {
  let next;
  try {
    next = new URL(location, currentUrl);
  } catch {
    return { error: `invalid redirect Location: ${location}` };
  }
  if (next.protocol !== 'http:' && next.protocol !== 'https:') {
    return { error: `blocked redirect protocol: ${next.protocol}` };
  }
  if (await isPrivateHost(next.hostname)) {
    return { error: `blocked redirect to private network host: ${next.hostname}` };
  }
  return { url: next.href };
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

export async function createZipTask(taskId, items, options = {}) {
  const existing = zipTasks.get(taskId);
  if (existing) return existing;

  const task = {
    taskId,
    status: 'queued',
    total: items.length,
    processed: 0,
    currentBytes: 0,
    totalBytes: 0,
    tempBytes: 0,
    speed: 0,
    clientIp: options.clientIp || null,
    startTime: Date.now(),
    enqueuedAt: Date.now(),
    finishedAt: null,
    error: null,
    // options.tempDir permite injetar um diretório temporário isolado em testes; em produção TEMP_DIR é usado.
    zipFilePath: path.join(options.tempDir || TEMP_DIR, `${taskId}.zip`),
    tmpDir: null,
    abortController: null,
    archive: null,
    output: null,
    _cleaned: false
  };

  zipTasks.set(taskId, task);
  return task;
}

export async function runZipTask(taskId, items, options = {}) {
  // A tarefa costuma já existir (criada com status 'queued' ao ser enfileirada);
  // se for chamada direta, cria e executa de imediato.
  const task = zipTasks.get(taskId) || await createZipTask(taskId, items, options);
  if (task._cleaned) return;

  // Timeout por tentativa de fetch (ZIP_FETCH_TIMEOUT_MS). options.fetchTimeoutMs
  // permite injetar valores curtos em testes; options.retryDelayMs faz o mesmo
  // para o backoff entre retries.
  const fetchTimeoutMs = options.fetchTimeoutMs ?? ZIP_FETCH_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? 500;
  // Limite global de disco para temp_zips (ZIP_MAX_TEMP_BYTES). options.maxTempBytes
  // injeta valores pequenos em testes.
  const maxTempBytes = options.maxTempBytes ?? ZIP_MAX_TEMP_BYTES;
  // Limite de tamanho total do pacote ZIP (ZIP_MAX_TOTAL_BYTES). options.maxTotalBytes
  // injeta valores pequenos em testes.
  const maxTotalBytes = options.maxTotalBytes ?? ZIP_MAX_TOTAL_BYTES;
  const baseTempDir = options.tempDir || TEMP_DIR;

  task.status = 'processing';
  task.startTime = Date.now();

  const abortController = new AbortController();
  task.abortController = abortController;

  // Antes de baixar qualquer coisa, confere o uso atual do diretório temporário.
  // Se o limite global já foi atingido, a tarefa é marcada como 'error' com o
  // código ZIP_TEMP_STORAGE_FULL e nada é gravado em disco.
  const tempDirUsage = await getDirSizeBytes(baseTempDir);
  task.tempBytes = tempDirUsage;
  if (tempDirUsage >= maxTempBytes) {
    console.error(`[ZIP] Task ${taskId}: temp storage full (${tempDirUsage} bytes >= ${maxTempBytes})`);
    await cleanupZipTask(task, { status: 'error', error: 'ZIP_TEMP_STORAGE_FULL', abort: true });
    return;
  }

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
          task.tempBytes += chunk.length;
          // Limite de tamanho total do pacote: o chunk atual empurraria o total
          // aceito além do limite. O item é interrompido e marcado como falho —
          // não é fatal para a tarefa, e o excesso não é creditado no total
          // (o item descartado não ocupa espaço no ZIP). Demais itens seguem.
          if (task.totalBytes + chunk.length > maxTotalBytes) {
            const err = new Error(`ZIP_SIZE_LIMIT_EXCEEDED: total size limit of ${maxTotalBytes} bytes exceeded`);
            err.code = 'ZIP_SIZE_LIMIT_EXCEEDED';
            callback(err);
            return;
          }
          task.totalBytes += chunk.length;
          // Limite global de disco: bytes gravados nos arquivos temporários.
          // Ao ultrapassar, o erro com o código próprio faz o stream ser
          // interrompido e a tarefa finalizada via cleanup.
          if (task.tempBytes > maxTempBytes) {
            const err = new Error(`ZIP_TEMP_STORAGE_FULL: temp storage limit of ${maxTempBytes} bytes exceeded`);
            err.code = 'ZIP_TEMP_STORAGE_FULL';
            callback(err);
            return;
          }
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
        const onProgressError = (err) => {
          tmpOutput.destroy();
          done({ outcome: 'error', error: err || failure });
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
      const resolved = await resolveItemFetchUrl(item.url);
      if (resolved.error) {
        console.error(`[ZIP] Task ${taskId}: skipping ${item.name}: ${resolved.error}`);
        errors.push({ name: item.name, error: resolved.error });
        completed++;
        task.processed = completed;
        return;
      }
      const fetchUrl = resolved.url;

      // Erros de rede no meio do download (ex.: undici 'terminated' quando o
      // host corta a conexão) são transientes: o item é baixado de novo até
      // MAX_ITEM_RETRIES vezes; só depois disso conta como item falho. O resto
      // da tarefa nunca é afetado.
      //
      // Cada tentativa tem um AbortController próprio: o sinal da tarefa e o
      // timeout (ZIP_FETCH_TIMEOUT_MS) abortam só o fetch daquela tentativa. Um timeout
      // derruba apenas aquela tentativa (o retry segue normal) e, esgotados os
      // retries, o item vira falho — a tarefa não é marcada como 'error'. O
      // cancelamento da tarefa, porém, tem prioridade: aborta o controller
      // local imediatamente e o fetch rejeita com AbortError com task.status ≠
      // 'processing', interrompendo o loop. O timer é sempre limpo no finally.
      for (let attempt = 0; attempt <= MAX_ITEM_RETRIES; attempt++) {
        if (task.status !== 'processing') return;
        console.log(`[ZIP] Task ${taskId}: fetching [${itemIdx + 1}/${items.length}] ${item.name}`);
        const attemptController = new AbortController();
        const onTaskAbort = () => attemptController.abort();
        abortController.signal.addEventListener('abort', onTaskAbort, { once: true });
        const timeoutTimer = setTimeout(() => attemptController.abort(), fetchTimeoutMs);
        try {
          // Redirects não são seguidos automaticamente (redirect: 'manual').
          // Seguimos o máximo de MAX_REDIRECTS, resolvendo URL relativa contra
          // a atual e revalidando cada destino (scheme http/https + host não
          // privado). Um redirect bloqueado marca o item como falho: sem fetch
          // ao destino, sem retry, demais itens seguem.
          let currentUrl = fetchUrl;
          let redirectCount = 0;
          let failed = false;
          let itemRes;
          while (true) {
            itemRes = await fetch(currentUrl, { headers: fetchHeaders, signal: attemptController.signal, redirect: 'manual' });
            if (!(itemRes.status >= 300 && itemRes.status < 400)) break;

            const location = itemRes.headers.get('location');
            if (!location) {
              console.warn(`[ZIP] Task ${taskId}: HTTP ${itemRes.status} without Location for ${item.name}`);
              errors.push({ name: item.name, status: itemRes.status, error: 'redirect without Location header' });
              failed = true;
              break;
            }
            if (redirectCount >= MAX_REDIRECTS) {
              console.error(`[ZIP] Task ${taskId}: too many redirects for ${item.name} (max ${MAX_REDIRECTS})`);
              errors.push({ name: item.name, error: `too many redirects (max ${MAX_REDIRECTS})` });
              failed = true;
              break;
            }
            const redirect = await resolveRedirectUrl(location, currentUrl);
            if (redirect.error) {
              console.error(`[ZIP] Task ${taskId}: blocked redirect for ${item.name}: ${redirect.error}`);
              errors.push({ name: item.name, error: redirect.error });
              failed = true;
              break;
            }
            currentUrl = redirect.url;
            redirectCount++;
            console.log(`[ZIP] Task ${taskId}: redirect ${redirectCount}/${MAX_REDIRECTS} for ${item.name} -> ${currentUrl}`);
          }
          if (failed) break;
          if (!itemRes.ok) {
            console.warn(`[ZIP] Task ${taskId}: HTTP ${itemRes.status} for ${item.url}`);
            errors.push({ name: item.name, status: itemRes.status });
            break;
          }
          if (task.status !== 'processing') return;

          // Limite de tamanho total do pacote: quando o servidor anuncia
          // Content-Length, conferimos antes de tocar no corpo. Se o anúncio já
          // estoura o limite restante, o item é marcado como falho sem baixar
          // nada; a falha é definitiva (o tamanho não muda num retry).
          const contentLength = Number(itemRes.headers?.get('content-length'));
          if (Number.isFinite(contentLength) && contentLength > 0 && contentLength > maxTotalBytes - task.totalBytes) {
            console.error(`[ZIP] Task ${taskId}: size limit exceeded for ${item.name} (Content-Length ${contentLength} bytes > remaining ${maxTotalBytes - task.totalBytes})`);
            try { await itemRes.body?.cancel(); } catch (e) {}
            errors.push({ name: item.name, error: 'ZIP_SIZE_LIMIT_EXCEEDED' });
            break;
          }

          if (itemRes.body && typeof itemRes.body.getReader === 'function') {
            const result = await streamItemToDisk(itemRes.body, tmpPath);
            if (result.outcome === 'cancelled') {
              await removeZipFile(tmpPath);
              return;
            }
            if (result.outcome === 'error') {
              await removeZipFile(tmpPath);
              // Estouro do limite global de disco é fatal para a tarefa: a
              // escrita já está interrompida e o cleanup idempotente remove os
              // arquivos .part e o ZIP parcial.
              if (result.error?.code === 'ZIP_TEMP_STORAGE_FULL') {
                await cleanupZipTask(task, { status: 'error', error: 'ZIP_TEMP_STORAGE_FULL', abort: true });
                return;
              }
              // Limite de tamanho total excedido durante o stream: o item falha
              // de forma definitiva (sem retry), mas a tarefa segue com os
              // demais itens e o ZIP finaliza com o que foi concluído.
              if (result.error?.code === 'ZIP_SIZE_LIMIT_EXCEEDED') {
                errors.push({ name: item.name, error: 'ZIP_SIZE_LIMIT_EXCEEDED' });
                break;
              }
              console.error(`[ZIP] Task ${taskId}: fetch error for ${item.name}: ${result.error?.message || 'download failed'} (attempt ${attempt + 1}/${MAX_ITEM_RETRIES + 1})`);
              if (attempt < MAX_ITEM_RETRIES) {
                await delay(retryDelayMs * (attempt + 1));
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
            // Corpo sem stream (fallback): o buffer empurraria o total aceito
            // além do limite; o item é descartado e falha sem ser anexado.
            if (task.totalBytes + buffer.length > maxTotalBytes) {
              errors.push({ name: item.name, error: 'ZIP_SIZE_LIMIT_EXCEEDED' });
              break;
            }
            task.totalBytes += buffer.length;
            archive.append(buffer, { name: safeName });
            pendingTmp.push(null);
            console.log(`[ZIP] Task ${taskId}: appended ${item.name} (${(task.currentBytes / 1024 / 1024).toFixed(1)} MB total)`);
          }
          break;
        } catch (err) {
          // AbortError vem do timeout da tentativa OU do cancelamento da tarefa
          // (o listener onTaskAbort aborta o controller local). Prioridade:
          // cancelamento encerra a tarefa; timeout só derruba essa tentativa.
          if (err.name === 'AbortError') {
            if (task.status !== 'processing') return;
            console.error(`[ZIP] Task ${taskId}: timeout for ${item.name}: no response after ${fetchTimeoutMs}ms (attempt ${attempt + 1}/${MAX_ITEM_RETRIES + 1})`);
            if (attempt < MAX_ITEM_RETRIES) {
              await delay(retryDelayMs * (attempt + 1));
              continue;
            }
            errors.push({ name: item.name, error: `request timed out (${fetchTimeoutMs}ms)` });
            break;
          }
          console.error(`[ZIP] Task ${taskId}: fetch error for ${item.name}: ${err.message} (attempt ${attempt + 1}/${MAX_ITEM_RETRIES + 1})`);
          if (attempt < MAX_ITEM_RETRIES) {
            await delay(retryDelayMs * (attempt + 1));
            continue;
          }
          errors.push({ name: item.name, error: err.message });
          break;
        } finally {
          clearTimeout(timeoutTimer);
          abortController.signal.removeEventListener('abort', onTaskAbort);
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
      // Para de bombear ao primeiro estado final (cancelled, error por limite
      // de disco, etc.). finishedAt só é setado pelo cleanup, que é idempotente.
      if (task.finishedAt !== null) break;
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

// Fila global de tarefas ZIP: serializa os builds (maxActiveTasks = 1 por
// padrão via ZIP_TASK_CONCURRENCY) e limita quantas tarefas podem aguardar.
// A transição queued -> processing é feita dentro de runZipTask, que é
// chamado pela fila assim que uma vaga fica disponível.
export const zipTaskQueue = createZipTaskQueue({
  maxActiveTasks: ZIP_TASK_CONCURRENCY,
  maxQueuedTasks: ZIP_MAX_QUEUED_TASKS,
  runTask: (entry) => runZipTask(entry.taskId, entry.items, entry.options),
});
