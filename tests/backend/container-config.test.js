import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = file => readFileSync(resolve(root, file), 'utf8');

describe('configuração de container', () => {
  it('usa build multi-stage com gate de testes e runtime mínimo', () => {
    const dockerfile = read('Dockerfile');
    expect(dockerfile).toContain('AS build');
    expect(dockerfile).toContain('AS production-dependencies');
    expect(dockerfile).toContain('AS runtime');
    expect(dockerfile).toContain('RUN npm run verify');
    expect(dockerfile).toContain('npm ci --omit=dev');
    expect(dockerfile).toContain('/app/dist ./dist');
    expect(dockerfile).not.toMatch(/\/app\/(?:scripts|styles|tests)\s+\.\//);
  });

  it('executa sem root e possui healthcheck sem curl', () => {
    const dockerfile = read('Dockerfile');
    expect(dockerfile).toContain('USER node:node');
    expect(dockerfile).toContain('HEALTHCHECK');
    expect(dockerfile).toContain("fetch('http://127.0.0.1:'");
    expect(dockerfile).not.toContain('curl');
  });

  it('exclui segredos, dependências e artefatos locais do contexto', () => {
    const dockerignore = read('.dockerignore');
    for (const entry of ['.env', '.git', 'node_modules', 'dist', 'temp_zips', 'certs']) {
      expect(dockerignore.split(/\r?\n/)).toContain(entry);
    }
  });

  it('endurece o serviço e dedica um volume gravável aos ZIPs', () => {
    const compose = read('docker-compose.yml');
    expect(compose).toContain('read_only: true');
    expect(compose).toMatch(/cap_drop:\s*\r?\n\s*- ALL/);
    expect(compose).toContain('no-new-privileges:true');
    expect(compose).toContain('webscope-temp:/app/temp_zips');
    expect(compose).toContain('ZIP_MAX_TEMP_BYTES');
    expect(compose).toContain('pids_limit:');
    expect(compose).toContain('mem_limit:');
    expect(compose).toContain('healthcheck:');
  });

  it('fornece proxy reverso separado sem expor segredos na imagem', () => {
    const proxy = read('docker-compose.proxy.yml');
    const caddy = read('Caddyfile.example');
    expect(proxy).toContain('caddy:2-alpine');
    expect(proxy).toContain('condition: service_healthy');
    expect(caddy).toContain('reverse_proxy webscope:3006');
    expect(caddy).toContain('response_header_timeout 5m');
  });
});
