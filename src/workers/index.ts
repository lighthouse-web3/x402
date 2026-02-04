import { startS3ToIpfsWorker, stopS3ToIpfsWorker } from "./s3ToIpfsWorker.js";
import {
  startDealCheckerWorker,
  stopDealCheckerWorker,
} from "./dealCheckerWorker.js";
import config from "../config/index.js";

/**
 * Start all background workers
 */
export const startAllWorkers = (): void => {
  if (!config.workers_enabled) {
    console.log("[Workers] All workers disabled via WORKERS_ENABLED=false");
    return;
  }

  console.log("[Workers] Starting background workers...");

  // Start S3 to IPFS worker
  startS3ToIpfsWorker();

  // Start Deal Checker worker
  startDealCheckerWorker();

  console.log("[Workers] All workers started");
};

/**
 * Stop all background workers
 */
export const stopAllWorkers = (): void => {
  console.log("[Workers] Stopping all workers...");

  stopS3ToIpfsWorker();
  stopDealCheckerWorker();

  console.log("[Workers] All workers stopped");
};

// Export individual worker controls
export {
  startS3ToIpfsWorker,
  stopS3ToIpfsWorker,
  startDealCheckerWorker,
  stopDealCheckerWorker,
};

// Export manual triggers for testing
export { triggerS3ToIpfsProcessing } from "./s3ToIpfsWorker.js";
export { triggerDealChecking } from "./dealCheckerWorker.js";
