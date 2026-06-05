import * as mediasoup from "mediasoup";
import { types as mediasoupTypes } from "mediasoup";
import { config } from "./config";

let worker: mediasoupTypes.Worker;

/**
 * Create and return a mediasoup Worker.
 * In production you may want multiple Workers (one per CPU core).
 */
export async function createWorker(): Promise<mediasoupTypes.Worker> {
  const newWorker = await mediasoup.createWorker({
    logLevel: config.worker.logLevel,
    logTags: config.worker.logTags,
    rtcMinPort: config.worker.rtcMinPort,
    rtcMaxPort: config.worker.rtcMaxPort,
  });

  newWorker.on("died", (error) => {
    console.error("mediasoup Worker died, exiting in 2 seconds...", error);
    setTimeout(() => process.exit(1), 2000);
  });

  worker = newWorker;
  console.log(`mediasoup Worker created [pid:${newWorker.pid}]`);
  return newWorker;
}

/**
 * Create a Router with the configured media codecs.
 * Each room gets its own Router.
 */
export async function createRouter(
  worker: mediasoupTypes.Worker
): Promise<mediasoupTypes.Router> {
  const router = await worker.createRouter({
    mediaCodecs: config.mediaCodecs,
  });

  console.log(`Router created [id:${router.id}]`);
  return router;
}
