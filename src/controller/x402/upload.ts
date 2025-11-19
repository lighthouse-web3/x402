import { Request, Response, NextFunction } from "express";
import lighthouse from "@lighthouse-web3/sdk";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import config from "../../config/index.js";

import {
  recordPayment,
  markPaymentCompleted,
  markPaymentFailed,
} from "../../db/x402/paymentTracking.js";

export const x402_upload = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  let tempFilePath: string | null = null;
  const paymentTxHash =
    (req as any).x402PaymentTxHash ||
    (req as any).x402Payment?.txHash ||
    (req as any).x402Payment?.transactionHash ||
    (req as any).x402Payment?.hash ||
    (req as any).x402RequestId ||
    (req as any).retryPaymentTxHash;
  const isRetry = !!(req as any).retryPaymentTxHash;

  try {
    if (!isRetry) {
      if (paymentTxHash) {
        try {
          await recordPayment({
            paymentTxHash,
            requestId: (req as any).x402RequestId,
            payerAddress:
              (req as any).x402Payer ||
              (req as any).x402Payment?.payer ||
              "unknown",
            amount: (req as any).x402RequiredAmount || "0",
            priceInDollars: (req as any).x402CalculatedPrice || "$0.01",
          });
        } catch (recordError) {}
      }
    }

    const fileBuffer = req.body;
    if (!fileBuffer || !Buffer.isBuffer(fileBuffer)) {
      throw new Error("File buffer is required in request body");
    }

    const fileName =
      (req.headers["x-file-name"] as string) || `upload-${Date.now()}.bin`;

    tempFilePath = join(
      tmpdir(),
      `lighthouse-upload-${Date.now()}-${fileName}`
    );

    await writeFile(tempFilePath, fileBuffer as Uint8Array);

    const apiKey = config.lighthouse_api_key;
    const response = await lighthouse.upload(
      tempFilePath,
      apiKey,
      1,
      (progress: any) => {
        console.log(`Upload progress: ${progress.progress.toFixed(2)}%`);
      }
    );
    console.log(response);

    console.log(
      "Visit at: https://gateway.lighthouse.storage/ipfs/" + response.data.Hash
    );

    if (tempFilePath) {
      try {
        await unlink(tempFilePath);
      } catch (cleanupError) {}
    }

    if (paymentTxHash) {
      try {
        await markPaymentCompleted(paymentTxHash, response.data.Hash);
      } catch (markError) {}
    }

    res.status(200).json({
      name: response.data.Name,
      cid: response.data.Hash,
      amount: (req as any).x402RequiredAmount,
    });
  } catch (error: any) {
    if (tempFilePath) {
      try {
        await unlink(tempFilePath);
      } catch (cleanupError) {}
    }

    if (paymentTxHash) {
      try {
        await markPaymentFailed(
          paymentTxHash,
          error?.message || "Upload failed",
          isRetry
        );
      } catch (markError) {}
    }

    const paymentInfo = paymentTxHash
      ? {
          paymentTxHash,
          retryEndpoint: "/api/x402/retry-upload",
          message:
            "Your payment was verified but upload failed. You can retry using the retry endpoint with the paymentTxHash.",
        }
      : null;

    res.status(500).json({
      error: "Upload failed",
      message: error?.message || "An error occurred during upload",
      ...(paymentInfo && { paymentInfo }),
    });

    next(error);
  }
};
