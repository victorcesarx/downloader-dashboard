/**
 * Coleta URLs de mídia observando o tráfego de rede de um navegador
 * Chromium headless (Playwright). Ainda não é integrado ao /analyze.
 *
 * - Navega até `pageUrl` e observa requests e responses;
 * - coleta URLs com extensões de mídia conhecidas;
 * - coleta também respostas cujo Content-Type seja vídeo, áudio, HLS ou DASH;
 * - remove duplicatas pela URL, preservando o MIME type das responses;
 * - aplica limites (navegação, total de URLs, tempo total);
 * - bloqueia downloads e popups;
 * - sempre fecha página e navegador (finally).
 *
 * @param {string} pageUrl
 * @param {object} [options]
 * @param {number} [options.navigationTimeout=30000] - timeout do goto, em ms.
 * @param {number} [options.postNavigationDelay=3000] - janela de coleta após navegar, em ms.
 * @param {number} [options.maxUrls=200] - máximo de URLs coletadas.
 * @param {number} [options.maxTotalTime=45000] - tempo total máximo, em ms.
 * @returns {Promise<{candidates: Array<{url: string, mimeType: string|null, source: string}>, warnings: string[]>}
 *   - source: 'network-request' | 'network-response'.
 *   - mimeType: normalizado da response (sem parâmetros); null para requests.
 */
import { chromium } from 'playwright';

const MEDIA_EXTENSIONS = ['mp4', 'webm', 'm3u8', 'mpd', 'mp3', 'm4a'];
const MEDIA_EXT_RE = new RegExp(`\\.(${MEDIA_EXTENSIONS.join('|')})(?:[?#]|$)`, 'i');

const MEDIA_CONTENT_TYPES = [
  /^video\//i,
  /^audio\//i,
  /^application\/vnd\.apple\.mpegurl/i,
  /^application\/x-mpegurl/i,
  /^application\/dash\+xml/i,
];

function hasMediaExtension(url) {
  return typeof url === 'string' && MEDIA_EXT_RE.test(url);
}

function isMediaContentType(contentType) {
  const base = String(contentType || '').split(';')[0].trim();
  if (!base) return false;
  return MEDIA_CONTENT_TYPES.some(re => re.test(base));
}

export async function collectNetworkMedia(pageUrl, options = {}) {
  const {
    navigationTimeout = 30000,
    postNavigationDelay = 3000,
    maxUrls = 200,
    maxTotalTime = 45000,
  } = options;

  const candidates = new Map();
  const warnings = [];
  let browser = null;
  let page = null;
  let totalTimer = null;

  const markMaxReached = () => {
    if (!warnings.includes('max_urls_reached')) warnings.push('max_urls_reached');
  };

  const addRequest = (url) => {
    if (!url || candidates.has(url)) return;
    if (candidates.size >= maxUrls) return markMaxReached();
    candidates.set(url, { url, mimeType: null, source: 'network-request' });
    if (candidates.size === maxUrls) markMaxReached();
  };

  const addResponse = (url, mimeType) => {
    if (!url) return;
    const entry = { url, mimeType: mimeType || null, source: 'network-response' };
    if (candidates.has(url)) {
      candidates.set(url, entry);
      return;
    }
    if (candidates.size >= maxUrls) return markMaxReached();
    candidates.set(url, entry);
    if (candidates.size === maxUrls) markMaxReached();
  };

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ acceptDownloads: false });
    page = await context.newPage();

    // Bloqueia downloads e popups.
    page.on('popup', (popup) => { popup.close().catch(() => {}); });
    page.on('download', (download) => { download.cancel().catch(() => {}); });

    // Observa requests (URLs com extensão de mídia) e responses (extensão ou
    // Content-Type de vídeo/áudio/HLS/DASH).
    page.on('request', (request) => {
      if (hasMediaExtension(request.url())) addRequest(request.url());
    });
    page.on('response', (response) => {
      const url = response.url();
      const contentType = response.headers()['content-type'] || '';
      const baseMime = String(contentType).split(';')[0].trim();
      if (hasMediaExtension(url) || isMediaContentType(baseMime)) addResponse(url, baseMime);
    });

    // Limite de tempo total: fecha a página, parando a coleta.
    let aborted = false;
    totalTimer = setTimeout(() => {
      aborted = true;
      if (!warnings.includes('max_time_exceeded')) warnings.push('max_time_exceeded');
      page?.close().catch(() => {});
    }, maxTotalTime);

    try {
      await page.goto(pageUrl, { timeout: navigationTimeout, waitUntil: 'domcontentloaded' });
    } catch (err) {
      warnings.push(err && err.name === 'TimeoutError' ? 'navigation_timeout' : 'navigation_error');
    }

    // Janela de coleta pós-navegação (respirações da página).
    if (!aborted) {
      try { await page.waitForTimeout(postNavigationDelay); } catch {}
    }
  } catch (err) {
    warnings.push('browser_error');
  } finally {
    if (totalTimer) clearTimeout(totalTimer);
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }

  const collected = [...candidates.values()];
  return { candidates: collected, warnings };
}
