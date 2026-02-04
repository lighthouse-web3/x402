import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import config from "../../config/index.js";
import crypto from "crypto";

// Initialize Wasabi S3 Client
const s3Client = new S3Client({
  region: config.wasabi_region,
  endpoint: config.wasabi_endpoint,
  credentials: {
    accessKeyId: config.wasabi_access_key_id,
    secretAccessKey: config.wasabi_secret_access_key,
  },
  forcePathStyle: true, // Required for Wasabi
});

const BUCKET_NAME = config.wasabi_bucket_name;

/**
 * Generate a unique S3 key for a file
 */
export const generateS3Key = (
  fileName: string,
  paymentId: string
): string => {
  const timestamp = Date.now();
  const randomId = crypto.randomBytes(8).toString("hex");
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
  return `uploads/${paymentId}/${timestamp}-${randomId}-${sanitizedFileName}`;
};

/**
 * Upload a file buffer to Wasabi S3
 */
export const uploadToS3 = async (
  fileBuffer: Buffer,
  s3Key: string,
  contentType: string = "application/octet-stream"
): Promise<{
  success: boolean;
  s3Key: string;
  s3Url: string;
  error?: string;
}> => {
  try {
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: fileBuffer,
      ContentType: contentType,
    });

    await s3Client.send(command);

    const s3Url = `${config.wasabi_endpoint}/${BUCKET_NAME}/${s3Key}`;

    return {
      success: true,
      s3Key,
      s3Url,
    };
  } catch (error: any) {
    console.error("S3 upload error:", error);
    return {
      success: false,
      s3Key,
      s3Url: "",
      error: error.message || "Failed to upload to S3",
    };
  }
};

/**
 * Get a file from Wasabi S3
 */
export const getFromS3 = async (
  s3Key: string
): Promise<{
  success: boolean;
  data?: Buffer;
  error?: string;
}> => {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
    });

    const response = await s3Client.send(command);

    if (!response.Body) {
      return { success: false, error: "Empty response body" };
    }

    // Convert stream to buffer
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    const data = Buffer.concat(chunks);

    return { success: true, data };
  } catch (error: any) {
    console.error("S3 get error:", error);
    return {
      success: false,
      error: error.message || "Failed to get from S3",
    };
  }
};

/**
 * Delete a file from Wasabi S3
 */
export const deleteFromS3 = async (
  s3Key: string
): Promise<{
  success: boolean;
  error?: string;
}> => {
  try {
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
    });

    await s3Client.send(command);

    return { success: true };
  } catch (error: any) {
    console.error("S3 delete error:", error);
    return {
      success: false,
      error: error.message || "Failed to delete from S3",
    };
  }
};

/**
 * Check if a file exists in S3
 */
export const fileExistsInS3 = async (
  s3Key: string
): Promise<{
  exists: boolean;
  size?: number;
  error?: string;
}> => {
  try {
    const command = new HeadObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
    });

    const response = await s3Client.send(command);

    return {
      exists: true,
      size: response.ContentLength,
    };
  } catch (error: any) {
    if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) {
      return { exists: false };
    }
    return {
      exists: false,
      error: error.message || "Failed to check file existence",
    };
  }
};

/**
 * Generate a presigned URL for downloading a file
 */
export const getPresignedDownloadUrl = async (
  s3Key: string,
  expiresInSeconds: number = 3600 // 1 hour default
): Promise<{
  success: boolean;
  url?: string;
  error?: string;
}> => {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
    });

    const url = await getSignedUrl(s3Client, command, {
      expiresIn: expiresInSeconds,
    });

    return { success: true, url };
  } catch (error: any) {
    console.error("Presigned URL error:", error);
    return {
      success: false,
      error: error.message || "Failed to generate presigned URL",
    };
  }
};

export default s3Client;
