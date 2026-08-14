import fs from 'node:fs/promises';
import { defineConfig } from 'vite';

const localeFiles = ['pt-BR.json', 'en.json'];

function emitLocales() {
  return {
    name: 'webscope-locales',
    apply: 'build',
    async generateBundle() {
      for (const fileName of localeFiles) {
        this.emitFile({
          type: 'asset',
          fileName: `locales/${fileName}`,
          source: await fs.readFile(new URL(`./locales/${fileName}`, import.meta.url)),
        });
      }
    },
  };
}

function proxyTarget(target) {
  return {
    target,
    configure(proxy) {
      proxy.on('proxyRes', (proxyRes, _req, res) => {
        // O cliente pode encerrar enquanto o proxy ainda transmite a resposta.
        // Consumir o erro evita ERR_STREAM_WRITE_AFTER_END não tratado.
        res.on('error', () => proxyRes.destroy());
      });
    },
  };
}

export default defineConfig({
  base: '/',
  plugins: [emitLocales()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    manifest: true,
    sourcemap: process.env.BUILD_SOURCEMAP === 'hidden' ? 'hidden' : false,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/analyze': proxyTarget('http://127.0.0.1:3006'),
      '/auth': proxyTarget('http://127.0.0.1:3006'),
      '/download-zip': proxyTarget('http://127.0.0.1:3006'),
      '/media-metadata': proxyTarget('http://127.0.0.1:3006'),
      '/proxy': proxyTarget('http://127.0.0.1:3006'),
    },
  },
});
