import ddbClient from "../db/ddbClient.js";
import logger from "../../utils/logger.js";
import config from "../../config/index.js";
import CustomError from "../../middlewares/error/customError.js";
import { X402FileRecord, BlockStatus } from "../../types/x402.js";
import crypto from "crypto";

const TABLE_NAME = config.x402_files_table;

/**
 * Generate a unique file ID (UUID)
 */
export const generateFileId = (): string => {
  return crypto.randomUUID();
};

/**
 * Get current ISO timestamp
 */
const getISOTimestamp = (): string => {
  return new Date().toISOString();
};

/**
 * Create a new file record
 */
export const createFileRecord = async (fileInfo: {
  paymentTxHash: string;
  payment_id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  s3Bucket: string;
  s3Key: string;
  payerAddress: string;
  encryption?: boolean;
  publicKey?: string;
  dataPartition?: string;
}): Promise<X402FileRecord> => {
  const id = generateFileId();
  const now = getISOTimestamp();

  const fileRecord: X402FileRecord = {
    id,
    blockStatus: "queued",
    cid: undefined,
    createdAt: now,
    dataPartition: fileInfo.dataPartition,
    encryption: fileInfo.encryption || false,
    fileName: fileInfo.fileName,
    fileSizeInBytes: fileInfo.fileSize,
    lastUpdate: now,
    mimeType: fileInfo.mimeType,
    publicKey: fileInfo.publicKey,
    sentForDeal: false,
    // x402 tracking fields
    paymentTxHash: fileInfo.paymentTxHash,
    payment_id: fileInfo.payment_id,
    s3Key: fileInfo.s3Key,
    s3Bucket: fileInfo.s3Bucket,
    payerAddress: fileInfo.payerAddress,
  };

  try {
    const params = {
      TableName: TABLE_NAME,
      Item: fileRecord,
      ConditionExpression: "attribute_not_exists(id)",
    };

    await ddbClient.put(params);
    logger.info(`Created file record: ${id}`);

    return fileRecord;
  } catch (error: any) {
    logger.error("Error creating file record: " + error);
    throw new CustomError(500, "Failed to create file record");
  }
};

/**
 * Get file record by id
 */
export const getFileById = async (
  id: string
): Promise<X402FileRecord | null> => {
  try {
    const params = {
      TableName: TABLE_NAME,
      Key: { id },
    };

    const result = await ddbClient.get(params);
    return (result.Item as X402FileRecord) || null;
  } catch (error) {
    logger.error("Error getting file record: " + error);
    throw new CustomError(500, "Failed to get file record");
  }
};

/**
 * Get file record by payment transaction hash
 */
export const getFileByPaymentTxHash = async (
  paymentTxHash: string
): Promise<X402FileRecord | null> => {
  try {
    const params = {
      TableName: TABLE_NAME,
      FilterExpression: "paymentTxHash = :txHash",
      ExpressionAttributeValues: {
        ":txHash": paymentTxHash,
      },
    };

    const result = await ddbClient.scan(params);
    if (result.Items && result.Items.length > 0) {
      return result.Items[0] as X402FileRecord;
    }
    return null;
  } catch (error) {
    logger.error("Error getting file by payment hash: " + error);
    throw new CustomError(500, "Failed to get file record");
  }
};

/**
 * Get all files with a specific blockStatus
 */
export const getFilesByStatus = async (
  status: BlockStatus
): Promise<X402FileRecord[]> => {
  try {
    const params = {
      TableName: TABLE_NAME,
      FilterExpression: "blockStatus = :status",
      ExpressionAttributeValues: {
        ":status": status,
      },
    };

    const result = await ddbClient.scan(params);
    return (result.Items as X402FileRecord[]) || [];
  } catch (error) {
    logger.error("Error getting files by status: " + error);
    throw new CustomError(500, "Failed to get files by status");
  }
};

/**
 * Get all files not yet sent for deal
 */
export const getFilesNotSentForDeal = async (): Promise<X402FileRecord[]> => {
  try {
    const params = {
      TableName: TABLE_NAME,
      FilterExpression:
        "blockStatus = :status AND sentForDeal = :sentForDeal AND attribute_exists(cid)",
      ExpressionAttributeValues: {
        ":status": "uploaded",
        ":sentForDeal": false,
      },
    };

    const result = await ddbClient.scan(params);
    return (result.Items as X402FileRecord[]) || [];
  } catch (error) {
    logger.error("Error getting files not sent for deal: " + error);
    throw new CustomError(500, "Failed to get files");
  }
};

/**
 * Update file status to uploading
 */
export const markFileUploading = async (id: string): Promise<void> => {
  try {
    const params = {
      TableName: TABLE_NAME,
      Key: { id },
      UpdateExpression: "SET blockStatus = :status, lastUpdate = :lastUpdate",
      ExpressionAttributeValues: {
        ":status": "uploading",
        ":lastUpdate": getISOTimestamp(),
      },
    };

    await ddbClient.update(params);
    logger.info(`File ${id} marked as uploading`);
  } catch (error) {
    logger.error("Error marking file as uploading: " + error);
    throw new CustomError(500, "Failed to update file status");
  }
};

/**
 * Update file with CID after IPFS upload
 */
export const markFileUploaded = async (
  id: string,
  cid: string
): Promise<void> => {
  try {
    const params = {
      TableName: TABLE_NAME,
      Key: { id },
      UpdateExpression:
        "SET blockStatus = :status, cid = :cid, lastUpdate = :lastUpdate",
      ExpressionAttributeValues: {
        ":status": "uploaded",
        ":cid": cid,
        ":lastUpdate": getISOTimestamp(),
      },
    };

    await ddbClient.update(params);
    logger.info(`File ${id} uploaded with CID: ${cid}`);
  } catch (error) {
    logger.error("Error marking file as uploaded: " + error);
    throw new CustomError(500, "Failed to update file with CID");
  }
};

/**
 * Mark file as sent for deal
 */
export const markFileSentForDeal = async (id: string): Promise<void> => {
  try {
    const params = {
      TableName: TABLE_NAME,
      Key: { id },
      UpdateExpression: "SET sentForDeal = :sentForDeal, lastUpdate = :lastUpdate",
      ExpressionAttributeValues: {
        ":sentForDeal": true,
        ":lastUpdate": getISOTimestamp(),
      },
    };

    await ddbClient.update(params);
    logger.info(`File ${id} marked as sent for deal`);
  } catch (error) {
    logger.error("Error marking file sent for deal: " + error);
    throw new CustomError(500, "Failed to update file deal status");
  }
};

/**
 * Mark file as failed
 */
export const markFileFailed = async (id: string, error?: string): Promise<void> => {
  try {
    const params = {
      TableName: TABLE_NAME,
      Key: { id },
      UpdateExpression: "SET blockStatus = :status, lastUpdate = :lastUpdate",
      ExpressionAttributeValues: {
        ":status": "failed",
        ":lastUpdate": getISOTimestamp(),
      },
    };

    await ddbClient.update(params);
    logger.info(`File ${id} marked as failed: ${error}`);
  } catch (error) {
    logger.error("Error marking file as failed: " + error);
    throw new CustomError(500, "Failed to update file status");
  }
};

/**
 * Clear S3 key after deletion (set to null/remove)
 */
export const clearS3Key = async (id: string): Promise<void> => {
  try {
    const params = {
      TableName: TABLE_NAME,
      Key: { id },
      UpdateExpression: "REMOVE s3Key, s3Bucket SET lastUpdate = :lastUpdate",
      ExpressionAttributeValues: {
        ":lastUpdate": getISOTimestamp(),
      },
    };

    await ddbClient.update(params);
    logger.info(`File ${id} S3 key cleared`);
  } catch (error) {
    logger.error("Error clearing S3 key: " + error);
    throw new CustomError(500, "Failed to clear S3 key");
  }
};

// ============================================
// Legacy function mappings for compatibility
// ============================================

/** @deprecated Use markFileUploading */
export const markFileUploadingToIpfs = markFileUploading;

/** @deprecated Use markFileUploaded */
export const markFileIpfsDone = markFileUploaded;

/** @deprecated Use markFileSentForDeal */
export const markFileDealDone = markFileSentForDeal;

/** @deprecated Use clearS3Key */
export const markS3Deleted = clearS3Key;

/** @deprecated Use markFileSentForDeal */
export const markFileDealPending = async (id: string, _dealId: string): Promise<void> => {
  // Deal ID not stored in this schema, just mark as sent
  await markFileSentForDeal(id);
};
