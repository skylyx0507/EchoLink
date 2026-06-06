import * as mediasoup from "mediasoup";
import { types as mediasoupTypes } from "mediasoup";
import os from "os";
import { config } from "./config";

const workerPool: mediasoupTypes.Worker[] = [];
let nextWorkerIndex = 0;

/**
 * Create a Worker pool with one Worker per CPU core.
 * Each Worker is a separate C++ subprocess that can handle
 * its own set of Routers independently.
 */
export async function createWorkerPool(): Promise<mediasoupTypes.Worker[]> {
  const numWorkers = os.cpus().length;
  console.log(`Creating ${numWorkers} mediasoup Workers (one per CPU core)`);

  const promises: Promise<mediasoupTypes.Worker>[] = [];
  for (let i = 0; i < numWorkers; i++) {
    promises.push(createSingleWorker(i));
  }

  const workers = await Promise.all(promises);
  workerPool.push(...workers);
  return workers;
}

async function createSingleWorker(index: number): Promise<mediasoupTypes.Worker> {
  const worker = await mediasoup.createWorker({
    logLevel: config.worker.logLevel,
    logTags: config.worker.logTags,
    rtcMinPort: config.worker.rtcMinPort,
    rtcMaxPort: config.worker.rtcMaxPort,
  });

  worker.on("died", (error) => {
    console.error(`mediasoup Worker #${index} [pid:${worker.pid}] died, exiting in 2 seconds...`, error);
    setTimeout(() => process.exit(1), 2000);
  });

  console.log(`  Worker #${index} created [pid:${worker.pid}]`);
  return worker;
}

/**
 * Get the next Worker via round-robin.
 * Distributes new Rooms evenly across all Workers.
 */
export function getNextWorker(): mediasoupTypes.Worker {
  if (workerPool.length === 0) {
    throw new Error("Worker pool not initialized");
  }
  const worker = workerPool[nextWorkerIndex];
  nextWorkerIndex = (nextWorkerIndex + 1) % workerPool.length;
  return worker;
}

/**
 * Get total resource stats across all Workers.
 */
export async function getWorkerStats(): Promise<{ pid: number; cpu: number; memory: number }[]> {
  const stats = await Promise.all(
    workerPool.map(async (w) => {
      try {
        const usage = await w.getResourceUsage();
        return { pid: w.pid, cpu: usage.ru_utime + usage.ru_stime, memory: usage.ru_maxrss };
      } catch {
        return { pid: w.pid, cpu: 0, memory: 0 };
      }
    })
  );
  return stats;
}

/**
 * Close all Workers in the pool.
 */
export function closeAllWorkers(): void {
  for (const worker of workerPool) {
    worker.close();
  }
  workerPool.length = 0;
}

/**
 * Create a Router on a specific Worker.
 */
export async function createRouter(
  worker: mediasoupTypes.Worker
): Promise<mediasoupTypes.Router> {
  const router = await worker.createRouter({
    mediaCodecs: config.mediaCodecs,
  });

  console.log(`Router created [id:${router.id}] on Worker [pid:${worker.pid}]`);
  return router;
}
