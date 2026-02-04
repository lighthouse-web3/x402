import express from "express";
import { x402_upload } from "../controller/x402/upload.js";
import { dynamicPricingMiddleware } from "../middlewares/x402.js";
import { x402RetryValidationMiddleware } from "../middlewares/x402Retry.js";
import { customPaymentMiddleware } from "../middlewares/customPayment.js";
import config from "../config/index.js";

const router = express.Router();

const X402_RECIPIENT_ADDRESS = config.x402_recipient_address as `0x${string}`;
const X402_NETWORK = config.x402_network; // e.g., "base-sepolia"

// Validate configuration on startup
if (!X402_RECIPIENT_ADDRESS) {
  console.error("WARNING: X402_RECIPIENT_ADDRESS not configured");
}

/**
 * Custom x402 payment middleware
 * - Without X-PAYMENT header: Returns 402 Payment Required
 * - With X-PAYMENT header: Verifies payment and allows upload
 */
const x402PaymentMiddleware = customPaymentMiddleware(X402_RECIPIENT_ADDRESS, {
  "POST /api/x402/upload": {
    price: "$0.01", // Default price, overridden by dynamicPricingMiddleware
    network: X402_NETWORK,
    description: "Create Filecoin Deal",
    resourceUrl: "https://x402.lighthouse.storage/upload",
  },
});

/**
 * POST /api/x402/upload
 *
 * Upload a file with x402 payment
 *
 * Without X-PAYMENT header:
 * Returns 402 with payment requirements
 *
 * With X-PAYMENT header (Base64 encoded):
 * Verifies payment and processes upload
 */
router.post(
  "/upload",
  express.raw({ type: "application/octet-stream", limit: "4gb" }),
  dynamicPricingMiddleware,
  x402PaymentMiddleware,
  x402_upload
);

/**
 * POST /api/x402/retry-upload
 *
 * Retry a failed upload using existing payment
 *
 * Required: paymentTxHash as query param or x-payment-tx-hash header
 */
router.post(
  "/retry-upload",
  express.raw({ type: "application/octet-stream", limit: "4gb" }),
  x402RetryValidationMiddleware,
  dynamicPricingMiddleware,
  x402_upload
);

export default router;
