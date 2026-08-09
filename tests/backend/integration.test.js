import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import dns from 'dns';
import { Readable } from 'stream';
import { server, zipTasks, zipTaskQueue } from '../../server.js';
import { ZIP_MAX_ITEMS } from '../../server/config.js';

let baseUrl;
let zipTempDir = null;

function request(method, path, body = null, opts = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: server.address().port,
      path,
      method,
      headers: { 'Content-Type': 'application/json', ...opts.headers },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function waitFor(predicate, timeoutMs = 3000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timeout');
    await new Promise((r) => setTimeout(r, 5));
  }
}

// Registra uma tarefa 'completed' com um arquivo ZIP real no disco.
function seedZipTask(sizeBytes = 8 * 1024 * 1024) {
  zipTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webscope-result-test-'));
  const taskId = `zip_it_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  const zipFilePath = path.join(zipTempDir, `${taskId}.zip`);
  fs.writeFileSync(zipFilePath, Buffer.alloc(sizeBytes, 0x41));
  zipTasks.set(taskId, {
    taskId,
    status: 'completed',
    processed: 1,
    total: 1,
    currentBytes: sizeBytes,
    speed: 0,
    startTime: Date.now(),
    finishedAt: Date.now(),
    error: null,
    zipFilePath,
    abortController: null
  });
  return { taskId, zipFilePath };
}

// Inicia a requisição e resolve quando os headers chegam; não aguarda o corpo.
function startResultRequest(taskId) {
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: 'localhost', port: server.address().port, path: `/download-zip/result/${taskId}`, method: 'GET' },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => {});
        resolve({ req, res });
      }
    );
    req.on('error', () => resolve({ req, res: null }));
    req.end();
  });
}

beforeAll(() => {
  return new Promise((resolve) => {
    server.listen(0, resolve);
  });
});

afterAll(() => {
  return new Promise((resolve) => {
    server.close(resolve);
  });
});

describe('Static file serving', () => {
  it('serves index.html on GET /', async () => {
    const res = await request('GET', '/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('WebScope');
  });

  it('serves main.css with correct content-type', async () => {
    const res = await request('GET', '/styles/main.css');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/css/);
    expect(res.body).toContain('WebScope');
  });

  it('serves JS files with correct content-type', async () => {
    const res = await request('GET', '/scripts/app.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/javascript/);
  });

  it('serves locale JSON files', async () => {
    const res = await request('GET', '/locales/pt-BR.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    const json = JSON.parse(res.body);
    expect(json.app).toBeDefined();
    expect(json.app.title).toContain('WebScope');
  });

  it('returns 404 for unknown files', async () => {
    const res = await request('GET', '/nonexistent.js');
    expect(res.status).toBe(404);
  });
});

describe('CORS headers', () => {
  it('includes Access-Control-Allow-Origin on all responses', async () => {
    const res = await request('GET', '/');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('responds to OPTIONS preflight', async () => {
    const res = await request('OPTIONS', '/');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});

describe('Cache headers', () => {
  it('sets no-cache for HTML', async () => {
    const res = await request('GET', '/');
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('sets cache for CSS', async () => {
    const res = await request('GET', '/styles/main.css');
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('sets cache for images', async () => {
    const res = await request('GET', '/favicon.ico');
    if (res.status === 200) {
      expect(res.headers['cache-control']).toBe('max-age=86400');
    }
  });
});

describe('Gzip compression', () => {
  it('compresses text responses when client supports gzip', async () => {
    const res = await request('GET', '/', null, {
      headers: { 'Accept-Encoding': 'gzip' },
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBe('gzip');
  });

  it('does not compress when client does not send accept-encoding', async () => {
    const res = await request('GET', '/');
    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBeUndefined();
  });
});

describe('POST /analyze', () => {
  it('returns 400 when URL is missing', async () => {
    const res = await request('POST', '/analyze', {});
    expect(res.status).toBe(400);
    const json = JSON.parse(res.body);
    expect(json.error).toBe('URL is required');
  });

  it('returns 400 for empty URL', async () => {
    const res = await request('POST', '/analyze', { url: '' });
    expect(res.status).toBe(400);
  });
});

describe('POST /analyze (static somente)', () => {
  function stubFetch(html) {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => html,
    })));
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('funciona somente com análise estática', async () => {
    stubFetch('<html><head><title>Static</title></head><body><img src="https://cdn.example.com/static.jpg"></body></html>');

    const res = await request('POST', '/analyze', { url: 'https://example.com/page' });

    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.items).toHaveLength(1);
    expect(json.items[0].url).toBe('https://cdn.example.com/static.jpg');
    expect(json.warnings).toBeUndefined();
  });

  it('ignora o campo mode e não inicia navegador', async () => {
    stubFetch('<html><head><title>Static</title></head><body><img src="https://cdn.example.com/static.jpg"></body></html>');

    const res = await request('POST', '/analyze', { url: 'https://example.com/page', mode: 'auto' });

    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.items).toHaveLength(1);
    expect(json.items[0].url).toBe('https://cdn.example.com/static.jpg');
    expect(json.warnings).toBeUndefined();
    expect(json.diagnostics).toBeUndefined();
  });

  it('resultados estáticos continuam iguais', async () => {
    stubFetch('<html><head><title>Static</title></head><body>'
      + '<meta property="og:video" content="https://cdn.example.com/movie.mp4">'
      + '<img src="https://cdn.example.com/static.jpg">'
      + '</body></html>');

    const res = await request('POST', '/analyze', { url: 'https://example.com/page' });

    const json = JSON.parse(res.body);
    expect(json.title).toBe('Static');
    expect(json.items.map(i => i.url)).toEqual([
      'https://cdn.example.com/movie.mp4',
      'https://cdn.example.com/static.jpg',
    ]);
  });

  it('HLS e DASH presentes no HTML continuam detectados', async () => {
    stubFetch('<html><head><title>Mídias</title></head><body>'
      + '<video src="https://example.com/movie.mp4"></video>'
      + '<video src="https://cdn.example.com/live.m3u8"></video>'
      + '<video src="/manifest.mpd"></video>'
      + '</body></html>');

    const res = await request('POST', '/analyze', { url: 'https://example.com/page' });

    const json = JSON.parse(res.body);
    const items = json.items.map(i => ({ url: i.url, delivery: i.delivery }));
    expect(items).toContainEqual({ url: 'https://example.com/movie.mp4', delivery: 'progressive' });
    expect(items).toContainEqual({ url: 'https://cdn.example.com/live.m3u8', delivery: 'hls' });
    expect(items).toContainEqual({ url: 'https://example.com/manifest.mpd', delivery: 'dash' });
  });
});



describe('GET /proxy', () => {
  it('returns 400 when URL parameter is missing', async () => {
    const res = await request('GET', '/proxy');
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid URL protocol', async () => {
    const res = await request('GET', '/proxy?url=ftp://example.com');
    expect(res.status).toBe(400);
    const json = JSON.parse(res.body);
    expect(json.error).toMatch(/URL/i);
  });
});

describe('POST /download-zip', () => {
  it('returns 400 when no items provided', async () => {
    const res = await request('POST', '/download-zip', {});
    expect(res.status).toBe(400);
  });
});

describe('POST /download-zip queue integration', () => {
  // Controle da fila ZIP sem downloads reais: o fetch global é substituído por
  // uma função que devolve promessas que só resolvem quando nós liberamos.
  let gates;
  let createdIds;

  function installFetchGate() {
    gates = [];
    const gateMock = vi.fn(() => new Promise((resolve) => gates.push(resolve)));
    vi.stubGlobal('fetch', gateMock);
    return gateMock;
  }

  function gateBody() {
    return {
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('zip-control-data'));
          controller.close();
        },
      }),
    };
  }

  function releaseFirst() {
    const resolve = gates.shift();
    if (resolve) resolve(gateBody());
  }

  function releaseAll() {
    while (gates.length) {
      const resolve = gates.shift();
      try { resolve(gateBody()); } catch {}
    }
  }

  const zipItem = {
    name: 'media.bin',
    type: 'document',
    url: 'https://files.example.test/file.bin',
    ext: 'bin',
    size: 10,
  };

  function cleanupCreatedTasks() {
    for (const id of createdIds) {
      const task = zipTasks.get(id);
      if (task) {
        try { if (task.zipFilePath && fs.existsSync(task.zipFilePath)) fs.rmSync(task.zipFilePath, { force: true }); } catch {}
        try { if (task.tmpDir && fs.existsSync(task.tmpDir)) fs.rmSync(task.tmpDir, { recursive: true, force: true }); } catch {}
      }
      zipTasks.delete(id);
    }
    createdIds = [];
  }

  beforeEach(() => {
    createdIds = [];
    installFetchGate();
    // Resolve hosts sintéticos (files.example.test) para um IP público sem DNS
    // real, mantendo endereços IPv6 intactos para a validação SSRF.
    vi.spyOn(dns, 'lookup').mockImplementation((hostname, options, callback) => {
      const h = String(hostname).replace(/^\[|\]$/g, '');
      const isV6 = h.includes(':');
      const address = isV6 ? h : '93.184.216.34';
      process.nextTick(() => callback(null, [{ address, family: isV6 ? 6 : 4 }]));
    });
  });

  afterEach(async () => {
    // Drena a fila até ficar vazia de verdade. Antes só checava tarefas em
    // 'processing', deixando passar a janela em que a ativa finalizava mas o
    // pump ainda não tinha iniciado a próxima (status 'queued'): a tarefa
    // órfã iniciaria depois, já com fetch real restaurado, e ocuparia para
    // sempre a única vaga global — derrubando os testes seguintes.
    for (let i = 0; i < 600; i++) {
      releaseAll();
      if (zipTaskQueue.activeCount === 0 && zipTaskQueue.waitingCount === 0) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    cleanupCreatedTasks();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function postZip(items = [zipItem]) {
    const res = await request('POST', '/download-zip', { items });
    createdIds.push(JSON.parse(res.body).taskId);
    return JSON.parse(res.body).taskId;
  }

  // Cria uma tarefa simulando um cliente com IP próprio (X-Forwarded-For).
  // Retorna o taskId, ou null quando a rota recusa (ex.: 429 por IP).
  async function postZipWithIp(ip, items = [zipItem]) {
    const res = await request('POST', '/download-zip', { items }, { headers: { 'X-Forwarded-For': ip } });
    const body = JSON.parse(res.body);
    if (body.taskId) createdIds.push(body.taskId);
    return body.taskId || null;
  }

  function buildItems(n) {
    return Array.from({ length: n }, (_, i) => ({
      name: `file${i}.bin`,
      type: 'document',
      url: `https://files.example.test/file${i}.bin`,
      ext: 'bin',
      size: 10,
    }));
  }

  it('a primeira tarefa entra em processing imediatamente', async () => {
    const taskId = await postZip();

    await waitFor(() => zipTasks.get(taskId)?.status === 'processing');
    await waitFor(() => gates.length > 0);

    releaseAll();
    await waitFor(() => zipTasks.get(taskId)?.itemResults?.[0]?.outcome === 'completed', 7000);
  });

  it('tarefa excedente fica em queued enquanto a ativa não termina', async () => {
    const activeId = await postZip();
    await waitFor(() => zipTasks.get(activeId)?.status === 'processing');
    await waitFor(() => gates.length > 0);

    const queuedId = await postZip();
    expect(zipTasks.get(queuedId).status).toBe('queued');
    expect(zipTasks.get(activeId).status).toBe('processing');

    releaseAll();
    await waitFor(() => zipTasks.get(activeId)?.status === 'completed');
  });

  it('quando a ativa termina, a próxima passa a processing', async () => {
    const firstId = await postZip();
    await waitFor(() => zipTasks.get(firstId)?.status === 'processing');
    await waitFor(() => gates.length > 0);

    const secondId = await postZip();
    expect(zipTasks.get(secondId).status).toBe('queued');

    // Libera a primeira: ela conclui e a fila inicia o segundo download.
    releaseFirst();
    await waitFor(() => zipTasks.get(secondId)?.status === 'processing');
  });

  it('rota de cancelamento marca tarefa queued como cancelled', async () => {
    const activeId = await postZip();
    await waitFor(() => zipTasks.get(activeId)?.status === 'processing');
    await waitFor(() => gates.length > 0);

    const queuedId = await postZip();
    expect(zipTasks.get(queuedId).status).toBe('queued');

    const res = await request('GET', `/download-zip/cancel/${queuedId}`);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).cancelled).toBe(true);

    const cancelledTask = zipTasks.get(queuedId);
    expect(cancelledTask.status).toBe('cancelled');
    expect(cancelledTask.finishedAt).not.toBeNull();
    expect(fs.existsSync(cancelledTask.zipFilePath)).toBe(false);

    // Mesmo que a ativa termine, a tarefa cancelada nunca entra em processing.
    releaseAll();
    await waitFor(() => zipTasks.get(activeId)?.status === 'completed');
    await new Promise((r) => setTimeout(r, 50));
    expect(zipTasks.get(queuedId)?.status).toBe('cancelled');
  });

  it('endpoint de status retorna queuePosition', async () => {
    const activeId = await postZip();
    await waitFor(() => zipTasks.get(activeId)?.status === 'processing');

    const queuedId = await postZip();

    let res = await request('GET', `/download-zip/status/${activeId}`);
    expect(JSON.parse(res.body).queuePosition).toBe(0);

    res = await request('GET', `/download-zip/status/${queuedId}`);
    expect(JSON.parse(res.body).queuePosition).toBe(1);

    await request('GET', `/download-zip/cancel/${queuedId}`);
    res = await request('GET', `/download-zip/status/${queuedId}`);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('cancelled');
    expect(body.queuePosition).toBeNull();
  });

  it('endpoint de status expõe resultados concluídos e ignorados por arquivo', async () => {
    const taskId = `zip_report_${Date.now()}`;
    zipTasks.set(taskId, {
      taskId, status: 'completed', processed: 1, total: 1, currentBytes: 10, speed: 0, error: null,
      itemResults: [{ index: 0, name: 'media.bin', ext: 'bin', outcome: 'completed', reason: null, httpStatus: null }],
      ignoredResults: [{ index: 0, name: 'stream.m3u8', ext: 'm3u8', outcome: 'ignored', reason: 'unsupported hls', httpStatus: null }],
    });
    createdIds.push(taskId);

    const status = await request('GET', `/download-zip/status/${taskId}`);
    expect(JSON.parse(status.body).report).toEqual([
      expect.objectContaining({ name: 'media.bin', outcome: 'completed', reason: null }),
      expect.objectContaining({ name: 'stream.m3u8', outcome: 'ignored', reason: 'unsupported hls' }),
    ]);
  });

  it('retry cria uma nova tarefa contendo somente os arquivos que falharam', async () => {
    const sourceId = `zip_source_${Date.now()}`;
    zipTasks.set(sourceId, {
      taskId: sourceId,
      status: 'completed',
      clientIp: null,
      itemResults: [
        { outcome: 'completed', item: { name: 'ok.bin', url: 'https://files.example.test/ok.bin', ext: 'bin' } },
        { outcome: 'failed', item: { name: 'failed.bin', url: 'https://files.example.test/failed.bin', ext: 'bin' } },
      ],
    });
    createdIds.push(sourceId);

    const res = await request('POST', `/download-zip/retry/${sourceId}`, {});
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    createdIds.push(body.taskId);
    expect(body).toMatchObject({ total: 1, retryOf: sourceId });
    expect(zipTasks.get(body.taskId)).toMatchObject({ total: 1, retryOf: sourceId });

    expect(zipTasks.get(body.taskId).itemResults[0].name).toBe('failed.bin');
    await request('GET', `/download-zip/cancel/${body.taskId}`);
  }, 12000);

  it('fila cheia retorna 503 sem deixar tarefa órfã nem iniciar execução', async () => {
    // 1 ativa (segura pelo gate) + 5 aguardando = fila lotada. Cada requisição
    // usa um IP próprio para não esbarrar no limite de tarefas por IP.
    const activeId = await postZip();
    await waitFor(() => zipTasks.get(activeId)?.status === 'processing');
    for (let i = 0; i < 5; i++) await postZipWithIp(`198.51.100.${10 + i}`);

    const before = zipTasks.size;

    const res = await request('POST', '/download-zip', { items: [zipItem] });
    expect(res.status).toBe(503);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('ZIP_QUEUE_FULL');
    expect(typeof body.error.message).toBe('string');

    // Nenhuma tarefa órfã: a recém-criada foi removida de zipTasks.
    expect(zipTasks.size).toBe(before);
    // Nenhuma execução extra: só a tarefa ativa chamou fetch (1 gate).
    await waitFor(() => gates.length > 0);
    expect(gates.length).toBe(1);
  });

  it('aceita exatamente ZIP_MAX_ITEMS itens', async () => {
    const items = buildItems(ZIP_MAX_ITEMS);
    const res = await request('POST', '/download-zip', { items });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.taskId).toBeTruthy();
    createdIds.push(body.taskId);
  });

  it('rejeita um item acima do limite com 400', async () => {
    const res = await request('POST', '/download-zip', { items: buildItems(ZIP_MAX_ITEMS + 1) });
    expect(res.status).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('ZIP_TOO_MANY_ITEMS');
    expect(body.error.message).toBe('Número máximo de arquivos excedido.');
  });

  it('não cria tarefa quando o limite é excedido', async () => {
    const before = zipTasks.size;
    const res = await request('POST', '/download-zip', { items: buildItems(ZIP_MAX_ITEMS + 1) });
    expect(res.status).toBe(400);
    expect(zipTasks.size).toBe(before);
  });

  it('não altera a fila quando o limite é excedido', async () => {
    const beforeActive = zipTaskQueue.activeCount;
    const beforeWaiting = zipTaskQueue.waitingCount;
    const res = await request('POST', '/download-zip', { items: buildItems(ZIP_MAX_ITEMS + 1) });
    expect(res.status).toBe(400);
    expect(zipTaskQueue.activeCount).toBe(beforeActive);
    expect(zipTaskQueue.waitingCount).toBe(beforeWaiting);
  });

  // Limite de tarefas ZIP por IP (ZIP_MAX_TASKS_PER_IP = 2).
  it('aceita até o limite de tarefas por IP', async () => {
    const ip = '198.51.100.200';

    const first = await postZipWithIp(ip);
    await waitFor(() => zipTasks.get(first)?.status === 'processing');
    const second = await postZipWithIp(ip);

    expect(zipTasks.get(second)?.status).toBe('queued');
    expect(zipTaskQueue.activeCount).toBe(1);
    expect(zipTaskQueue.waitingCount).toBe(1);
  });

  it('rejeita com 429 a próxima tarefa do mesmo IP', async () => {
    const ip = '198.51.100.201';

    const first = await postZipWithIp(ip);
    await waitFor(() => zipTasks.get(first)?.status === 'processing');
    await postZipWithIp(ip);
    const rejected = await postZipWithIp(ip);

    expect(rejected).toBeNull();
    const res = await request('POST', '/download-zip', { items: [zipItem] }, { headers: { 'X-Forwarded-For': ip } });
    expect(res.status).toBe(429);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('ZIP_IP_LIMIT_REACHED');
    expect(body.error.message).toBe('Você já possui muitas tarefas ZIP em andamento.');
  });

  it('permite outro IP criar tarefa mesmo com o limite do primeiro atingido', async () => {
    const ip1 = '198.51.100.202';
    const ip2 = '198.51.100.203';

    const first = await postZipWithIp(ip1);
    await waitFor(() => zipTasks.get(first)?.status === 'processing');
    await postZipWithIp(ip1);

    // Limite do ip1 atingido (2 tarefas): ip1 recusa...
    expect(await postZipWithIp(ip1)).toBeNull();
    // ...mas o ip2 segue permitido.
    const other = await postZipWithIp(ip2);
    expect(zipTasks.get(other)?.status).toBe('queued');
  });

  it('libera o limite quando as tarefas terminam', async () => {
    const ip = '203.0.113.50';

    const first = await postZipWithIp(ip);
    await waitFor(() => zipTasks.get(first)?.status === 'processing');
    await postZipWithIp(ip);

    // Conclui as duas tarefas do IP: libera o gate da ativa, a próxima inicia
    // e também é liberada, até a fila esvaziar.
    for (let i = 0; i < 200; i++) {
      releaseAll();
      if (zipTaskQueue.activeCount === 0 && zipTaskQueue.waitingCount === 0) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(zipTaskQueue.activeCount).toBe(0);
    expect(zipTaskQueue.waitingCount).toBe(0);

    // Tarefas finalizadas não contam: o IP pode criar de novo.
    const next = await postZipWithIp(ip);
    expect(next).not.toBeNull();
  });

  it('libera o limite quando as tarefas são canceladas', async () => {
    const ip = '203.0.113.60';

    const first = await postZipWithIp(ip);
    await waitFor(() => zipTasks.get(first)?.status === 'processing');
    await waitFor(() => gates.length > 0);
    const second = await postZipWithIp(ip);

    // Cancela a que está aguardando (não entraria mais na contagem) e deixa a
    // ativa concluir para a fila esvaziar.
    const res = await request('GET', `/download-zip/cancel/${second}`);
    expect(JSON.parse(res.body).cancelled).toBe(true);
    expect(zipTasks.get(second)?.status).toBe('cancelled');

    releaseAll();
    await waitFor(() => zipTaskQueue.activeCount === 0 && zipTaskQueue.waitingCount === 0);

    // Tarefas canceladas não contam: o IP pode criar de novo.
    const next = await postZipWithIp(ip);
    expect(next).not.toBeNull();
  });
});

describe('GET /download-zip/result cleanup', () => {
  afterEach(() => {
    for (const [id, t] of zipTasks.entries()) {
      if (zipTempDir && t.zipFilePath && t.zipFilePath.startsWith(zipTempDir)) zipTasks.delete(id);
    }
    if (zipTempDir) fs.rmSync(zipTempDir, { recursive: true, force: true });
    zipTempDir = null;
    vi.restoreAllMocks();
  });

  it('removes the ZIP file when the client disconnects mid-download', async () => {
    const { taskId, zipFilePath } = seedZipTask();
    const { req } = await startResultRequest(taskId);
    req.destroy();

    await waitFor(() => !fs.existsSync(zipFilePath));
    expect(fs.existsSync(zipFilePath)).toBe(false);
  });

  it('removes the task from zipTasks when the client disconnects mid-download', async () => {
    const { taskId, zipFilePath } = seedZipTask();
    const { req } = await startResultRequest(taskId);
    req.destroy();

    await waitFor(() => !zipTasks.has(taskId));
    expect(zipTasks.has(taskId)).toBe(false);
  });

  it('removes file and task when the read stream errors', async () => {
    const { taskId, zipFilePath } = seedZipTask();
    vi.spyOn(fs, 'createReadStream').mockImplementationOnce(
      () => new Readable({
        read() {
          this.push(Buffer.alloc(1024));
          process.nextTick(() => this.destroy(new Error('disk read failed')));
        }
      })
    );

    const { req } = await startResultRequest(taskId);
    await waitFor(() => !fs.existsSync(zipFilePath));
    expect(fs.existsSync(zipFilePath)).toBe(false);
    expect(zipTasks.has(taskId)).toBe(false);
    req.destroy();
  });

  it('removes file and task after a normal download completes', async () => {
    const size = 256 * 1024;
    const { taskId, zipFilePath } = seedZipTask(size);
    const res = await request('GET', `/download-zip/result/${taskId}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(size);
    await waitFor(() => !fs.existsSync(zipFilePath) && !zipTasks.has(taskId));
    expect(fs.existsSync(zipFilePath)).toBe(false);
    expect(zipTasks.has(taskId)).toBe(false);
  });
});
