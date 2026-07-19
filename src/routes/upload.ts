import { Request, Response, NextFunction } from "express";
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
import { createFileRecord, nextExpiresAt } from "../utils/fileRecord.js";
import { getPaymentIdentity } from "../utils/paymentHeader.js";
import { uploadToLighthouse } from "../services/lighthouse.js";
import { createPaymentMiddleware, network, registerPendingSettlement } from "../payments/server.js";

function parseDeclaredSize(req: Request): number {
  const raw = (req.headers["content-length"] as string) || "";
  const size = parseInt(raw, 10);
  return Number.isFinite(size) ? size : 0;
}

/**
 * Validates the upload before the x402 middleware quotes a price, so clients
 * never sign a payment for a request that is doomed to be rejected.
 */
export const uploadPreflight = (req: Request, res: Response, next: NextFunction): void => {
  const declaredSize = parseDeclaredSize(req);

  if (declaredSize <= 0) {
    logger.warn("Upload rejected: missing or invalid Content-Length header");
    res.status(400).json({ error: "Content-Length header is required" });
    return;
  }

  if (declaredSize > config.maxFileSizeBytes) {
    const maxMB = Math.round(config.maxFileSizeBytes / (1024 * 1024));
    logger.warn("Upload rejected: file too large", {
      declaredSize,
      maxBytes: config.maxFileSizeBytes,
    });
    res.status(413).json({ error: `File exceeds maximum size of ${maxMB} MB` });
    return;
  }

  next();
};

export const x402UploadMiddleware = createPaymentMiddleware({
  "POST /api/upload": {
    accepts: [
      {
        scheme: "exact",
        network,
        payTo: config.recipientAddress,
        price: (ctx: { adapter: { getHeader: (name: string) => string | undefined } }) => {
          const contentLength = parseInt(ctx.adapter.getHeader("content-length") || "0", 10);
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
    // 1. Re-validate size (preflight already ran, but stay defensive)
    const declaredSize = parseDeclaredSize(req);
    if (declaredSize <= 0 || declaredSize > config.maxFileSizeBytes) {
      const maxMB = Math.round(config.maxFileSizeBytes / (1024 * 1024));
      res.status(400).json({
        error: `Content-Length must be between 1 byte and ${maxMB} MB`,
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
      res.status(413).json({
        error: `File exceeds maximum size of ${maxMB} MB`,
      });
      return;
    }

    // Reject if actual size doesn't match declared — prevents price manipulation
    if (actualSize > declaredSize) {
      await cleanupFile(tempPath);
      res.status(400).json({
        error: `Content-Length mismatch: declared ${declaredSize} bytes but received ${actualSize} bytes`,
      });
      return;
    }

    // 4. Extract payer identity from the payment header (same header the
    //    middleware already verified — see utils/paymentHeader.ts)
    const { payer: walletAddress, paymentKey } = getPaymentIdentity(req);
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

    // 8. Create the record unpaid (expiresAt = 0). The x402 middleware settles
    //    the payment before flushing this response; the onAfterSettle hook then
    //    stamps the tx hash and the first year's expiry. If settlement fails,
    //    the client gets a 402 instead of this response and the record stays
    //    unpaid — no storage is granted for a failed payment.
    logger.debug("Creating file record in DynamoDB", { walletAddress, cid: result.cid });
    const fileRecord = await createFileRecord(
      walletAddress,
      result.cid,
      actualSize,
      fileName,
      mimeType
    );

    const expiresAt = nextExpiresAt(0);
    registerPendingSettlement(paymentKey, {
      kind: "upload",
      recordId: fileRecord.id,
      expiresAt,
    });

    // 9. Return CID + renewal handle
    logger.info("Upload complete — returning response", {
      id: fileRecord.id,
      cid: result.cid,
      fileName,
      fileSizeBytes: actualSize,
      expiresAt,
      walletAddress,
    });
    res.json({
      success: true,
      id: fileRecord.id,
      cid: result.cid,
      fileName,
      mimeType,
      fileSizeBytes: actualSize,
      expiresAt,
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
  const size = parseInt((req.query.size as string) || "", 10);

  if (!Number.isFinite(size) || size <= 0) {
    res.status(400).json({
      error: "Provide 'size' query parameter (file size in bytes)",
    });
    return;
  }

  if (size > config.maxFileSizeBytes) {
    const maxMB = Math.round(config.maxFileSizeBytes / (1024 * 1024));
    res.status(400).json({
      error: `File exceeds maximum size of ${maxMB} MB`,
      maxFileSizeBytes: config.maxFileSizeBytes,
    });
    return;
  }

  const quote = calculatePriceQuote(size);

  res.json({
    fileSizeBytes: quote.fileSizeBytes,
    fileSizeMB: parseFloat((size / (1024 * 1024)).toFixed(4)),
    encodedSizeBytes: quote.encodedSizeBytes,
    encodedSizeMiB: parseFloat(quote.encodedSizeMiB.toFixed(4)),
    billableMiB: quote.billableMiB,
    pricePerMB: `$${quote.pricePerMb}`,
    facilitatorFee: `$${quote.facilitatorFee.toFixed(6)}`,
    totalPrice: quote.totalPrice,
    storagePeriodDays: config.storagePeriodDays,
    network: config.network,
    payTo: config.recipientAddress,
  });
};
