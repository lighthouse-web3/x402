import config from "../config/index.js";
import logger from "../utils/logger.js";
import { getFromS3 } from "../services/s3/wasabiClient.js";
import { uploadToIPFS } from "../services/ipfs/lighthouseService.js";
import {
  getFilesByStatus,
  markFileUploading,
  markFileUploaded,
  markFileFailed,
} from "../db/x402/fileTracking.js";

let isRunning = false;

/**
 * Process queued files: Download from S3 and upload to IPFS
 */
const processQueuedFiles = async (): Promise<void> => {
  if (isRunning) {
    logger.info("[S3→IPFS Worker] Already running, skipping this cycle");
    return;
  }

  isRunning = true;
  logger.info("[S3→IPFS Worker] Starting processing cycle");

  try {
    // Get all files with storageStage "queued"
    const queuedFiles = await getFilesByStatus("queued");

    if (queuedFiles.length === 0) {
      logger.info("[S3→IPFS Worker] No queued files to process");
      return;
    }

    logger.info(`[S3→IPFS Worker] Found ${queuedFiles.length} queued files`);

    // Process each file
    for (const file of queuedFiles) {
      try {
        logger.info(`[S3→IPFS Worker] Processing file: ${file.id} (${file.fileName})`);

        // Mark as uploading
        await markFileUploading(file.id);

        // Download from S3
        if (!file.s3Key) {
          throw new Error("File has no S3 key");
        }

        logger.info(`[S3→IPFS Worker] Downloading from S3: ${file.s3Key}`);
        const s3Result = await getFromS3(file.s3Key);

        if (!s3Result.success || !s3Result.data) {
          throw new Error(`S3 download failed: ${s3Result.error}`);
        }

        logger.info(`[S3→IPFS Worker] Downloaded ${s3Result.data.length} bytes from S3`);

        // Upload to IPFS
        logger.info(`[S3→IPFS Worker] Uploading to IPFS: ${file.fileName}`);
        const ipfsResult = await uploadToIPFS(s3Result.data, file.fileName);

        if (!ipfsResult.success || !ipfsResult.cid) {
          throw new Error(`IPFS upload failed: ${ipfsResult.error}`);
        }

        // Mark as uploaded with CID
        await markFileUploaded(file.id, ipfsResult.cid);

        logger.info(
          `[S3→IPFS Worker] File ${file.id} uploaded to IPFS: ${ipfsResult.cid}`
        );
      } catch (fileError: any) {
        logger.error(
          `[S3→IPFS Worker] Error processing file ${file.id}: ${fileError.message}`
        );

        // Mark file as failed
        await markFileFailed(file.id, fileError.message);
      }
    }
  } catch (error: any) {
    logger.error(`[S3→IPFS Worker] Worker error: ${error.message}`);
  } finally {
    isRunning = false;
    logger.info("[S3→IPFS Worker] Processing cycle completed");
  }
};

let intervalId: NodeJS.Timeout | null = null;

/**
 * Start the S3 to IPFS worker
 */
export const startS3ToIpfsWorker = (): void => {
  if (!config.workers_enabled) {
    logger.info("[S3→IPFS Worker] Workers disabled, not starting");
    return;
  }

  if (!config.lighthouse_api_key) {
    logger.warn("[S3→IPFS Worker] LIGHTHOUSE_API_KEY not configured, worker disabled");
    return;
  }

  const interval = config.s3_to_ipfs_interval;

  logger.info(
    `[S3→IPFS Worker] Starting with interval: ${interval / 1000} seconds`
  );

  // Run immediately on start
  processQueuedFiles();

  // Then run on interval
  intervalId = setInterval(processQueuedFiles, interval);
};

/**
 * Stop the S3 to IPFS worker
 */
export const stopS3ToIpfsWorker = (): void => {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info("[S3→IPFS Worker] Stopped");
  }
};

/**
 * Manually trigger processing (for testing)
 */
export const triggerS3ToIpfsProcessing = async (): Promise<void> => {
  await processQueuedFiles();
};
