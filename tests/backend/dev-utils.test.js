import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { assertPortAvailable, assertPortsAvailable } from '../../server/dev-utils.js';

const servers = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(server => new Promise(resolve => server.close(resolve))),
  );
});

describe('development server port check', () => {
  it('accepts an available port', async () => {
    await expect(assertPortAvailable(0)).resolves.toBeUndefined();
  });

  it('reports a port already in use', async () => {
    const server = net.createServer();
    servers.push(server);
    await new Promise(resolve => server.listen(0, resolve));
    const { port } = server.address();

    await expect(assertPortAvailable(port)).rejects.toMatchObject({
      code: 'EADDRINUSE',
      port,
      message: `A porta ${port} já está em uso.`,
    });
  });

  it('checks every port before the development services start', async () => {
    const server = net.createServer();
    servers.push(server);
    await new Promise(resolve => server.listen(0, resolve));
    const { port } = server.address();

    await expect(assertPortsAvailable([0, port])).rejects.toMatchObject({
      code: 'EADDRINUSE',
      port,
    });
  });
});
