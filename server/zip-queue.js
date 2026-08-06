/**
 * Fila de tarefas ZIP — estrutura (fábrica), parcialmente integrada ao servidor.
 *
 * Fábrica que fornece uma fila FIFO com concorrência limitada:
 * - ativa tarefas imediatamente até o limite `maxActiveTasks`;
 * - tarefas excedentes ficam aguardando (na ordem de chegada, limitadas por
 *   `maxQueuedTasks`);
 * - quando uma tarefa termina, o próximo em espera começa automaticamente
 *   (uma vaga é liberada);
 * - nunca ultrapassa o limite de tarefas ativas;
 * - tarefas aguardando podem ser canceladas (removidas de `waiting`) antes de
 *   executarem;
 * - `getPosition(taskId)` informa a posição da tarefa na fila.
 *
 * Parcialmente integrado ao servidor: cancelamento de tarefas `queued`
 * funciona e `getPosition` alimenta o status; ativas ainda não têm
 * cancelamento, e não há resposta de erro (ex.: HTTP 503).
 */
export function createZipTaskQueue({ maxActiveTasks, maxQueuedTasks, runTask }) {
  const active = new Map();
  const waiting = [];

  function start(entry) {
    const promise = Promise.resolve()
      .then(() => runTask(entry))
      .catch(() => {})
      .finally(() => {
        if (active.get(entry) === promise) {
          active.delete(entry);
          pump();
        }
      });
    active.set(entry, promise);
  }

  function pump() {
    while (active.size < maxActiveTasks && waiting.length > 0) {
      start(waiting.shift());
    }
  }

  function enqueue(entry) {
    if (waiting.length >= maxQueuedTasks) {
      const err = new Error(`Queue is full (max ${maxQueuedTasks} queued)`);
      err.code = 'ZIP_QUEUE_FULL';
      throw err;
    }
    waiting.push(entry);
    pump();
    return entry;
  }

  // Remove uma tarefa que ainda está aguardando. A entrada pode ser o próprio
  // valor enfileirado (ex.: string nos testes) ou um objeto com taskId.
  function cancel(taskId) {
    const idx = waiting.findIndex((entry) => entry === taskId || entry?.taskId === taskId);
    if (idx === -1) return false;
    waiting.splice(idx, 1);
    return true;
  }

  // Posição da tarefa: aguardando => 1 (primeira), 2 (segunda), etc.;
  // ativa => 0; inexistente => null.
  function getPosition(taskId) {
    const idx = waiting.findIndex((entry) => entry === taskId || entry?.taskId === taskId);
    if (idx !== -1) return idx + 1;
    for (const entry of active.keys()) {
      if (entry === taskId || entry?.taskId === taskId) return 0;
    }
    return null;
  }

  return {
    enqueue,
    pump,
    cancel,
    getPosition,
    get activeCount() {
      return active.size;
    },
    get waitingCount() {
      return waiting.length;
    },
  };
}