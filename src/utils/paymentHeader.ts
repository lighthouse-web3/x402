import { Request } from "express";
import logger from "./logger.js";

/** Decode payer wallet from the x402 payment signature header. */
export function getPayerFromRequest(req: Request): string {
  const paymentHeader = req.header("payment-signature") || req.header("x-payment");
  if (!paymentHeader) {
    logger.warn("No payment header found on paid request");
    return "unknown";
  }

  try {
    const decoded = JSON.parse(Buffer.from(paymentHeader, "base64").toString());
    return (
      decoded.payload?.authorization?.from ||
      decoded.payload?.permit2Authorization?.from ||
      "unknown"
    );
  } catch (err) {
    logger.warn("Failed to decode payment header (already verified by middleware)", {
      error: err instanceof Error ? err.message : String(err),
    });
    return "unknown";
  }
}
