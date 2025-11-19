import express from "express";
import { paymentMiddleware, Network } from "x402-express";
import { x402_upload } from "../controller/x402/upload.js";
import { dynamicPricingMiddleware } from "../middlewares/x402.js";
import { x402RetryValidationMiddleware } from "../middlewares/x402Retry.js";
import config from "../config/index.js";
import CustomError from "../middlewares/error/customError.js";

const router = express.Router();

const X402_RECIPIENT_ADDRESS = config.x402_recipient_address as `0x${string}`;
const X402_FACILITATOR_URL =
  config.x402_facilitator_url as `${string}://${string}`;
const X402_NETWORK = config.x402_network as Network;

const x402PaymentMiddleware = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void => {
  try {
    if (!X402_RECIPIENT_ADDRESS) {
      return next(
        new CustomError(500, "X402_RECIPIENT_ADDRESS not configured")
      );
    }

    const priceInDollars = (req as any).x402CalculatedPrice || "$0.0001";

    const priceNumber = parseFloat(priceInDollars.replace("$", ""));
    if (isNaN(priceNumber) || priceNumber < 0.0001) {
      return next(
        new CustomError(
          400,
          `Invalid price: ${priceInDollars}. Price must be at least $0.0001`
        )
      );
    }

    const dynamicPaymentMiddleware = paymentMiddleware(
      X402_RECIPIENT_ADDRESS,
      {
        "POST /api/x402/upload": {
          price: priceInDollars,
          network: X402_NETWORK,
          config: {
            description: "Pay-per-use file upload to IPFS",
          },
        },
      },
      {
        url: X402_FACILITATOR_URL,
      }
    );

    try {
      dynamicPaymentMiddleware(req, res, (err?: any) => {
        if (err) {
          const errorMessage =
            err.message || err.toString() || "Payment validation failed";
          return next(new CustomError(400, errorMessage));
        }

        const paymentHeader = req.header("X-PAYMENT");
        if (paymentHeader) {
          try {
            const paymentJson = Buffer.from(paymentHeader, "base64").toString(
              "utf-8"
            );
            const paymentData = JSON.parse(paymentJson);

            const payerAddress = paymentData?.payload?.authorization?.from;
            const signature = paymentData?.payload?.signature;
            const nonce = paymentData?.payload?.authorization?.nonce;

            const crypto = require("crypto");
            const paymentTxHash = signature
              ? `0x${crypto.createHash("sha256").update(signature).digest("hex")}`
              : `payment_${nonce || Date.now()}`;

            (req as any).x402PaymentTxHash = paymentTxHash;
            if (payerAddress) {
              (req as any).x402Payer = payerAddress;
            }
            if (signature) {
              (req as any).x402PaymentSignature = signature;
            }
            if (nonce) {
              (req as any).x402PaymentNonce = nonce;
            }
          } catch (decodeError: any) {
            const crypto = require("crypto");
            const paymentHash = crypto
              .createHash("sha256")
              .update(paymentHeader)
              .digest("hex");
            (req as any).x402PaymentTxHash =
              `payment_${paymentHash.substring(0, 16)}`;
          }
        }

        return next();
      });
    } catch (syncError: any) {
      const errorMessage =
        syncError.message ||
        syncError.toString() ||
        "Payment validation failed";
      return next(new CustomError(400, errorMessage));
    }
  } catch (error: any) {
    const errorMessage =
      error.message || error.toString() || "Payment middleware error";
    next(new CustomError(500, errorMessage));
  }
};

router.post(
  "/upload",
  express.raw({ type: "application/octet-stream", limit: "10gb" }),
  dynamicPricingMiddleware,
  x402PaymentMiddleware,
  x402_upload
);

router.post(
  "/retry-upload",
  express.raw({ type: "application/octet-stream", limit: "10gb" }),
  x402RetryValidationMiddleware,
  dynamicPricingMiddleware,
  x402_upload
);

export default router;
