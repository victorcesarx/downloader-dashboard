import net from 'node:net';

export function assertPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();

    probe.once('error', error => {
      if (error.code === 'EADDRINUSE') {
        const conflict = new Error(`A porta ${port} já está em uso.`);
        conflict.code = error.code;
        conflict.port = port;
        reject(conflict);
        return;
      }

      reject(error);
    });

    probe.once('listening', () => probe.close(resolve));
    probe.listen(port);
  });
}

export async function assertPortsAvailable(ports) {
  for (const port of ports) await assertPortAvailable(port);
}
