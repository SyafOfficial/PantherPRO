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
