import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entryFile = path.join(projectRoot, 'dist', 'index.html');

if (!fs.existsSync(entryFile)) {
  console.error('Production build not found. Run "npm run build" before starting the server.');
  process.exit(1);
}

process.env.NODE_ENV = 'production';
await import('../server.js');
