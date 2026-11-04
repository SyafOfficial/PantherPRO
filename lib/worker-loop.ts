/** Independent non-overlapping task loops keep maintenance off the delivery path. */
export async function runWorkerLoop(
  job: () => Promise<number | void>,
  options: {
    idleMs: number;
    busyMs?: number;
    once: boolean;
    stopped: () => boolean;
    onError: () => void;
  },
) {
  while (!options.stopped()) {
    let delay = options.idleMs;
    try {
      const count = await job();
      if (count) delay = options.busyMs ?? delay;
    } catch {
      options.onError();
      delay = Math.max(1000, options.idleMs);
      if (options.once) process.exitCode = 1;
    }
    if (options.once || options.stopped()) break;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
export async function forEachConcurrent<T>(
  items: T[],
  concurrency: number,
  job: (item: T) => Promise<void>,
) {
  let next = 0;
  const failures: unknown[] = [];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++];
        try {
          await job(item);
        } catch (error) {
          failures.push(error);
        }
      }
    }),
  );
  if (failures.length)
    throw new Error("Some delivery tasks failed; leases will recover them");
}
/** A freed slot can accept the next delivery without waiting for its batch peers. */
export function createTaskPool(limit: number, onError: () => void) {
  if (!Number.isInteger(limit) || limit < 1)
    throw new Error("Invalid task capacity");
  const tasks = new Set<Promise<void>>();
  return {
    get available() {
      return limit - tasks.size;
    },
    start(job: () => Promise<void>) {
      if (tasks.size >= limit) throw new Error("Task capacity exhausted");
      const task = Promise.resolve()
        .then(job)
        .catch(onError)
        .finally(() => {
          tasks.delete(task);
        });
      tasks.add(task);
    },
    async drain() {
      while (tasks.size) await Promise.all([...tasks]);
    },
  };
}
