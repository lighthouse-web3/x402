import config from "../config/index.js";
import logger from "../utils/logger.js";
import { deleteFromS3 } from "../services/s3/wasabiClient.js";
import { checkDealStatus } from "../services/ipfs/lighthouseService.js";
import {
  getFilesNotSentForDeal,
  markFileSentForDeal,
  clearS3Key,
} from "../db/x402/fileTracking.js";

let isRunning = false;

/**
 * Check deals for files that have been uploaded to IPFS
 * and delete from S3 once deal is confirmed
 */
const checkDealsAndCleanup = async (): Promise<void> => {
  if (isRunning) {
    logger.info("[Deal Checker] Already running, skipping this cycle");
    return;
  }

  isRunning = true;
  logger.info("[Deal Checker] Starting processing cycle");

  try {
    // Get files that have CID but sentForDeal is false
    const filesToCheck = await getFilesNotSentForDeal();

    if (filesToCheck.length === 0) {
      logger.info("[Deal Checker] No files to check for deals");
      return;
    }

    logger.info(`[Deal Checker] Checking deals for ${filesToCheck.length} files`);

    // Process each file
    for (const file of filesToCheck) {
      try {
        if (!file.cid) {
          logger.warn(`[Deal Checker] File ${file.id} has no CID, skipping`);
          continue;
        }

        logger.info(`[Deal Checker] Checking deal status for: ${file.cid}`);

        // Check deal status from Lighthouse API
        const dealResult = await checkDealStatus(file.cid);

        if (!dealResult.success) {
          logger.warn(
            `[Deal Checker] Failed to check deal for ${file.cid}: ${dealResult.error}`
          );
          continue;
        }

        if (dealResult.hasDeal && dealResult.deals && dealResult.deals.length > 0) {
          const deal = dealResult.deals[0];

          // Check if deal is active/completed
          const isDealActive =
            deal.dealStatus &&
            (deal.dealStatus.includes("Active") ||
              deal.dealStatus.includes("Proving"));

          if (isDealActive) {
            logger.info(
              `[Deal Checker] Deal confirmed for ${file.id}, cleaning up S3`
            );

            // Mark as sent for deal and set blockStatus from Filecoin deal status
            await markFileSentForDeal(file.id, deal.dealStatus);

            // Delete from S3
            if (file.s3Key) {
              const deleteResult = await deleteFromS3(file.s3Key);

              if (deleteResult.success) {
                await clearS3Key(file.id);
                logger.info(
                  `[Deal Checker] S3 file deleted for ${file.id}: ${file.s3Key}`
                );
              } else {
                logger.error(
                  `[Deal Checker] Failed to delete S3 file ${file.s3Key}: ${deleteResult.error}`
                );
              }
            }
          } else {
            logger.info(
              `[Deal Checker] Deal still in progress for ${file.id}: ${deal.dealStatus}`
            );
          }
        } else {
          logger.info(`[Deal Checker] No deal yet for ${file.cid}`);
        }
      } catch (fileError: any) {
        logger.error(
          `[Deal Checker] Error processing file ${file.id}: ${fileError.message}`
        );
      }
    }
  } catch (error: any) {
    logger.error(`[Deal Checker] Worker error: ${error.message}`);
  } finally {
    isRunning = false;
    logger.info("[Deal Checker] Processing cycle completed");
  }
};

let intervalId: NodeJS.Timeout | null = null;

/**
 * Start the deal checker worker
 */
export const startDealCheckerWorker = (): void => {
  if (!config.workers_enabled) {
    logger.info("[Deal Checker] Workers disabled, not starting");
    return;
  }

  const interval = config.deal_check_interval;

  logger.info(
    `[Deal Checker] Starting with interval: ${interval / 1000} seconds`
  );

  // Run immediately on start
  checkDealsAndCleanup();

  // Then run on interval
  intervalId = setInterval(checkDealsAndCleanup, interval);
};

/**
 * Stop the deal checker worker
 */
export const stopDealCheckerWorker = (): void => {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info("[Deal Checker] Stopped");
  }
};

/**
 * Manually trigger deal checking (for testing)
 */
export const triggerDealChecking = async (): Promise<void> => {
  await checkDealsAndCleanup();
};
