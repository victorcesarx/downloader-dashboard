import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(projectRoot, 'dist');
const indexFile = path.join(distDir, 'index.html');

function fail(message) {
  console.error(`Build check failed: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(indexFile)) fail('dist/index.html is missing');

const html = fs.readFileSync(indexFile, 'utf8');
if (/\?v=\d+/.test(html)) fail('manual asset version found in index.html');
if (/\/(?:scripts|styles)\//.test(html)) fail('source asset reference found in production HTML');

const assetReferences = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+\.(?:js|css))"/g)].map(match => match[1]);
if (!assetReferences.some(file => file.endsWith('.js'))) fail('hashed JavaScript entry was not generated');
if (!assetReferences.some(file => file.endsWith('.css'))) fail('hashed CSS entry was not generated');

for (const reference of assetReferences) {
  if (!/-[A-Za-z0-9_-]{8,}\.(?:js|css)$/.test(reference)) fail(`asset has no content hash: ${reference}`);
  const assetPath = path.join(distDir, ...reference.split('/').filter(Boolean));
  if (!fs.existsSync(assetPath)) fail(`referenced asset is missing: ${reference}`);
}

for (const locale of ['pt-BR.json', 'en.json']) {
  const localePath = path.join(distDir, 'locales', locale);
  if (!fs.existsSync(localePath)) fail(`locale is missing: ${locale}`);
  JSON.parse(fs.readFileSync(localePath, 'utf8'));
}

const manifestPath = path.join(distDir, '.vite', 'manifest.json');
if (!fs.existsSync(manifestPath)) fail('Vite manifest is missing');
JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const sourceMaps = fs.readdirSync(path.join(distDir, 'assets')).filter(file => file.endsWith('.map'));
if (process.env.BUILD_SOURCEMAP !== 'hidden' && sourceMaps.length > 0) {
  fail('source maps must not be emitted by the default production build');
}

console.log(`Build verified: ${assetReferences.length} hashed assets, 2 locales, no manual versions.`);
