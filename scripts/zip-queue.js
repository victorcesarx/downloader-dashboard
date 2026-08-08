const zipTasks = new Map();
const listeners = new Set();

function notify() {
  listeners.forEach(listener => listener(zipTasks));
}

export function getZipQueueTasks() {
  return zipTasks;
}

export function subscribeZipQueue(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function addZipQueueTask(task) {
  zipTasks.set(task.taskId, {
    kind: 'zip',
    state: 'queued',
    _done: false,
    processed: 0,
    currentBytes: 0,
    speed: 0,
    createdAt: Date.now(),
    ...task,
  });
  notify();
  return zipTasks.get(task.taskId);
}

export function updateZipQueueTask(taskId, patch) {
  const current = zipTasks.get(taskId);
  if (!current) return null;
  const next = { ...current, ...patch };
  // O servidor concluir a montagem não significa que o usuário já baixou o
  // arquivo. O ZIP permanece ativo (pronto para baixar) até essa ação ocorrer.
  next._done = next.state === 'error' || (next.state === 'completed' && next.downloaded === true);
  if (next._done && !next.finishedAt) next.finishedAt = Date.now();
  zipTasks.set(taskId, next);
  notify();
  return next;
}

export function removeZipQueueTask(taskId) {
  const removed = zipTasks.delete(taskId);
  if (removed) notify();
  return removed;
}

export function clearZipQueueForTests() {
  zipTasks.clear();
  notify();
}
