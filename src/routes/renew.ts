import { Request, Response } from "express";
import config from "../config.js";
import logger from "../utils/logger.js";
import { calculatePrice, calculatePriceQuote } from "../utils/pricing.js";
import { getPayerFromRequest } from "../utils/paymentHeader.js";
import { getFileRecordById, renewFileRecord } from "../db/fileRecord.js";
import { createPaymentMiddleware, network, pendingSettlements } from "../payments/server.js";

export const x402RenewMiddleware = createPaymentMiddleware({
  "POST /api/renew": {
    accepts: [
      {
        scheme: "exact",
        network,
        payTo: config.recipientAddress,
        price: async (ctx: { adapter: { getHeader: (name: string) => string | undefined } }) => {
          const fileId = ctx.adapter.getHeader("x-file-id") || "";
          if (!fileId) {
            throw new Error("x-file-id header is required");
          }

          const record = await getFileRecordById(fileId);
          if (!record) {
            throw new Error(`File record not found: ${fileId}`);
          }

          const price = calculatePrice(record.fileSizeInBytes);
          logger.debug("Calculated renew price", {
            fileId,
            fileSizeBytes: record.fileSizeInBytes,
            price,
          });
          return price;
        },
      },
    ],
    description: "Renew yearly storage for an existing file (no reupload)",
    mimeType: "application/json",
  },
});

export const renewHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const fileId = (req.headers["x-file-id"] as string | undefined)?.trim() || "";
    if (!fileId) {
      res.status(400).json({ error: "x-file-id header is required" });
      return;
    }

    const record = await getFileRecordById(fileId);
    if (!record) {
      res.status(404).json({ error: "File record not found", id: fileId });
      return;
    }

    const walletAddress = getPayerFromRequest(req);
    if (walletAddress === "unknown" || walletAddress.toLowerCase() !== record.publicKey) {
      logger.warn("Renew rejected: payer does not own file", {
        fileId,
        walletAddress,
        owner: record.publicKey,
      });
      res.status(403).json({
        error: "Only the original uploader can renew this file",
        id: fileId,
      });
      return;
    }

    const previousExpiresAt = record.expiresAt ?? 0;
    const renewed = await renewFileRecord(record);

    pendingSettlements.set(walletAddress.toLowerCase(), {
      recordId: renewed.id,
      publicKey: renewed.publicKey,
    });

    logger.info("File storage renewed", {
      id: renewed.id,
      cid: renewed.cid,
      previousExpiresAt,
      expiresAt: renewed.expiresAt,
      walletAddress,
    });

    res.json({
      success: true,
      id: renewed.id,
      cid: renewed.cid,
      fileName: renewed.fileName,
      fileSizeBytes: renewed.fileSizeInBytes,
      previousExpiresAt,
      expiresAt: renewed.expiresAt,
      storagePeriodDays: config.storagePeriodDays,
      publicKey: renewed.publicKey,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Renew failed";
    logger.error("Renew failed", { error: message });
    res.status(500).json({ error: "Renew failed", message });
  }
};

export const renewPriceHandler = async (req: Request, res: Response): Promise<void> => {
  const fileId = ((req.query.id as string) || "").trim();

  if (!fileId) {
    res.status(400).json({
      error: "Provide 'id' query parameter (file record id from upload)",
    });
    return;
  }

  const record = await getFileRecordById(fileId);
  if (!record) {
    res.status(404).json({ error: "File record not found", id: fileId });
    return;
  }

  const quote = calculatePriceQuote(record.fileSizeInBytes);

  res.json({
    id: record.id,
    cid: record.cid,
    fileName: record.fileName,
    fileSizeBytes: quote.fileSizeBytes,
    fileSizeMB: parseFloat((record.fileSizeInBytes / (1024 * 1024)).toFixed(4)),
    encodedSizeBytes: quote.encodedSizeBytes,
    encodedSizeMiB: parseFloat(quote.encodedSizeMiB.toFixed(4)),
    billableMiB: quote.billableMiB,
    pricePerMB: `$${quote.pricePerMb}`,
    facilitatorFee: `$${quote.facilitatorFee.toFixed(6)}`,
    totalPrice: quote.totalPrice,
    storagePeriodDays: config.storagePeriodDays,
    currentExpiresAt: record.expiresAt ?? null,
    network: config.network,
    payTo: config.recipientAddress,
  });
};
