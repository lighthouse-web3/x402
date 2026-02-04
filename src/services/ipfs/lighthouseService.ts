import lighthouse from "@lighthouse-web3/sdk";
import config from "../../config/index.js";
import logger from "../../utils/logger.js";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import crypto from "crypto";

const LIGHTHOUSE_API_KEY = config.lighthouse_api_key;
const LIGHTHOUSE_API_URL = config.lighthouse_api_url;

/**
 * Upload a buffer to IPFS via Lighthouse
 * @param fileBuffer - The file content as a Buffer
 * @param fileName - The name of the file
 * @returns Upload result with CID
 */
export const uploadToIPFS = async (
  fileBuffer: Buffer,
  fileName: string
): Promise<{
  success: boolean;
  cid?: string;
  ipfsUrl?: string;
  error?: string;
}> => {
  let tempFilePath: string | null = null;

  try {
    if (!LIGHTHOUSE_API_KEY) {
      return {
        success: false,
        error: "LIGHTHOUSE_API_KEY not configured",
      };
    }

    // Create a temporary file (Lighthouse SDK requires a file path)
    const randomId = crypto.randomBytes(8).toString("hex");
    tempFilePath = join(tmpdir(), `lighthouse-upload-${randomId}-${fileName}`);

    await writeFile(tempFilePath, fileBuffer);

    logger.info(`Uploading to IPFS via Lighthouse: ${fileName}`);

    // Upload to Lighthouse
    // Parameters: (path, apiKey, dealParameters, progressCallback)
    const response = await lighthouse.upload(
      tempFilePath,
      LIGHTHOUSE_API_KEY
    );

    // Clean up temp file
    if (tempFilePath) {
      try {
        await unlink(tempFilePath);
      } catch (cleanupError) {
        logger.warn(`Failed to clean up temp file: ${tempFilePath}`);
      }
    }

    if (!response || !response.data || !response.data.Hash) {
      return {
        success: false,
        error: "Invalid response from Lighthouse",
      };
    }

    const cid = response.data.Hash;
    const ipfsUrl = `https://gateway.lighthouse.storage/ipfs/${cid}`;

    logger.info(`File uploaded to IPFS: ${cid}`);

    return {
      success: true,
      cid,
      ipfsUrl,
    };
  } catch (error: any) {
    // Clean up temp file on error
    if (tempFilePath) {
      try {
        await unlink(tempFilePath);
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
    }

    logger.error(`IPFS upload error: ${error.message}`);

    return {
      success: false,
      error: error.message || "Failed to upload to IPFS",
    };
  }
};

/**
 * Check deal status for a CID
 * Reference: https://docs.lighthouse.storage/how-to/check-for-filecoin-deals
 * @param cid - The IPFS CID to check
 * @returns Deal status information
 */
export const checkDealStatus = async (
  cid: string
): Promise<{
  success: boolean;
  hasDeal: boolean;
  deals?: DealInfo[];
  error?: string;
}> => {
  try {
    const url = `${LIGHTHOUSE_API_URL}/api/lighthouse/deal_status?cid=${cid}`;

    const response = await fetch(url);

    if (!response.ok) {
      // 404 means no deals yet, which is valid
      if (response.status === 404) {
        return {
          success: true,
          hasDeal: false,
          deals: [],
        };
      }

      return {
        success: false,
        hasDeal: false,
        error: `API error: ${response.status} ${response.statusText}`,
      };
    }

    const data = await response.json();

    // Check if there are any deals
    if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
      return {
        success: true,
        hasDeal: false,
        deals: [],
      };
    }

    // Parse deal information
    const deals: DealInfo[] = data.data.map((deal: any) => ({
      dealId: deal.dealId || deal.chainDealID,
      chainDealID: deal.chainDealID,
      dealStatus: deal.dealStatus,
      miner: deal.miner || deal.storageProvider,
      pieceCID: deal.pieceCID,
      payloadCid: deal.payloadCid,
      startEpoch: deal.startEpoch,
      endEpoch: deal.endEpoch,
      dealUUID: deal.dealUUID,
    }));

    // Check if any deal is active/completed
    const hasActiveDeal = deals.some(
      (deal) =>
        deal.dealStatus &&
        (deal.dealStatus.includes("Active") ||
          deal.dealStatus.includes("Proving") ||
          deal.dealStatus.includes("Sealing"))
    );

    logger.info(`Deal status for ${cid}: ${deals.length} deals found, active: ${hasActiveDeal}`);

    return {
      success: true,
      hasDeal: hasActiveDeal,
      deals,
    };
  } catch (error: any) {
    logger.error(`Deal status check error: ${error.message}`);

    return {
      success: false,
      hasDeal: false,
      error: error.message || "Failed to check deal status",
    };
  }
};

/**
 * Deal information from Lighthouse API
 */
export interface DealInfo {
  dealId: number;
  chainDealID: number;
  dealStatus: string;
  miner: string;
  pieceCID: string;
  payloadCid: string;
  startEpoch: number;
  endEpoch: number;
  dealUUID: string;
}
