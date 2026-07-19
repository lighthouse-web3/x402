import { Request } from "express";
import logger from "./logger.js";

export interface PaymentIdentity {
  /** Payer wallet address (lowercase), or "unknown" if it could not be decoded. */
  payer: string;
  /**
   * Unique key for this specific payment: the EIP-3009 / Permit2 authorization
   * nonce when present, otherwise a hash of the raw payment header. Used to
   * correlate the request with its settlement without cross-wiring concurrent
   * payments from the same wallet.
   */
  paymentKey: string;
}

interface DecodedPayload {
  authorization?: { from?: string; nonce?: string };
  permit2Authorization?: { from?: string; nonce?: string };
}

/** Build the settlement-correlation key from a decoded x402 payment payload. */
export function paymentKeyFromPayload(payload: DecodedPayload | undefined, payer: string): string {
  const nonce = payload?.authorization?.nonce || payload?.permit2Authorization?.nonce || "";
  return `${payer.toLowerCase()}:${nonce}`;
}

/**
 * Decode payer identity from the x402 payment header.
 *
 * Header precedence (payment-signature, then x-payment) matches
 * @x402/express exactly, so the payload decoded here is byte-identical to the
 * one the middleware already verified with the facilitator — the `from`
 * address is signature-checked and cannot be forged via a second header.
 */
export function getPaymentIdentity(req: Request): PaymentIdentity {
  const paymentHeader = req.header("payment-signature") || req.header("x-payment");
  if (!paymentHeader) {
    logger.warn("No payment header found on paid request");
    return { payer: "unknown", paymentKey: "" };
  }

  try {
    const decoded = JSON.parse(Buffer.from(paymentHeader, "base64").toString()) as {
      payload?: DecodedPayload;
    };
    const payer = (
      decoded.payload?.authorization?.from ||
      decoded.payload?.permit2Authorization?.from ||
      "unknown"
    ).toLowerCase();

    if (payer === "unknown") {
      return { payer, paymentKey: "" };
    }

    return { payer, paymentKey: paymentKeyFromPayload(decoded.payload, payer) };
  } catch (err) {
    logger.warn("Failed to decode payment header (already verified by middleware)", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { payer: "unknown", paymentKey: "" };
  }
}
