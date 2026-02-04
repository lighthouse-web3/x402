import { Request, Response, NextFunction } from "express";
import config from "../../config/index.js";
import { uploadToS3, generateS3Key } from "../../services/s3/wasabiClient.js";
import { createFileRecord } from "../../db/x402/fileTracking.js";
import {
  recordPayment,
  markPaymentFailed,
} from "../../db/x402/paymentTracking.js";
import CustomError from "../../middlewares/error/customError.js";

const MAX_FILE_SIZE = config.max_file_size_bytes; // 4GB default

export const x402_upload = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const paymentTxHash =
    (req as any).x402PaymentTxHash ||
    (req as any).x402Payment?.transaction ||
    (req as any).retryPaymentTxHash;

  const paymentId =
    (req as any).x402PaymentId ||
    (req as any).x402Payment?.requirements?.payment_id;

  const isRetry = !!(req as any).retryPaymentTxHash;

  try {
    // 1. Validate file buffer
    const fileBuffer = req.body;
    if (!fileBuffer || !Buffer.isBuffer(fileBuffer)) {
      throw new CustomError(400, "File buffer is required in request body");
    }

    // 2. Check file size
    if (fileBuffer.length > MAX_FILE_SIZE) {
      throw new CustomError(
        400,
        `File size exceeds maximum allowed size of ${MAX_FILE_SIZE / (1024 * 1024 * 1024)}GB`
      );
    }

    // 3. Get file metadata
    const fileName =
      (req.headers["x-file-name"] as string) || `upload-${Date.now()}.bin`;
    const mimeType =
      (req.headers["content-type"] as string) || "application/octet-stream";
    const fileSize = fileBuffer.length;

    // 4. Record payment (if not retry)
    if (!isRetry && paymentTxHash) {
      try {
        await recordPayment({
          paymentTxHash,
          requestId: paymentId,
          payerAddress: (req as any).x402Payer || "unknown",
          amount: (req as any).x402RequiredAmount || "0",
          priceInDollars: (req as any).x402CalculatedPrice || "$0.01",
        });
      } catch (recordError) {
        // Payment might already exist, continue
        console.log("Payment record may already exist:", recordError);
      }
    }

    // 5. Generate S3 key and upload to Wasabi
    const s3Key = generateS3Key(fileName, paymentId || paymentTxHash);

    console.log(`Uploading file to S3: ${fileName} (${fileSize} bytes)`);

    const s3Result = await uploadToS3(fileBuffer, s3Key, mimeType);

    if (!s3Result.success) {
      throw new CustomError(500, `S3 upload failed: ${s3Result.error}`);
    }

    console.log(`File uploaded to S3: ${s3Result.s3Url}`);

    // 6. Create file record in DynamoDB (matching Lighthouse schema)
    const fileRecord = await createFileRecord({
      paymentTxHash: paymentTxHash || "",
      payment_id: paymentId || "",
      fileName,
      fileSize,
      mimeType,
      s3Bucket: config.wasabi_bucket_name,
      s3Key: s3Result.s3Key,
      payerAddress: (req as any).x402Payer || "unknown",
      encryption: false, // Can be set based on user preference
      publicKey: undefined,
      dataPartition: undefined,
    });

    console.log(`File record created: ${fileRecord.id}`);

    // 7. Return success response
    res.status(200).json({
      success: true,
      id: fileRecord.id,
      fileName: fileRecord.fileName,
      fileSizeInBytes: fileRecord.fileSizeInBytes,
      storageStage: fileRecord.storageStage,
      blockStatus: fileRecord.blockStatus,
      sentForDeal: fileRecord.sentForDeal,
      s3Key: fileRecord.s3Key,
      createdAt: fileRecord.createdAt,
      message:
        "File uploaded to staging. IPFS upload will be processed shortly.",
      payment: {
        txHash: paymentTxHash,
        payment_id: paymentId,
        amount: (req as any).x402RequiredAmount,
        payer: (req as any).x402Payer,
      },
    });
  } catch (error: any) {
    console.error("Upload error:", error);

    // Mark payment as failed if we have a payment hash
    if (paymentTxHash) {
      try {
        await markPaymentFailed(
          paymentTxHash,
          error?.message || "Upload failed",
          isRetry
        );
      } catch (markError) {
        console.error("Failed to mark payment as failed:", markError);
      }
    }

    // Return error response
    const statusCode = error instanceof CustomError ? error.error?.code || 500 : 500;

    res.status(statusCode).json({
      success: false,
      error: "Upload failed",
      message: error?.message || "An error occurred during upload",
      ...(paymentTxHash && {
        paymentInfo: {
          paymentTxHash,
          retryEndpoint: "/api/x402/retry-upload",
          message:
            "Your payment was verified but upload failed. You can retry using the retry endpoint with the paymentTxHash.",
        },
      }),
    });
  }
};
