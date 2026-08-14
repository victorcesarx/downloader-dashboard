import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import dns from 'dns';

import { runZipTask, zipTasks, cleanupZipTask } from '../../server/zip.js';
import { resetGoFileSessionForTests } from '../../server/scrapers/gofile.js';

// Apenas a API pública de runZipTask é exercitada; o fetch global é mockado,
// o diretório temporário é isolado e nenhuma chamada de rede real acontece.

const originalCreateWriteStream = fs.createWriteStream;

let tempDir;
let outputClose;

let sequence = 0;
function makeTaskId() {
  sequence += 1;
  return `zip_test_${sequence}`;
}

// ---- Helpers ----------------------------------------------------------------

// Corpo de resposta dividido em vários chunks controlados.
function chunkedBody(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk));
      controller.close();
    }
  });
}

function okResponse(chunks = [Buffer.from('payload')]) {
  return new Response(chunkedBody(chunks), { status: 200 });
}

function slowActiveResponse(chunks, intervalMs) {
  return new Response(new ReadableStream({
    async start(controller) {
      for (const chunk of chunks) {
        await new Promise(resolve => setTimeout(resolve, intervalMs));
        controller.enqueue(new Uint8Array(chunk));
      }
      controller.close();
    }
  }), { status: 200 });
}

function errorResponse(status = 404) {
  return new Response(null, { status });
}

function jsonErrorResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Resposta 3xx com header Location (o fetch usa redirect: 'manual').
function redirectResponse(location, status = 302) {
  return new Response(null, { status, headers: { location } });
}

// Corpo que entrega alguns bytes e depois falha no meio do stream.
function erroringBody(message) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(Buffer.from('partial-payload')));
      controller.error(new Error(message));
    }
  });
}

async function waitFor(predicate, timeoutMs = 2000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

// Igual a runTask, mas não aguarda: permite observar o progresso e cancelar
// enquanto a tarefa ainda está em execução.
function startTask(items, responder, options = {}) {
  const fetchMock = vi.fn(async (url, fetchOptions = {}) => responder(String(url), fetchOptions));
  vi.stubGlobal('fetch', fetchMock);

  const taskId = makeTaskId();
  const promise = runZipTask(taskId, items, { tempDir, ...options });
  return { promise, taskId, task: zipTasks.get(taskId), fetchMock };
}

async function runTask(items, responder, options = {}) {
  const fetchMock = vi.fn(async (url, fetchOptions = {}) => responder(String(url), fetchOptions));
  vi.stubGlobal('fetch', fetchMock);

  const taskId = makeTaskId();
  await runZipTask(taskId, items, { tempDir, ...options });

  // runZipTask aguarda archive.finalize(), que resolve antes do write stream
  // do arquivo fechar; esperar 'close' torna a leitura do disco determinística.
  await Promise.all(outputClose);

  return { taskId, task: zipTasks.get(taskId), fetchMock };
}

// Responder que nunca responde até o sinal da tentativa disparar: simula um
// servidor mudo. A única forma do fetch terminar é o AbortError de timeOut ou
// de cancelamento — sem timers próprios pendentes no mock.
function hangBody(options = {}) {
  return new Promise((resolve, reject) => {
    const { signal } = options;
    if (signal && signal.aborted) {
      const err = new Error('aborted');
      err.name = 'AbortError';
      reject(err);
      return;
    }
    signal?.addEventListener('abort', () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      reject(err);
    }, { once: true });
  });
}

// Lê as entradas do ZIP gerado pela própria implementação (archiver):
// percorre o diretório central e descomprime cada entrada com zlib nativo.
function readZipEntries(zipPath) {
  const buf = fs.readFileSync(zipPath);
  const entries = [];
  let offset = 0;

  while (offset < buf.length - 4) {
    const sig = buf.readUInt32LE(offset);
    if (sig === 0x02014b50) {
      entries.push(readCentralEntry(buf, offset));
      const nameLen = buf.readUInt16LE(offset + 28);
      const extraLen = buf.readUInt16LE(offset + 30);
      const commentLen = buf.readUInt16LE(offset + 32);
      offset += 46 + nameLen + extraLen + commentLen;
    } else if (sig === 0x06054b50) {
      break; // fim do diretório central
    } else {
      offset += 1;
    }
  }
  return entries;
}

function readCentralEntry(buf, offset) {
  const method = buf.readUInt16LE(offset + 10);
  const compSize = buf.readUInt32LE(offset + 20);
  const nameLen = buf.readUInt16LE(offset + 28);
  const extraLen = buf.readUInt16LE(offset + 30);
  const commentLen = buf.readUInt16LE(offset + 32);
  const localOffset = buf.readUInt32LE(offset + 42);
  const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen);

  const lhNameLen = buf.readUInt16LE(localOffset + 26);
  const lhExtraLen = buf.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + lhNameLen + lhExtraLen;
  const compressed = buf.subarray(dataStart, dataStart + compSize);
  const content = method === 8 ? zlib.inflateRawSync(compressed) : Buffer.from(compressed);
  return { name, content };
}

// ---- Suíte ------------------------------------------------------------------

describe('runZipTask()', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webscope-zip-test-'));
    outputClose = [];
    vi.spyOn(fs, 'createWriteStream').mockImplementation((...args) => {
      const stream = originalCreateWriteStream(...args);
      outputClose.push(new Promise((resolve) => stream.once('close', resolve)));
      return stream;
    });
    // Sem consultas de DNS reais: hosts desconhecidos (ex.: cdn.example.com)
    // resolvem para um IP público. Endereços IPv6 mantêm o próprio endereço,
    // para a proteção SSRF continuar bloqueando [::1] etc.
    vi.spyOn(dns, 'lookup').mockImplementation((hostname, options, callback) => {
      const h = String(hostname).replace(/^\[|\]$/g, '');
      const isV6 = h.includes(':');
      const isLocal = h === 'localhost' || h === '127.0.0.1';
      const address = isV6 || isLocal ? (h === 'localhost' ? '127.0.0.1' : h) : '93.184.216.34';
      process.nextTick(() => callback(null, [{ address, family: isV6 ? 6 : 4 }]));
    });
  });

  afterEach(() => {
    for (const [id, t] of zipTasks.entries()) {
      if (t.zipFilePath && t.zipFilePath.startsWith(tempDir)) zipTasks.delete(id);
    }
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetGoFileSessionForTests();
  });

  it('completes with status "completed" for a single valid file', async () => {
    const { task } = await runTask(
      [{ name: 'single.txt', url: 'https://cdn.example.com/single.txt', ext: 'txt' }],
      () => okResponse([Buffer.from('hello single file')])
    );

    expect(task.status).toBe('completed');
    expect(task.error).toBeNull();
  });

  it('creates the ZIP file at the expected path', async () => {
    const { taskId, task } = await runTask(
      [{ name: 'a.txt', url: 'https://cdn.example.com/a.txt', ext: 'txt' }],
      () => okResponse([Buffer.from('payload')])
    );

    const zipPath = path.join(tempDir, `${taskId}.zip`);
    expect(task.zipFilePath).toBe(zipPath);
    expect(fs.existsSync(zipPath)).toBe(true);
    expect(fs.statSync(zipPath).size).toBeGreaterThan(0);
  });

  it('stores a sanitized entry name in the ZIP', async () => {
    const { taskId } = await runTask(
      [{ name: '..\\folder\\..secret..bin', url: 'https://cdn.example.com/f', ext: 'bin' }],
      () => okResponse([Buffer.from('secretdata')])
    );

    const entries = readZipEntries(path.join(tempDir, `${taskId}.zip`));
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('secretbin');
    expect(entries[0].name).not.toMatch(/\.\.|\\|\//);
    expect(Buffer.compare(entries[0].content, Buffer.from('secretdata'))).toBe(0);
  });

  it('preserves payload order when concurrent downloads finish out of order', async () => {
    const delays = { 'first.txt': 40, 'second.txt': 5, 'third.txt': 15 };
    const items = Object.keys(delays).map(name => ({
      name,
      url: `https://cdn.example.com/${name}`,
      ext: 'txt',
    }));
    const { taskId } = await runTask(items, async url => {
      const name = new URL(url).pathname.slice(1);
      await new Promise(resolve => setTimeout(resolve, delays[name]));
      return okResponse([Buffer.from(name)]);
    });

    const entries = readZipEntries(path.join(tempDir, `${taskId}.zip`));
    expect(entries.map(entry => entry.name)).toEqual(['first.txt', 'second.txt', 'third.txt']);
  });

  it('identifies Pixeldrain hotlink protection instead of exposing a generic 403', async () => {
    const { task, fetchMock } = await runTask(
      [{ name: 'blocked.bin', url: 'https://pixeldrain.com/api/file/blocked', ext: 'bin' }],
      () => jsonErrorResponse(403, { value: 'file_rate_limited_captcha_required' }),
    );

    expect(task.itemResults[0]).toMatchObject({
      outcome: 'failed',
      reason: 'PIXELDRAIN_HOTLINK_PROTECTION',
      httpStatus: 403,
    });
    expect(fetchMock.mock.calls[0][1].headers.Referer).toBe('https://pixeldrain.com/');
  });

  it('authenticates GoFile CDN downloads with the scraper session', async () => {
    const { taskId, task, fetchMock } = await runTask(
      [{ name: '01.jpg', url: 'https://store1.gofile.io/download/one', ext: 'jpg', source: 'gofile', mimeType: 'image/jpeg' }],
      (url) => url === 'https://api.gofile.io/accounts'
        ? new Response(JSON.stringify({ status: 'ok', data: { token: 'zip-token' } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        : new Response(chunkedBody([Buffer.from('real-image-bytes')]), { status: 200, headers: { 'Content-Type': 'image/jpeg' } }),
    );

    expect(task.itemResults[0].outcome).toBe('completed');
    const cdnCall = fetchMock.mock.calls.find(([url]) => String(url).includes('store1.gofile.io'));
    expect(cdnCall[1].headers.Cookie).toBe('accountToken=zip-token');
    expect(readZipEntries(path.join(tempDir, `${taskId}.zip`))[0].content.toString()).toBe('real-image-bytes');
  });

  it('does not archive a GoFile access payload returned with HTTP 200', async () => {
    const { taskId, task } = await runTask(
      [{ name: '01.jpg', url: 'https://store1.gofile.io/download/one', ext: 'jpg', source: 'gofile', mimeType: 'image/jpeg' }],
      (url) => url === 'https://api.gofile.io/accounts'
        ? new Response(JSON.stringify({ status: 'ok', data: { token: 'zip-token' } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        : new Response(JSON.stringify({ status: 'error-notAuthenticated' }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    expect(task.itemResults[0]).toMatchObject({ outcome: 'failed', reason: 'GOFILE_DOWNLOAD_ACCESS_DENIED' });
    expect(readZipEntries(path.join(tempDir, `${taskId}.zip`))).toHaveLength(0);
  });

  it('updates processed and total correctly', async () => {
    const { task } = await runTask(
      [
        { name: 'first.txt', url: 'https://cdn.example.com/first.txt', ext: 'txt' },
        { name: 'second.txt', url: 'https://cdn.example.com/second.txt', ext: 'txt' }
      ],
      () => okResponse([Buffer.from('aaaaaaaaaa')])
    );

    expect(task.status).toBe('completed');
    expect(task.total).toBe(2);
    expect(task.processed).toBe(2);
    expect(task.currentBytes).toBe(20);
  });

  it('processes the remaining items when one fails with a non-OK HTTP response', async () => {
    const { taskId, task } = await runTask(
      [
        { name: 'keep-a.txt', url: 'https://cdn.example.com/a', ext: 'txt' },
        { name: 'broken.txt', url: 'https://cdn.example.com/broken', ext: 'txt' },
        { name: 'keep-c.txt', url: 'https://cdn.example.com/c', ext: 'txt' }
      ],
      (url) => (url.includes('broken') ? errorResponse(404) : okResponse([Buffer.from('data')]))
    );

    expect(task.status).toBe('completed');
    expect(task.processed).toBe(3);

    const entries = readZipEntries(path.join(tempDir, `${taskId}.zip`));
    expect(entries.map((e) => e.name).sort()).toEqual(['keep-a.txt', 'keep-c.txt']);
  });

  it('reports how many items failed in the error summary', async () => {
    const { task } = await runTask(
      [
        { name: 'ok-a.txt', url: 'https://cdn.example.com/a', ext: 'txt' },
        { name: 'err-b.txt', url: 'https://cdn.example.com/err-b', ext: 'txt' },
        { name: 'err-c.txt', url: 'https://cdn.example.com/err-c', ext: 'txt' },
        { name: 'ok-d.txt', url: 'https://cdn.example.com/d', ext: 'txt' }
      ],
      (url) => (url.includes('err-') ? errorResponse(500) : okResponse([Buffer.from('data')]))
    );

    expect(task.status).toBe('completed');
    expect(task.processed).toBe(4);
    expect(task.error).toBe('2 file(s) failed to download');
  });

  it('falls back to a generated name when the item name is unusable', async () => {
    const { taskId } = await runTask(
      [{ name: '../../..', url: 'https://cdn.example.com/f', ext: 'txt' }],
      () => okResponse([Buffer.from('fallback')])
    );

    const entries = readZipEntries(path.join(tempDir, `${taskId}.zip`));
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('file_1.txt');
  });

  // Caracterização: resposta dividida em vários chunks deve aparecer integralmente
  // no ZIP. Observa apenas o resultado final (conteúdo da entrada), de modo que
  // continue válido após a futura migração para streaming.
  it('preserves every chunk of a chunked response in the final ZIP entry', async () => {
    const chunks = [
      Buffer.from('chunk-1: '),
      Buffer.from('chunk-2: '),
      Buffer.from('chunk-3: '),
      Buffer.from('END')
    ];
    const expected = Buffer.concat(chunks);

    const { taskId, fetchMock } = await runTask(
      [{ name: 'chunked.bin', url: 'https://cdn.example.com/chunked.bin', ext: 'bin' }],
      () => okResponse(chunks)
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const entries = readZipEntries(path.join(tempDir, `${taskId}.zip`));
    expect(entries).toHaveLength(1);
    expect(entries[0].content.length).toBe(expected.length);
    expect(Buffer.compare(entries[0].content, expected)).toBe(0);
  });

  // Regressão contra buffering completo: com streaming, nenhuma chamada a
  // Buffer.concat deve acontecer durante uma execução. As únicas chamadas
  // internas do archiver a Buffer.concat são para Zip64 e diretórios/symlinks
  // (Buffer.concat([])), que não ocorrem neste cenário.
  it('does not buffer the whole response: Buffer.concat is never used during a task run', async () => {
    const concatSpy = vi.spyOn(Buffer, 'concat');
    let taskId;
    try {
      const result = await runTask(
        [{ name: 'multi-chunk.bin', url: 'https://cdn.example.com/multi', ext: 'bin' }],
        () => okResponse([Buffer.from('aaaa'), Buffer.from('bbbb'), Buffer.from('cccc')])
      );
      taskId = result.taskId;
      expect(result.task.status).toBe('completed');
      expect(concatSpy).not.toHaveBeenCalled();
    } finally {
      concatSpy.mockRestore();
    }

    const entries = readZipEntries(path.join(tempDir, `${taskId}.zip`));
    expect(entries[0].content.toString()).toBe('aaaabbbbcccc');
  });

  // Prova comportamental de streaming: um corpo que chega devagar deve
  // incrementar currentBytes enquanto ainda está sendo consumido, antes de o
  // item ser contabilizado como processado. Com buffering completo, currentBytes
  // só refletiria o total após o download inteiro.
  it('increments currentBytes while the stream is being consumed, before the item is processed', async () => {
    const chunks = [Buffer.from('aaaaaaaaaa'), Buffer.from('bbbbbbbbbb'), Buffer.from('cccccccccc')];
    const total = 30;
    const slowBody = new ReadableStream({
      async start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new Uint8Array(chunk));
          await new Promise((r) => setTimeout(r, 40));
        }
        controller.close();
      }
    });

    const { promise, taskId, task } = startTask(
      [{ name: 'slow.bin', url: 'https://cdn.example.com/slow.bin', ext: 'bin' }],
      () => new Response(slowBody, { status: 200 })
    );

    await waitFor(() => task.currentBytes > 0 && task.currentBytes < total);
    expect(task.processed).toBe(0);
    expect(task.currentBytes).toBeLessThan(total);

    const mid = task.currentBytes;
    await waitFor(() => task.currentBytes > mid);
    expect(task.processed).toBe(0);

    await promise;
    await Promise.all(outputClose);
    expect(task.currentBytes).toBe(total);
    expect(task.processed).toBe(1);

    const entries = readZipEntries(path.join(tempDir, `${taskId}.zip`));
    expect(Buffer.compare(entries[0].content, Buffer.concat(chunks))).toBe(0);
  });

  // Cancelamento durante o consumo ativo de um stream: a tarefa deve terminar
  // como 'cancelled' e o ZIP parcial deve ser removido do disco.
  it('cancels while a stream is being consumed and removes the partial ZIP', async () => {
    const stalledBody = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(Buffer.from('partial-data')));
      }
    });

    const { promise, taskId, task, fetchMock } = startTask(
      [{ name: 'stall.bin', url: 'https://cdn.example.com/stall.bin', ext: 'bin' }],
      () => new Response(stalledBody, { status: 200 })
    );

    await waitFor(() => task.currentBytes > 0);
    expect(task.status).toBe('processing');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    task.status = 'cancelled';
    task.abortController.abort();
    await promise;
    await Promise.all(outputClose);

    expect(task.status).toBe('cancelled');
    expect(fs.existsSync(path.join(tempDir, `${taskId}.zip`))).toBe(false);
  });

  // Erro de rede no meio do stream (ex.: undici 'terminated'): o item é
  // tentado MAX_ITEM_RETRIES + 1 vezes e, se continuar falhando, conta como
  // item falho — a tarefa completa normalmente com os demais arquivos.
  it('skips a file that keeps failing mid-stream and completes the task', async () => {
    const { taskId, task, fetchMock } = await runTask(
      [{ name: 'boom.bin', url: 'https://cdn.example.com/boom.bin', ext: 'bin' }],
      () => new Response(erroringBody('terminated'), { status: 200 })
    );

    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 tentativa + 2 retries
    expect(task.status).toBe('completed');
    expect(task.error).toBe('1 file(s) failed to download');
    expect(task.itemResults).toEqual([
      expect.objectContaining({ name: 'boom.bin', outcome: 'failed', reason: 'terminated' })
    ]);
    expect(task.tmpDir).toBeDefined();
    expect(fs.existsSync(task.tmpDir)).toBe(false);
    expect(fs.existsSync(path.join(tempDir, `${taskId}.zip`))).toBe(true);
  });

  it('retries a file whose download failed mid-stream and includes the recovered data', async () => {
    let calls = 0;
    const { taskId, task } = await runTask(
      [{ name: 'flaky.bin', url: 'https://cdn.example.com/flaky.bin', ext: 'bin' }],
      () => {
        calls += 1;
        if (calls === 1) return new Response(erroringBody('terminated'), { status: 200 });
        return okResponse([Buffer.from('recovered-data')]);
      }
    );

    expect(calls).toBe(2);
    expect(task.status).toBe('completed');
    expect(task.error).toBeNull();

    const entries = readZipEntries(path.join(tempDir, `${taskId}.zip`));
    expect(entries).toHaveLength(1);
    expect(Buffer.compare(entries[0].content, Buffer.from('recovered-data'))).toBe(0);
    expect(fs.existsSync(task.tmpDir)).toBe(false);
  });

  // Cenário do usuário: um dos arquivos de um pacote grande falha no meio do
  // download; os demais itens devem continuar sendo processados normalmente.
  it('continues processing the remaining items after a mid-stream failure', async () => {
    const { taskId, task } = await runTask(
      [
        { name: 'ok1.txt', url: 'https://cdn.example.com/ok1.txt', ext: 'txt' },
        { name: 'boom.bin', url: 'https://cdn.example.com/boom.bin', ext: 'bin' },
        { name: 'ok2.txt', url: 'https://cdn.example.com/ok2.txt', ext: 'txt' }
      ],
      (url) => url.includes('boom.bin')
        ? new Response(erroringBody('terminated'), { status: 200 })
        : okResponse([Buffer.from('payload-ok')])
    );

    expect(task.status).toBe('completed');
    expect(task.error).toBe('1 file(s) failed to download');
    expect(task.processed).toBe(3);
    expect(task.itemResults.map(item => item.outcome)).toEqual(['completed', 'failed', 'completed']);

    const entries = readZipEntries(path.join(tempDir, `${taskId}.zip`));
    expect(entries.map((e) => e.name).sort()).toEqual(['ok1.txt', 'ok2.txt']);
    expect(fs.existsSync(task.tmpDir)).toBe(false);
  });

  it('does not overwrite a cancelled task with "error"', async () => {
    const filePath = path.join(tempDir, 'cancelled-keep.zip');
    fs.writeFileSync(filePath, 'partial');
    const task = {
      taskId: 'manual-cancelled',
      status: 'cancelled',
      finishedAt: null,
      error: null,
      zipFilePath: filePath,
      abortController: new AbortController(),
      archive: null,
      output: null,
      _cleaned: false
    };

    await cleanupZipTask(task, { status: 'error', error: 'archive exploded', abort: true });

    expect(task.status).toBe('cancelled');
    expect(task.finishedAt).not.toBeNull();
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('runs the same centralized cleanup when the write stream fails', async () => {
    fs.createWriteStream.mockImplementationOnce((...args) => {
      const stream = originalCreateWriteStream(...args);
      outputClose.push(new Promise((resolve) => stream.once('close', resolve)));
      process.nextTick(() => stream.emit('error', new Error('ENOSPC: no space left on device')));
      return stream;
    });

    const { taskId, task } = await runTask(
      [{ name: 'a.txt', url: 'https://cdn.example.com/a.txt', ext: 'txt' }],
      () => okResponse([Buffer.from('payload')])
    );

    expect(task.status).toBe('error');
    await waitFor(() => !fs.existsSync(path.join(tempDir, `${taskId}.zip`)));
    expect(fs.existsSync(path.join(tempDir, `${taskId}.zip`))).toBe(false);
  });

  it('calling cleanup twice does not throw and does not double-remove', async () => {
    const filePath = path.join(tempDir, 'twice.zip');
    fs.writeFileSync(filePath, 'data');
    const task = {
      taskId: 'manual-twice',
      status: 'processing',
      finishedAt: null,
      error: null,
      zipFilePath: filePath,
      abortController: new AbortController(),
      archive: null,
      output: null,
      _cleaned: false
    };

    await expect(cleanupZipTask(task, { status: 'error', error: 'first', abort: true })).resolves.toBeDefined();
    await expect(cleanupZipTask(task, { status: 'error', error: 'second', abort: true })).resolves.toBeDefined();

    expect(task.status).toBe('error');
    expect(task.error).toBe('first');
    expect(fs.existsSync(filePath)).toBe(false);
  });

  // Um erro de rede no meio do stream não vira erro da tarefa (o item é
  // apenas pulado); o status final permanece 'completed'.
  it('does not mark the task as errored when an item fails mid-stream', async () => {
    const { task } = await runTask(
      [{ name: 'boom.bin', url: 'https://cdn.example.com/boom.bin', ext: 'bin' }],
      () => new Response(erroringBody('connection reset'), { status: 200 })
    );

    expect(task.status).toBe('completed');
    expect(task.error).toBe('1 file(s) failed to download');
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(task.status).toBe('completed');
    expect(task.finishedAt).not.toBeNull();
  });

  // Em ZIPs grandes a limpeza pode destruir o write stream no meio de uma
  // escrita do archiver; o erro ERR_STREAM_DESTROYED ("Cannot call writev after
  // a stream was destroyed") é esperado nesse teardown e não deve virar falha.
  it('ignores ERR_STREAM_DESTROYED on the write stream during teardown', async () => {
    const stalledBody = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(Buffer.from('partial-data')));
      }
    });

    const { promise, taskId, task } = startTask(
      [{ name: 'stall.bin', url: 'https://cdn.example.com/stall.bin', ext: 'bin' }],
      () => new Response(stalledBody, { status: 200 })
    );

    await waitFor(() => task.currentBytes > 0);
    expect(task.status).toBe('processing');

    const teardownError = new Error('Cannot call writev after a stream was destroyed');
    teardownError.code = 'ERR_STREAM_DESTROYED';
    task.output.emit('error', teardownError);

    expect(task.status).toBe('processing');
    expect(task.finishedAt).toBeNull();

    task.status = 'cancelled';
    task.abortController.abort();
    await promise;
    await Promise.all(outputClose);

    expect(task.status).toBe('cancelled');
    expect(fs.existsSync(path.join(tempDir, `${taskId}.zip`))).toBe(false);
  });

  it('does not log a write stream error when the output is torn down mid-write', async () => {
    let streamTimer;
    const flowingBody = new ReadableStream({
      start(controller) {
        streamTimer = setInterval(() => {
          try { controller.enqueue(new Uint8Array(Buffer.alloc(64 * 1024, 0x61))); } catch {}
        }, 5);
      },
      cancel() {
        clearInterval(streamTimer);
      }
    });

    const errorSpy = vi.spyOn(console, 'error');
    const { promise, taskId, task } = startTask(
      [{ name: 'flow.bin', url: 'https://cdn.example.com/flow.bin', ext: 'bin' }],
      () => new Response(flowingBody, { status: 200 })
    );

    await waitFor(() => task.currentBytes > 0);
    await cleanupZipTask(task, { status: 'cancelled', abort: true });
    await promise;
    await Promise.all(outputClose);

    const teardownLogs = errorSpy.mock.calls.filter((args) =>
      String(args[0]).includes('write stream error') || String(args[0]).includes('writev')
    );
    expect(teardownLogs).toHaveLength(0);
    expect(task.status).toBe('cancelled');
    expect(fs.existsSync(path.join(tempDir, `${taskId}.zip`))).toBe(false);
  });

  // Timeout por tentativa: um servidor mudo (fetch que nunca responde) só
  // termina quando o sinal da tentativa dispara. O timeout aborta o controller
  // local; o fetch rejeita com AbortError e o retry segue normalmente.
  it('aborts a never-responding fetch by the per-attempt timeout', async () => {
    const { task, fetchMock } = await runTask(
      [{ name: 'hang.bin', url: 'https://cdn.example.com/hang.bin', ext: 'bin' }],
      (url, options) => hangBody(options),
      { fetchTimeoutMs: 40, retryDelayMs: 20 }
    );

    // O mock só se resolve via abort: cada uma das 3 tentativas (1 + 2 retries)
    // foi realmente abortada pelo timeout, nenhuma ficou pendurada.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(task.status).toBe('completed');
    expect(task.error).toBe('1 file(s) failed to download');
  });

  it('retries after a timed-out attempt and includes the recovered data on the next try', async () => {
    let calls = 0;
    const { taskId, task } = await runTask(
      [{ name: 'flaky-timeout.bin', url: 'https://cdn.example.com/flaky-timeout.bin', ext: 'bin' }],
      (url, options) => {
        calls += 1;
        if (calls === 1) return hangBody(options);
        return okResponse([Buffer.from('recovered-after-timeout')]);
      },
      { fetchTimeoutMs: 40, retryDelayMs: 20 }
    );

    expect(calls).toBe(2);
    expect(task.status).toBe('completed');
    expect(task.error).toBeNull();

    const entries = readZipEntries(path.join(tempDir, `${taskId}.zip`));
    expect(entries).toHaveLength(1);
    expect(Buffer.compare(entries[0].content, Buffer.from('recovered-after-timeout'))).toBe(0);
  });

  it('does not abort a long download while data continues to arrive', async () => {
    const chunks = [Buffer.from('one'), Buffer.from('two'), Buffer.from('three')];
    const { taskId, task, fetchMock } = await runTask(
      [{ name: 'slow.mp4', url: 'https://v.erome.com/slow.mp4', ext: 'mp4' }],
      () => slowActiveResponse(chunks, 25),
      { fetchTimeoutMs: 40, retryDelayMs: 5 }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      Referer: 'https://www.erome.com/',
      Origin: 'https://www.erome.com',
      'Accept-Encoding': 'identity',
    });
    expect(task.status).toBe('completed');
    expect(task.error).toBeNull();
    expect(readZipEntries(path.join(tempDir, `${taskId}.zip`))[0].content.toString()).toBe('onetwothree');
  });

  it('marks the item as failed after retries are exhausted, without erroring the whole task', async () => {
    const { taskId, task, fetchMock } = await runTask(
      [{ name: 'hang.bin', url: 'https://cdn.example.com/hang.bin', ext: 'bin' }],
      (url, options) => hangBody(options),
      { fetchTimeoutMs: 40, retryDelayMs: 20 }
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(task.status).toBe('completed');
    expect(task.processed).toBe(1);
    expect(task.error).toBe('1 file(s) failed to download');

    // O item falho não entra no ZIP, mas o ZIP é gerado mesmo assim.
    const entries = readZipEntries(path.join(tempDir, `${taskId}.zip`));
    expect(entries).toHaveLength(0);
    expect(fs.existsSync(path.join(tempDir, `${taskId}.zip`))).toBe(true);
    expect(fs.existsSync(task.tmpDir)).toBe(false);
  });

  it('keeps processing the remaining items while one times out forever', async () => {
    const { taskId, task, fetchMock } = await runTask(
      [
        { name: 'ok1.txt', url: 'https://cdn.example.com/ok1.txt', ext: 'txt' },
        { name: 'hang.bin', url: 'https://cdn.example.com/hang.bin', ext: 'bin' },
        { name: 'ok2.txt', url: 'https://cdn.example.com/ok2.txt', ext: 'txt' }
      ],
      (url, options) => url.includes('hang.bin') ? hangBody(options) : okResponse([Buffer.from('payload-ok')]),
      { fetchTimeoutMs: 40, retryDelayMs: 20 }
    );

    expect(task.status).toBe('completed');
    expect(task.error).toBe('1 file(s) failed to download');
    expect(task.processed).toBe(3);

    const entries = readZipEntries(path.join(tempDir, `${taskId}.zip`));
    expect(entries.map((e) => e.name).sort()).toEqual(['ok1.txt', 'ok2.txt']);
    expect(fetchMock).toHaveBeenCalledTimes(5); // 3 do hang + 2 dos itens ok
  });

  // Prioridade do cancelamento sobre o timeout: abortar a tarefa interrompe o
  // fetch imediatamente, sem esperar o timeout nem iniciar retries.
  it('gives task cancellation priority over the per-attempt timeout', async () => {
    const { promise, taskId, task, fetchMock } = startTask(
      [{ name: 'hang.bin', url: 'https://cdn.example.com/hang.bin', ext: 'bin' }],
      (url, options) => hangBody(options),
      { fetchTimeoutMs: 60_000, retryDelayMs: 20 }
    );

    await waitFor(() => fetchMock.mock.calls.length > 0);
    expect(task.status).toBe('processing');

    task.status = 'cancelled';
    task.abortController.abort();
    await promise;
    await Promise.all(outputClose);

    expect(task.status).toBe('cancelled');
    expect(fetchMock).toHaveBeenCalledTimes(1); // sem retry: o cancelamento venceu
    expect(fs.existsSync(path.join(tempDir, `${taskId}.zip`))).toBe(false);
  });

  // URLs bloqueadas pela proteção SSRF: o item é marcado como falho sem nunca
  // chamar fetch, sem retry, e o resto da tarefa segue normal.
  it('blocks a localhost URL without calling fetch', async () => {
    const { task, fetchMock } = await runTask(
      [{ name: 'local.txt', url: 'http://localhost:8080/secret', ext: 'txt' }],
      () => okResponse([Buffer.from('should-not-download')])
    );

    expect(task.status).toBe('completed');
    expect(task.error).toBe('1 file(s) failed to download');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks a private IPv4 URL', async () => {
    const { task, fetchMock } = await runTask(
      [{ name: 'priv4.txt', url: 'http://192.168.1.10/secret', ext: 'txt' }],
      () => okResponse([Buffer.from('should-not-download')])
    );

    expect(task.status).toBe('completed');
    expect(task.error).toBe('1 file(s) failed to download');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks a private IPv6 URL', async () => {
    const { task, fetchMock } = await runTask(
      [{ name: 'priv6.txt', url: 'http://[::1]/secret', ext: 'txt' }],
      () => okResponse([Buffer.from('should-not-download')])
    );

    expect(task.status).toBe('completed');
    expect(task.error).toBe('1 file(s) failed to download');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows a public URL and downloads it', async () => {
    const { taskId, task, fetchMock } = await runTask(
      [{ name: 'public.bin', url: 'http://93.184.216.34/file.bin', ext: 'bin' }],
      () => okResponse([Buffer.from('public-data')])
    );

    expect(task.status).toBe('completed');
    expect(task.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const entries = readZipEntries(path.join(tempDir, `${taskId}.zip`));
    expect(entries).toHaveLength(1);
    expect(Buffer.compare(entries[0].content, Buffer.from('public-data'))).toBe(0);
  });

  it('allows an internal relative URL and resolves it against the server base', async () => {
    const { taskId, task, fetchMock } = await runTask(
      [{ name: 'internal.bin', url: '/api/yt-download?q=1', ext: 'bin' }],
      () => okResponse([Buffer.from('internal-data')])
    );

    expect(task.status).toBe('completed');
    expect(task.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/localhost:\d+\/api\/yt-download\?q=1$/);

    const entries = readZipEntries(path.join(tempDir, `${taskId}.zip`));
    expect(entries).toHaveLength(1);
    expect(Buffer.compare(entries[0].content, Buffer.from('internal-data'))).toBe(0);
  });

  it('marks a blocked item as failed without executing fetch', async () => {
    const { task, fetchMock } = await runTask(
      [
        { name: 'ok.txt', url: 'http://93.184.216.34/ok.txt', ext: 'txt' },
        { name: 'blocked.txt', url: 'http://127.0.0.1/secret', ext: 'txt' }
      ],
      (url) => okResponse([Buffer.from('data')])
    );

    expect(task.status).toBe('completed');
    expect(task.error).toBe('1 file(s) failed to download');
    // fetch só foi chamado para o item permitido.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/ok.txt');
  });

  it('keeps processing the remaining items when one URL is blocked', async () => {
    const { taskId, task } = await runTask(
      [
        { name: 'ok1.txt', url: 'http://93.184.216.34/ok1.txt', ext: 'txt' },
        { name: 'blocked.txt', url: 'http://10.0.0.5/secret', ext: 'txt' },
        { name: 'ok2.txt', url: 'http://93.184.216.34/ok2.txt', ext: 'txt' }
      ],
      () => okResponse([Buffer.from('payload-ok')])
    );

    expect(task.status).toBe('completed');
    expect(task.error).toBe('1 file(s) failed to download');
    expect(task.processed).toBe(3);

    const entries = readZipEntries(path.join(tempDir, `${taskId}.zip`));
    expect(entries.map((e) => e.name).sort()).toEqual(['ok1.txt', 'ok2.txt']);
  });

  // Redirecionamentos são seguidos manualmente e cada destino é revalidado.
  it('follows a public-to-public redirect and downloads the final destination', async () => {
    const { taskId, task, fetchMock } = await runTask(
      [{ name: 'redir.bin', url: 'http://93.184.216.34/start.bin', ext: 'bin' }],
      (url) => {
        const u = String(url);
        if (u.includes('/start.bin')) return redirectResponse('http://93.184.216.34/final.bin', 302);
        return okResponse([Buffer.from('after-redirect')]);
      }
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(task.status).toBe('completed');
    expect(task.error).toBeNull();

    const entries = readZipEntries(path.join(tempDir, `${taskId}.zip`));
    expect(entries).toHaveLength(1);
    expect(Buffer.compare(entries[0].content, Buffer.from('after-redirect'))).toBe(0);
  });

  it('blocks a public redirect to localhost', async () => {
    const { task, fetchMock } = await runTask(
      [{ name: 'start.bin', url: 'http://93.184.216.34/start.bin', ext: 'bin' }],
      () => redirectResponse('http://localhost:8080/secret', 302)
    );

    expect(task.status).toBe('completed');
    expect(task.error).toBe('1 file(s) failed to download');
    expect(fetchMock).toHaveBeenCalledTimes(1); // só a chamada inicial
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('localhost');
  });

  it('blocks a public redirect to a private IPv4', async () => {
    const { task, fetchMock } = await runTask(
      [{ name: 'start.bin', url: 'http://93.184.216.34/start.bin', ext: 'bin' }],
      () => redirectResponse('http://192.168.1.10/secret', 302)
    );

    expect(task.status).toBe('completed');
    expect(task.error).toBe('1 file(s) failed to download');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('follows a relative redirect resolved against the current URL', async () => {
    const { taskId, task, fetchMock } = await runTask(
      [{ name: 'start.bin', url: 'http://93.184.216.34/a/start.bin', ext: 'bin' }],
      (url) => {
        const u = String(url);
        if (u.includes('/start.bin')) return redirectResponse('../final.bin', 301);
        return okResponse([Buffer.from('relative-ok')]);
      }
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toBe('http://93.184.216.34/final.bin');
    expect(task.status).toBe('completed');
    expect(task.error).toBeNull();

    const entries = readZipEntries(path.join(tempDir, `${taskId}.zip`));
    expect(Buffer.compare(entries[0].content, Buffer.from('relative-ok'))).toBe(0);
  });

  it('fails an item that redirects more than 5 times', async () => {
    const { task, fetchMock } = await runTask(
      [{ name: 'loop.bin', url: 'http://93.184.216.34/loop.bin', ext: 'bin' }],
      () => redirectResponse('/loop.bin', 302)
    );

    // 5 redirecionamentos são seguidos (6 fetches no total); o 6º 3xx derruba
    // o item antes de um novo fetch ao destino.
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(task.status).toBe('completed');
    expect(task.error).toBe('1 file(s) failed to download');
  });

  it('never calls the destination of a blocked redirect', async () => {
    let destinationCalls = 0;
    const { task, fetchMock } = await runTask(
      [{ name: 'start.bin', url: 'http://93.184.216.34/start.bin', ext: 'bin' }],
      (url) => {
        const u = String(url);
        if (u.includes('secret')) {
          destinationCalls += 1;
          return okResponse([Buffer.from('should-not-reach')]);
        }
        return redirectResponse('http://127.0.0.1/secret', 302);
      }
    );

    expect(destinationCalls).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(task.status).toBe('completed');
    expect(task.error).toBe('1 file(s) failed to download');
  });

  it('keeps processing the remaining items when a redirect is blocked', async () => {
    const { taskId, task } = await runTask(
      [
        { name: 'ok1.txt', url: 'http://93.184.216.34/ok1.txt', ext: 'txt' },
        { name: 'evil.bin', url: 'http://93.184.216.34/evil.bin', ext: 'bin' },
        { name: 'ok2.txt', url: 'http://93.184.216.34/ok2.txt', ext: 'txt' }
      ],
      (url) => {
        const u = String(url);
        if (u.includes('evil.bin')) return redirectResponse('http://localhost/secret', 302);
        return okResponse([Buffer.from('payload-ok')]);
      }
    );

    expect(task.status).toBe('completed');
    expect(task.error).toBe('1 file(s) failed to download');
    expect(task.processed).toBe(3);

    const entries = readZipEntries(path.join(tempDir, `${taskId}.zip`));
    expect(entries.map((e) => e.name).sort()).toEqual(['ok1.txt', 'ok2.txt']);
  });

  // Limite global de armazenamento temporário (temp_zips).
  it('starts a task normally when the temp dir is below the limit', async () => {
    const { task } = await runTask(
      [{ name: 'a.bin', url: 'http://93.184.216.34/a.bin', ext: 'bin' }],
      () => okResponse([Buffer.from('data')]),
      { maxTempBytes: 1024 * 1024 }
    );

    expect(task.status).toBe('completed');
    expect(task.error).toBeNull();
  });

  it('blocks a task when the temp dir already reached the limit', async () => {
    // Diretório temporário já cheio: arquivo existente empurra o uso acima do limite.
    fs.writeFileSync(path.join(tempDir, 'junk.bin'), Buffer.alloc(2 * 1024));

    const { taskId, task, fetchMock } = await runTask(
      [{ name: 'a.bin', url: 'http://93.184.216.34/a.bin', ext: 'bin' }],
      () => okResponse([Buffer.from('data')]),
      { maxTempBytes: 1024 }
    );

    expect(task.status).toBe('error');
    expect(task.error).toBe('ZIP_TEMP_STORAGE_FULL');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(tempDir, `${taskId}.zip`))).toBe(false);
  });

  it('interrupts the task when the temp limit is exceeded during download', async () => {
    const body = new ReadableStream({
      async start(controller) {
        for (let i = 0; i < 3; i++) {
          controller.enqueue(new Uint8Array(Buffer.from('x'.repeat(2048))));
          await new Promise((r) => setTimeout(r, 5));
        }
        controller.close();
      }
    });

    const { taskId, task, fetchMock } = await runTask(
      [{ name: 'big.bin', url: 'http://93.184.216.34/big.bin', ext: 'bin' }],
      () => new Response(body, { status: 200 }),
      { maxTempBytes: 3000 }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1); // sem retry
    expect(task.status).toBe('error');
    expect(task.error).toBe('ZIP_TEMP_STORAGE_FULL');
    expect(task.finishedAt).not.toBeNull();
  });

  it('removes partial .part files and the partial ZIP after a temp-limit failure', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(Buffer.from('x'.repeat(4096))));
      }
    });

    const { task } = await runTask(
      [{ name: 'big.bin', url: 'http://93.184.216.34/big.bin', ext: 'bin' }],
      () => new Response(body, { status: 200 }),
      { maxTempBytes: 2000 }
    );

    expect(task.status).toBe('error');
    const leftovers = fs.readdirSync(tempDir).filter((f) => f.includes('.part') || f.endsWith('.zip'));
    expect(leftovers).toEqual([]);
  });

  it('does not leak the temp storage counter across tasks', async () => {
    // 1ª tarefa estoura o limite; o cleanup remove os próprios arquivos.
    const first = await runTask(
      [{ name: 'big.bin', url: 'http://93.184.216.34/big.bin', ext: 'bin' }],
      () => okResponse([Buffer.from('x'.repeat(4096))]),
      { maxTempBytes: 1000 }
    );
    expect(first.task.status).toBe('error');
    expect(first.task.error).toBe('ZIP_TEMP_STORAGE_FULL');

    // 2ª tarefa, mesmo diretório: a baseline é recalculada do disco (limpo),
    // então o contador inconsistente de outra tarefa não a afeta.
    const second = await runTask(
      [{ name: 'ok.bin', url: 'http://93.184.216.34/ok.bin', ext: 'bin' }],
      () => okResponse([Buffer.from('data')]),
      { maxTempBytes: 5000 }
    );
    expect(second.task.status).toBe('completed');
    expect(second.task.error).toBeNull();
  });

  // Limite de tamanho total do pacote ZIP (ZIP_MAX_TOTAL_BYTES). Diferente do
  // limite de armazenamento temporário (fatal para a tarefa), o item que
  // estoura é marcado como falho e os demais seguem normalmente.
  it('completes a task whose total stays below the total size limit', async () => {
    const { task } = await runTask(
      [
        { name: 'small-a.txt', url: 'https://cdn.example.com/a.txt', ext: 'txt' },
        { name: 'small-b.txt', url: 'https://cdn.example.com/b.txt', ext: 'txt' }
      ],
      () => okResponse([Buffer.from('hello')]),
      { maxTotalBytes: 1024 * 1024 }
    );

    expect(task.status).toBe('completed');
    expect(task.error).toBeNull();
    expect(task.totalBytes).toBe(10);
  });

  it('blocks an item before streaming when Content-Length exceeds the remaining total limit', async () => {
    let pullCount = 0;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(Buffer.from('huge-body')));
      },
      pull() {
        pullCount += 1;
      }
    });

    const { taskId, task, fetchMock } = await runTask(
      [{ name: 'huge.bin', url: 'https://cdn.example.com/huge.bin', ext: 'bin' }],
      () => new Response(body, { status: 200, headers: { 'content-length': '8192' } }),
      { maxTotalBytes: 1000 }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(pullCount).toBe(0); // corpo nunca foi consumido
    expect(task.totalBytes).toBe(0);
    expect(task.status).toBe('completed');
    expect(task.error).toBe('1 file(s) failed to download');

    const leftovers = fs.readdirSync(tempDir).filter((f) => f.includes('.part'));
    expect(leftovers).toEqual([]);
    expect(readZipEntries(path.join(tempDir, `${taskId}.zip`))).toHaveLength(0);
  });

  it('stops a streaming item without Content-Length once the total limit is exceeded', async () => {
    const body = new ReadableStream({
      async start(controller) {
        for (let i = 0; i < 3; i++) {
          controller.enqueue(new Uint8Array(Buffer.from('x'.repeat(1024))));
          await new Promise((r) => setTimeout(r, 5));
        }
        controller.close();
      }
    });

    const { taskId, task, fetchMock } = await runTask(
      [{ name: 'big.bin', url: 'https://cdn.example.com/big.bin', ext: 'bin' }],
      () => new Response(body, { status: 200 }),
      { maxTotalBytes: 2500, maxTempBytes: 1024 * 1024 }
    );

    expect(task.status).toBe('completed');
    expect(task.error).toBe('1 file(s) failed to download');
    expect(task.finishedAt).not.toBeNull();

    const leftovers = fs.readdirSync(tempDir).filter((f) => f.includes('.part'));
    expect(leftovers).toEqual([]);
    expect(readZipEntries(path.join(tempDir, `${taskId}.zip`))).toHaveLength(0);
  });

  it('does not retry an item rejected by the total size limit', async () => {
    // Erros de rede no meio do stream normalmente disparam retry; o estouro
    // do limite de tamanho é definitivo e deve falhar em uma única tentativa.
    const { task, fetchMock } = await runTask(
      [{ name: 'big.bin', url: 'https://cdn.example.com/big.bin', ext: 'bin' }],
      () => okResponse([Buffer.from('x'.repeat(4096))]),
      { maxTotalBytes: 1000 }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(task.status).toBe('completed');
    expect(task.error).toBe('1 file(s) failed to download');
  });

  it('keeps processing the remaining items after a size-limit failure', async () => {
    const { taskId, task } = await runTask(
      [
        { name: 'ok1.txt', url: 'https://cdn.example.com/ok1.txt', ext: 'txt' },
        { name: 'big.bin', url: 'https://cdn.example.com/big.bin', ext: 'bin' },
        { name: 'ok2.txt', url: 'https://cdn.example.com/ok2.txt', ext: 'txt' }
      ],
      (url) => url.includes('big.bin')
        ? okResponse([Buffer.from('x'.repeat(4096))])
        : okResponse([Buffer.from('payload-ok')]),
      { maxTotalBytes: 3000 }
    );

    expect(task.status).toBe('completed');
    expect(task.error).toBe('1 file(s) failed to download');
    expect(task.processed).toBe(3);

    const entries = readZipEntries(path.join(tempDir, `${taskId}.zip`));
    expect(entries.map((e) => e.name).sort()).toEqual(['ok1.txt', 'ok2.txt']);
    expect(fs.existsSync(task.tmpDir)).toBe(false);
  });

  it('reports the size-limit failure in the task error summary', async () => {
    const { taskId, task } = await runTask(
      [
        { name: 'keep.txt', url: 'https://cdn.example.com/keep.txt', ext: 'txt' },
        { name: 'big.bin', url: 'https://cdn.example.com/big.bin', ext: 'bin' }
      ],
      (url) => url.includes('big.bin')
        ? okResponse([Buffer.from('x'.repeat(4096))])
        : okResponse([Buffer.from('payload')]),
      { maxTotalBytes: 1000 }
    );

    expect(task.status).toBe('completed');
    expect(task.error).toBe('1 file(s) failed to download');
    expect(fs.existsSync(path.join(tempDir, `${taskId}.zip`))).toBe(true);

    const entries = readZipEntries(path.join(tempDir, `${taskId}.zip`));
    expect(entries.map((e) => e.name)).toEqual(['keep.txt']);
  });
});
