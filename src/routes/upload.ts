import { Request, Response } from "express";
import { createWriteStream } from "fs";
import { stat, unlink } from "fs/promises";
import { pipeline } from "stream/promises";
import { join } from "path";
import { tmpdir } from "os";
import crypto from "crypto";
import { fileTypeFromFile } from "file-type";
import config from "../config.js";
import logger from "../utils/logger.js";
import { calculatePrice, calculatePriceQuote } from "../utils/pricing.js";
import { createFileRecord } from "../utils/fileRecord.js";
import { getPayerFromRequest } from "../utils/paymentHeader.js";
import { uploadToLighthouse } from "../services/lighthouse.js";
import { createPaymentMiddleware, network, pendingSettlements } from "../payments/server.js";

export const x402UploadMiddleware = createPaymentMiddleware({
  "POST /api/upload": {
    accepts: [
      {
        scheme: "exact",
        network,
        payTo: config.recipientAddress,
        price: (ctx: { adapter: { getHeader: (name: string) => string | undefined } }) => {
          const contentLength = parseInt(ctx.adapter.getHeader("content-length") || "0");
          const price = calculatePrice(contentLength);
          logger.debug("Calculated upload price", { contentLength, price });
          return price;
        },
      },
    ],
    description: "Upload file to Lighthouse IPFS storage (first year included)",
    mimeType: "application/json",
  },
});

// Back-compat alias used by app.ts historically
export const x402Middleware = x402UploadMiddleware;

function tempFilePath(): string {
  return join(tmpdir(), `lh-upload-${crypto.randomBytes(8).toString("hex")}`);
}

async function cleanupFile(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {
    // ignore — file may not exist
  }
}

export const uploadHandler = async (req: Request, res: Response): Promise<void> => {
  const tempPath = tempFilePath();

  try {
    // 1. Require Content-Length (needed for accurate pricing)
    const declaredSize = parseInt((req.headers["content-length"] as string) || "0");
    if (declaredSize <= 0) {
      logger.warn("Upload rejected: missing Content-Length header");
      res.status(400).json({
        error: "Content-Length header is required",
      });
      return;
    }

    if (declaredSize > config.maxFileSizeBytes) {
      const maxMB = Math.round(config.maxFileSizeBytes / (1024 * 1024));
      logger.warn("Upload rejected: file too large", {
        declaredSize,
        maxBytes: config.maxFileSizeBytes,
      });
      res.status(400).json({
        error: `File exceeds maximum size of ${maxMB} MB`,
      });
      return;
    }

    // 2. Stream request body → temp file (no memory buffering)
    await pipeline(req, createWriteStream(tempPath));

    // 3. Validate actual size matches Content-Length
    const fileStats = await stat(tempPath);
    const actualSize = fileStats.size;

    if (actualSize === 0) {
      await cleanupFile(tempPath);
      res.status(400).json({ error: "File data is required in request body" });
      return;
    }

    if (actualSize > config.maxFileSizeBytes) {
      await cleanupFile(tempPath);
      const maxMB = Math.round(config.maxFileSizeBytes / (1024 * 1024));
      res.status(400).json({
        error: `File exceeds maximum size of ${maxMB} MB`,
      });
      return;
    }

    // Reject if actual size doesn't match declared — prevents price manipulation
    if (declaredSize > 0 && actualSize > declaredSize) {
      await cleanupFile(tempPath);
      res.status(400).json({
        error: `Content-Length mismatch: declared ${declaredSize} bytes but received ${actualSize} bytes`,
      });
      return;
    }

    // 4. Extract wallet address from payment header
    const walletAddress = getPayerFromRequest(req);
    if (walletAddress !== "unknown") {
      logger.info("Payment authorization from payer", { walletAddress });
    }

    // 5. Determine file name
    const fileName = (req.headers["x-file-name"] as string) || `upload-${Date.now()}.bin`;

    // 5b. Detect MIME type from temp file (magic bytes)
    const typeResult = await fileTypeFromFile(tempPath);
    const mimeType =
      typeResult?.mime ??
      (req.headers["content-type"] as string | undefined) ??
      "application/octet-stream";

    // 6. Upload to Lighthouse directly from temp file (no memory copy)
    logger.info("Uploading file to Lighthouse", { fileName, fileSizeBytes: actualSize });
    const result = await uploadToLighthouse(tempPath);
    logger.info("Lighthouse upload complete", { fileName, cid: result.cid });

    // 7. Clean up temp file
    await cleanupFile(tempPath);

    // 8. Create user record (txHash is empty — updated by onAfterSettle hook)
    logger.debug("Creating file record in DynamoDB", { walletAddress, cid: result.cid });
    const fileRecord = await createFileRecord(
      walletAddress,
      result.cid,
      actualSize,
      fileName,
      mimeType
    );

    // Register so the onAfterSettle hook can update this record with the real tx hash
    if (walletAddress !== "unknown") {
      pendingSettlements.set(walletAddress.toLowerCase(), {
        recordId: fileRecord.id,
        publicKey: fileRecord.publicKey,
      });
    }

    // 9. Return CID + renewal handle
    logger.info("Upload complete — returning response", {
      id: fileRecord.id,
      cid: result.cid,
      fileName,
      fileSizeBytes: actualSize,
      expiresAt: fileRecord.expiresAt,
      walletAddress,
    });
    res.json({
      success: true,
      id: fileRecord.id,
      cid: result.cid,
      fileName,
      mimeType,
      fileSizeBytes: actualSize,
      expiresAt: fileRecord.expiresAt,
      storagePeriodDays: config.storagePeriodDays,
      publicKey: fileRecord.publicKey,
      ipfsUrl: `https://gateway-walrus.lighthouse.storage/ipfs/${result.cid}`,
    });
  } catch (error: unknown) {
    await cleanupFile(tempPath);
    const message = error instanceof Error ? error.message : "Upload failed";
    logger.error("Upload failed", { error: message });
    res.status(500).json({ error: "Upload failed", message });
  }
};

export const priceHandler = (req: Request, res: Response): void => {
  const size = parseInt((req.query.size as string) || "0");

  if (size <= 0) {
    res.status(400).json({
      error: "Provide 'size' query parameter (file size in bytes)",
    });
    return;
  }

  const quote = calculatePriceQuote(size);

  res.json({
    fileSizeBytes: quote.fileSizeBytes,
    fileSizeMB: parseFloat((size / (1024 * 1024)).toFixed(4)),
    walrusEncodedSizeBytes: quote.walrusEncodedSizeBytes,
    walrusEncodedSizeMiB: parseFloat(quote.walrusEncodedSizeMiB.toFixed(4)),
    walrusStorageUnits: quote.walrusStorageUnits,
    storagePlan: `$${quote.storagePriceUsd}/${quote.billingPeriodLabel} for ${quote.storageQuotaGb} GB`,
    billableMiB: quote.billableMiB,
    pricePerMiB: `$${quote.pricePerMiB.toFixed(8)}`,
    facilitatorFee: `$${quote.facilitatorFee.toFixed(6)}`,
    totalPrice: quote.totalPrice,
    storagePeriodDays: config.storagePeriodDays,
    network: config.network,
    payTo: config.recipientAddress,
  });
};
