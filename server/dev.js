import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPortsAvailable } from './dev-utils.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viteCli = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const backendPort = Number.parseInt(process.env.PORT, 10) || 3006;
const vitePort = Number.parseInt(process.env.VITE_PORT, 10) || 5173;
const children = [];
let stopping = false;

function start(args, env = process.env) {
  const child = spawn(process.execPath, args, {
    cwd: projectRoot,
    env,
    stdio: 'inherit',
  });
  children.push(child);
  child.on('exit', code => stop(code ?? 0));
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.pid || child.exitCode !== null) continue;

    if (process.platform === 'win32') {
      const result = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      if (result.status !== 0) child.kill();
    } else {
      child.kill('SIGTERM');
    }
  }
  process.exitCode = code;
}

try {
  await assertPortsAvailable([backendPort, vitePort]);
} catch (error) {
  if (error.code === 'EADDRINUSE') {
    const occupiedPort = error.port;
    console.error(`\nNão foi possível iniciar: a porta ${occupiedPort} já está ocupada.`);
    console.error(
      `No PowerShell, localize e encerre o processo com:\n` +
        `  Get-NetTCPConnection -LocalPort ${occupiedPort} -State Listen | ` +
        `ForEach-Object { Stop-Process -Id $_.OwningProcess }\n`,
    );
    process.exitCode = 1;
  } else {
    throw error;
  }
}

if (process.exitCode) process.exit();

start(['--watch', 'server.js'], {
  ...process.env,
  NODE_ENV: 'development',
  LOG_FORMAT: process.env.LOG_FORMAT || 'pretty',
});
start([viteCli, '--host', '127.0.0.1', '--port', String(vitePort)]);

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
