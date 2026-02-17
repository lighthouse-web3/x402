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
import { calculatePrice } from "../utils/pricing.js";
import { createFileRecord } from "../utils/fileRecord.js";
import { uploadToLighthouse } from "../services/lighthouse.js";

const network = config.network as Network;

const facilitatorClient = new HTTPFacilitatorClient({
  url: config.facilitatorUrl,
});

const resourceServer = new x402ResourceServer(facilitatorClient).register(
  network,
  new ExactEvmScheme()
);

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
            return calculatePrice(contentLength);
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
      res.status(400).json({
        error: "Content-Length header is required",
      });
      return;
    }

    if (declaredSize > config.maxFileSizeBytes) {
      const maxMB = Math.round(config.maxFileSizeBytes / (1024 * 1024));
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

    // 4. Extract wallet address and tx hash from payment header
    let walletAddress = "unknown";
    let txHash = "";
    const paymentHeader = req.header("payment-signature") || req.header("x-payment");
    if (paymentHeader) {
      try {
        const decoded = JSON.parse(Buffer.from(paymentHeader, "base64").toString());
        walletAddress = decoded.payer || decoded.payload?.authorization?.from || "unknown";
        txHash = decoded.transaction || decoded.payload?.authorization?.signature || "";
      } catch {
        // already verified by middleware
      }
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
    console.log(`[Upload] ${fileName} (${actualSize} bytes) → Lighthouse…`);
    const result = await uploadToLighthouse(tempPath);
    console.log(`[Upload] Done — CID: ${result.cid}`);

    // 7. Clean up temp file
    await cleanupFile(tempPath);

    // 8. Create user record
    const fileRecord = await createFileRecord(
      walletAddress,
      result.cid,
      actualSize,
      fileName,
      mimeType,
      txHash
    );

    // 9. Return CID
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
    console.error("[Upload] Error:", message);
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
  const sizeMB = size / (1024 * 1024);

  res.json({
    fileSizeBytes: size,
    fileSizeMB: parseFloat(sizeMB.toFixed(4)),
    pricePerMB: `$${config.pricePerMb}`,
    totalPrice: price,
    network: config.network,
    payTo: config.recipientAddress,
  });
};
