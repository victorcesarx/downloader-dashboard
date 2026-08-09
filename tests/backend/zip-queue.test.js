import { describe, it, expect } from 'vitest';
import { createZipTaskQueue } from '../../server/zip-queue.js';

const tick = () => Promise.resolve();
const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createZipTaskQueue', () => {
  it('inicia imediatamente até maxActiveTasks', async () => {
    const started = [];
    const queue = createZipTaskQueue({
      maxActiveTasks: 2,
      maxQueuedTasks: 10,
      runTask: (task) => {
        started.push(task);
        return new Promise(() => {});
      },
    });

    queue.enqueue('a');
    queue.enqueue('b');
    queue.enqueue('c');

    expect(queue.activeCount).toBe(2);
    expect(queue.waitingCount).toBe(1);

    await tick();
    expect(started).toEqual(['a', 'b']);
  });

  it('mantém as tarefas excedentes aguardando', async () => {
    const queue = createZipTaskQueue({
      maxActiveTasks: 1,
      maxQueuedTasks: 5,
      runTask: () => new Promise(() => {}),
    });

    queue.enqueue('a');
    queue.enqueue('b');
    queue.enqueue('c');
    queue.enqueue('d');

    await tick();
    expect(queue.activeCount).toBe(1);
    expect(queue.waitingCount).toBe(3);
  });

  it('respeita a ordem FIFO de início', async () => {
    const orders = [deferred(), deferred(), deferred()];
    const started = [];
    const queue = createZipTaskQueue({
      maxActiveTasks: 1,
      maxQueuedTasks: 5,
      runTask: (task) => {
        started.push(task);
        return orders[started.length - 1].promise;
      },
    });

    queue.enqueue('first');
    queue.enqueue('second');
    queue.enqueue('third');

    await wait();
    expect(started).toEqual(['first']);

    orders[0].resolve();
    await wait();
    expect(started).toEqual(['first', 'second']);

    orders[1].resolve();
    await wait();
    expect(started).toEqual(['first', 'second', 'third']);
  });

  it('inicia a próxima tarefa quando uma termina', async () => {
    const first = deferred();
    const started = [];
    const queue = createZipTaskQueue({
      maxActiveTasks: 1,
      maxQueuedTasks: 5,
      runTask: (task) => {
        started.push(task);
        return task === 'a' ? first.promise : Promise.resolve();
      },
    });

    queue.enqueue('a');
    await tick();
    expect(started).toEqual(['a']);

    queue.enqueue('b');
    expect(queue.waitingCount).toBe(1);

    first.resolve();
    await wait();

    expect(started).toEqual(['a', 'b']);
    expect(queue.activeCount).toBe(0);
    expect(queue.waitingCount).toBe(0);
  });

  it('nunca ultrapassa o limite de tarefas ativas', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const queue = createZipTaskQueue({
      maxActiveTasks: 2,
      maxQueuedTasks: 20,
      runTask: () =>
        new Promise((resolve) => {
          concurrent += 1;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          setTimeout(() => {
            concurrent -= 1;
            resolve();
          }, 5);
        }),
    });

    for (let i = 0; i < 8; i++) queue.enqueue(`task-${i}`);

    await wait(80);

    expect(maxConcurrent).toBeLessThanOrEqual(2);
    expect(queue.activeCount).toBe(0);
    expect(queue.waitingCount).toBe(0);
  });

  it('recusa tarefas quando a fila de espera está cheia', async () => {
    const queue = createZipTaskQueue({
      maxActiveTasks: 1,
      maxQueuedTasks: 2,
      runTask: () => new Promise(() => {}),
    });

    queue.enqueue('a');
    queue.enqueue('b');
    queue.enqueue('c');

    expect(() => queue.enqueue('d')).toThrow(/full/);
  });

  describe('cancel', () => {
    it('cancela uma tarefa aguardando e a remove da fila', () => {
      const queue = createZipTaskQueue({
        maxActiveTasks: 1,
        maxQueuedTasks: 5,
        runTask: () => new Promise(() => {}),
      });

      queue.enqueue('a');
      queue.enqueue('b');
      queue.enqueue('c');

      expect(queue.waitingCount).toBe(2);
      expect(queue.cancel('b')).toBe(true);
      expect(queue.waitingCount).toBe(1);
      expect(queue.cancel('b')).toBe(false);
    });

    it('tarefa cancelada nunca executa', async () => {
      const first = deferred();
      const started = [];
      const queue = createZipTaskQueue({
        maxActiveTasks: 1,
        maxQueuedTasks: 5,
        runTask: (task) => {
          started.push(task);
          return task === 'a' ? first.promise : Promise.resolve();
        },
      });

      queue.enqueue('a');
      queue.enqueue('b');
      queue.enqueue('c');

      await wait();
      expect(started).toEqual(['a']);

      expect(queue.cancel('b')).toBe(true);

      first.resolve();
      await wait();

      expect(started).toEqual(['a', 'c']);
      expect(started).not.toContain('b');
    });

    it('retorna false para ID inexistente', () => {
      const queue = createZipTaskQueue({
        maxActiveTasks: 1,
        maxQueuedTasks: 5,
        runTask: () => new Promise(() => {}),
      });

      queue.enqueue('a');
      expect(queue.cancel('unknown')).toBe(false);
    });

    it('retorna false para tarefa que não está aguardando (ativa)', () => {
      const queue = createZipTaskQueue({
        maxActiveTasks: 1,
        maxQueuedTasks: 5,
        runTask: () => new Promise(() => {}),
      });

      queue.enqueue('a');
      expect(queue.cancel('a')).toBe(false);
    });
  });

  describe('getPosition', () => {
    it('retorna a posição correta das tarefas aguardando e 0 para a ativa', () => {
      const queue = createZipTaskQueue({
        maxActiveTasks: 1,
        maxQueuedTasks: 5,
        runTask: () => new Promise(() => {}),
      });

      queue.enqueue('a');
      queue.enqueue('b');
      queue.enqueue('c');

      expect(queue.getPosition('a')).toBe(0);
      expect(queue.getPosition('b')).toBe(1);
      expect(queue.getPosition('c')).toBe(2);
      expect(queue.getPosition('unknown')).toBeNull();
    });

    it('atualiza a posição após cancelar uma tarefa aguardando', () => {
      const queue = createZipTaskQueue({
        maxActiveTasks: 1,
        maxQueuedTasks: 5,
        runTask: () => new Promise(() => {}),
      });

      queue.enqueue('a');
      queue.enqueue('b');
      queue.enqueue('c');
      queue.enqueue('d');

      expect(queue.getPosition('d')).toBe(3);

      queue.cancel('b');

      expect(queue.getPosition('c')).toBe(1);
      expect(queue.getPosition('d')).toBe(2);
      expect(queue.getPosition('b')).toBeNull();
    });

    it('atualiza a posição quando uma tarefa começa', async () => {
      const first = deferred();
      const second = deferred();
      const started = [];
      const queue = createZipTaskQueue({
        maxActiveTasks: 1,
        maxQueuedTasks: 5,
        runTask: (task) => {
          started.push(task);
          if (task === 'a') return first.promise;
          if (task === 'b') return second.promise;
          return Promise.resolve();
        },
      });

      queue.enqueue('a');
      queue.enqueue('b');
      queue.enqueue('c');

      await wait();
      expect(queue.getPosition('b')).toBe(1);

      first.resolve();
      await wait();

      expect(started).toEqual(['a', 'b']);
      expect(queue.getPosition('b')).toBe(0);
      expect(queue.getPosition('c')).toBe(1);
    });
  });
});