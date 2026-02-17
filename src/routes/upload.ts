import { Request, Response } from "express";
import { paymentMiddleware, x402ResourceServer, Network } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { createWriteStream } from "fs";
import { stat, unlink } from "fs/promises";
import { pipeline } from "stream/promises";
import { join } from "path";
import { tmpdir } from "os";
import crypto from "crypto";
import { fileTypeFromFile } from "file-type";
import config from "../config.js";
import logger from "../utils/logger.js";
import { calculatePrice } from "../utils/pricing.js";
import { createFileRecord } from "../utils/fileRecord.js";
import { updateFileRecordTxHash } from "../db/fileRecord.js";
import { uploadToLighthouse } from "../services/lighthouse.js";

const network = config.network as Network;

logger.info("Initializing x402 payment middleware", {
  network,
  facilitatorUrl: config.facilitatorUrl,
  recipientAddress: config.recipientAddress,
});

const facilitatorClient = new HTTPFacilitatorClient({
  url: config.facilitatorUrl,
});

const resourceServer = new x402ResourceServer(facilitatorClient).register(
  network,
  new ExactEvmScheme()
);

// Map payer address → file record ID so the settlement hook can update the DB
// with the real tx hash (which only exists after the facilitator settles on-chain).
const pendingSettlements = new Map<string, { recordId: string; publicKey: string }>();

resourceServer.onAfterSettle(async (context) => {
  const payer =
    (context.result.payer as string | undefined) ||
    (context.paymentPayload.payload as Record<string, Record<string, string>>)?.authorization
      ?.from ||
    (context.paymentPayload.payload as Record<string, Record<string, string>>)?.permit2Authorization
      ?.from ||
    "";

  const txHash = context.result.transaction || "";
  const payerKey = payer.toLowerCase();

  logger.info("Payment settled on-chain", {
    payer,
    txHash,
    success: context.result.success,
    network: context.requirements.network,
  });

  const pending = pendingSettlements.get(payerKey);
  if (pending && txHash) {
    try {
      await updateFileRecordTxHash(pending.recordId, txHash);
      logger.info("File record updated with tx hash", {
        recordId: pending.recordId,
        txHash,
      });
    } catch (err) {
      logger.error("Failed to update file record with tx hash", {
        recordId: pending.recordId,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      pendingSettlements.delete(payerKey);
    }
  } else if (!pending) {
    logger.warn("Settlement completed but no pending file record found", { payer, txHash });
  }
});

export const x402Middleware = paymentMiddleware(
  {
    "POST /api/upload": {
      accepts: [
        {
          scheme: "exact",
          network,
          payTo: config.recipientAddress,
          price: (ctx) => {
            const contentLength = parseInt(ctx.adapter.getHeader("content-length") || "0");
            const price = calculatePrice(contentLength);
            logger.debug("Calculated upload price", { contentLength, price });
            return price;
          },
        },
      ],
      description: "Upload file to Lighthouse IPFS storage",
      mimeType: "application/json",
    },
  },
  resourceServer
);

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
    //    Note: The PAYMENT-SIGNATURE header contains an off-chain signed
    //    authorization (EIP-3009 / Permit2), NOT a transaction hash.
    //    The real on-chain tx hash is created during settlement, which
    //    happens AFTER this handler completes. The onAfterSettle hook
    //    updates the DB record with the real tx hash.
    let walletAddress = "unknown";
    const paymentHeader = req.header("payment-signature") || req.header("x-payment");
    if (paymentHeader) {
      logger.debug("Payment header present, decoding payer info");
      try {
        const decoded = JSON.parse(Buffer.from(paymentHeader, "base64").toString());
        walletAddress =
          decoded.payload?.authorization?.from ||
          decoded.payload?.permit2Authorization?.from ||
          "unknown";
        logger.info("Payment authorization from payer", { walletAddress });
      } catch (err) {
        logger.warn("Failed to decode payment header (already verified by middleware)", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      logger.warn(
        "No payment header found on upload request — this should not happen after x402 middleware"
      );
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

    // 9. Return CID
    logger.info("Upload complete — returning response", {
      cid: result.cid,
      fileName,
      fileSizeBytes: actualSize,
      walletAddress,
    });
    res.json({
      success: true,
      cid: result.cid,
      fileName,
      mimeType,
      fileSizeBytes: actualSize,
      publicKey: fileRecord.publicKey,
      ipfsUrl: `https://gateway.lighthouse.storage/ipfs/${result.cid}`,
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

  const price = calculatePrice(size);
  const rawMB = size / (1024 * 1024);
  const billableMB = Math.max(rawMB, 1);

  res.json({
    fileSizeBytes: size,
    fileSizeMB: parseFloat(rawMB.toFixed(4)),
    billableMB: parseFloat(billableMB.toFixed(4)),
    pricePerMB: `$${config.pricePerMb}`,
    totalPrice: price,
    network: config.network,
    payTo: config.recipientAddress,
  });
};
