import { Request, Response, NextFunction } from "express";
import { ethers } from "ethers";
import crypto from "crypto";
import CustomError from "./error/customError.js";
import config from "../config/index.js";
import {
  NetworkId,
  NETWORK_TO_EIP155,
  USDC_ADDRESSES,
  PaymentPayload,
  PaymentRequiredResponse,
  X402RouteConfig,
} from "../types/x402.js";
import { verifyPayment } from "../services/blockchain/paymentVerification.js";

// ============================================
// Helper Functions
// ============================================

/**
 * Generate a unique payment ID (UUID v4)
 */
export const generatePaymentId = (): string => {
  return crypto.randomUUID();
};

/**
 * Convert network name to EIP-155 format
 */
export const getNetworkId = (networkName: string): NetworkId => {
  return NETWORK_TO_EIP155[networkName] || ("eip155:84532" as NetworkId);
};

/**
 * Decode the X-PAYMENT header from Base64
 */
export const decodePaymentHeader = (header: string): PaymentPayload => {
  try {
    const decoded = Buffer.from(header, "base64").toString("utf-8");
    return JSON.parse(decoded);
  } catch {
    throw new CustomError(400, "Invalid X-PAYMENT header format");
  }
};

/**
 * Validate payment payload structure
 */
export const validatePaymentPayload = (
  payment: PaymentPayload
): { valid: boolean; error?: string } => {
  if (!payment.success) {
    return { valid: false, error: "Payment was not successful" };
  }

  if (!payment.transaction || !payment.transaction.startsWith("0x")) {
    return { valid: false, error: "Invalid transaction hash" };
  }

  if (!payment.payer || !ethers.isAddress(payment.payer)) {
    return { valid: false, error: "Invalid payer address" };
  }

  if (!payment.network) {
    return { valid: false, error: "Network is required" };
  }

  if (!payment.requirements) {
    return { valid: false, error: "Payment requirements are required" };
  }

  if (!payment.requirements.payment_id) {
    return { valid: false, error: "Payment ID is required" };
  }

  return { valid: true };
};

/**
 * Validate payment amount
 */
export const validatePaymentAmount = (
  paidAmount: string,
  requiredAmount: string
): { valid: boolean; error?: string } => {
  try {
    const paid = BigInt(paidAmount);
    const required = BigInt(requiredAmount);

    if (paid < required) {
      return {
        valid: false,
        error: `Insufficient payment. Required: ${requiredAmount}, provided: ${paidAmount}`,
      };
    }

    return { valid: true };
  } catch {
    return { valid: false, error: "Invalid payment amount format" };
  }
};

/**
 * Validate recipient address matches
 */
export const validateRecipient = (
  paymentPayTo: string,
  expectedRecipient: string
): { valid: boolean; error?: string } => {
  if (paymentPayTo.toLowerCase() !== expectedRecipient.toLowerCase()) {
    return {
      valid: false,
      error: `Recipient mismatch. Expected ${expectedRecipient}, got ${paymentPayTo}`,
    };
  }
  return { valid: true };
};

/**
 * Validate network matches
 */
export const validateNetwork = (
  paymentNetwork: string,
  expectedNetwork: NetworkId
): { valid: boolean; error?: string } => {
  if (paymentNetwork !== expectedNetwork) {
    return {
      valid: false,
      error: `Network mismatch. Expected ${expectedNetwork}, got ${paymentNetwork}`,
    };
  }
  return { valid: true };
};

/**
 * Generate 402 Payment Required response
 */
export const generate402Response = (
  recipientAddress: string,
  amountRequired: string,
  networkId: NetworkId,
  resourceUrl: string,
  description: string
): PaymentRequiredResponse => {
  const usdcAddress = USDC_ADDRESSES[networkId];
  const paymentId = generatePaymentId();

  return {
    x402Version: 1,
    payment_id: paymentId,
    error: "Payment required",
    resource: {
      url: resourceUrl,
      description: description,
    },
    accepts: [
      {
        scheme: "exact",
        network: networkId,
        amount: amountRequired,
        asset: usdcAddress,
        payTo: recipientAddress,
        maxTimeoutSeconds: 300, // 5 minutes
      },
    ],
  };
};

// ============================================
// Main Payment Middleware
// ============================================

/**
 * Custom x402 payment middleware factory
 *
 * @param recipientAddress - Wallet address to receive payments
 * @param routes - Configuration for protected routes
 */
export const customPaymentMiddleware = (
  recipientAddress: `0x${string}`,
  routes: Record<string, X402RouteConfig>
) => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      // Build route key from method and path
      const routeKey = `${req.method} ${req.baseUrl}${req.path}`;
      const routeConfig = routes[routeKey];

      if (!routeConfig) {
        // No payment required for this route
        return next();
      }

      // Get the calculated price from dynamic pricing middleware
      const requiredAmount = (req as any).x402RequiredAmount;

      if (!requiredAmount) {
        return next(
          new CustomError(500, "Dynamic pricing middleware not configured")
        );
      }

      // Convert network name to EIP-155 format
      const networkId = getNetworkId(routeConfig.network);

      // Check for X-PAYMENT header
      const paymentHeader = req.header("X-PAYMENT");

      if (!paymentHeader) {
        // Return 402 Payment Required
        const paymentResponse = generate402Response(
          recipientAddress,
          requiredAmount,
          networkId,
          routeConfig.resourceUrl || "https://x402.lighthouse.storage/upload",
          routeConfig.description || "Create Filecoin Deal"
        );

        // Store the payment_id for potential later verification
        (req as any).x402PaymentId = paymentResponse.payment_id;

        res.status(402).json(paymentResponse);
        return;
      }

      // ========================================
      // Payment header present - verify payment
      // ========================================

      // 1. Decode the payment header
      const payment = decodePaymentHeader(paymentHeader);

      // 2. Validate payment payload structure
      const structureResult = validatePaymentPayload(payment);
      if (!structureResult.valid) {
        return next(new CustomError(400, structureResult.error!));
      }

      // 3. Validate network matches
      const networkResult = validateNetwork(payment.network, networkId);
      if (!networkResult.valid) {
        return next(new CustomError(400, networkResult.error!));
      }

      // 4. Validate recipient matches
      const recipientResult = validateRecipient(
        payment.requirements.payTo,
        recipientAddress
      );
      if (!recipientResult.valid) {
        return next(new CustomError(400, recipientResult.error!));
      }

      // 5. Validate amount (from header)
      const amountResult = validatePaymentAmount(
        payment.requirements.amount,
        requiredAmount
      );
      if (!amountResult.valid) {
        return next(new CustomError(400, amountResult.error!));
      }

      // ========================================
      // 6. ON-CHAIN VERIFICATION (if enabled)
      // ========================================

      if (config.payment_verification_enabled) {
        const verificationResult = await verifyPayment({
          txHash: payment.transaction,
          network: networkId,
          expectedFrom: payment.payer,
          expectedTo: recipientAddress,
          expectedAmount: requiredAmount,
          minConfirmations: config.payment_min_confirmations,
        });

        if (!verificationResult.success) {
          return next(
            new CustomError(
              500,
              `Payment verification failed: ${verificationResult.error}`
            )
          );
        }

        if (!verificationResult.verified) {
          return next(
            new CustomError(
              402,
              `Payment not verified on-chain: ${verificationResult.error}`
            )
          );
        }

        // Attach on-chain verification details
        (req as any).x402OnChainVerified = true;
        (req as any).x402VerificationDetails = verificationResult.details;
      }

      // ========================================
      // Payment verified - attach info to request
      // ========================================

      (req as any).x402Payment = payment;
      (req as any).x402PaymentTxHash = payment.transaction;
      (req as any).x402PaymentId = payment.requirements.payment_id;
      (req as any).x402Payer = payment.payer;
      (req as any).x402Network = payment.network;
      (req as any).x402Verified = true;

      // Proceed to next middleware/controller
      next();
    } catch (error: any) {
      if (error instanceof CustomError) {
        return next(error);
      }
      next(new CustomError(500, error.message || "Payment validation failed"));
    }
  };
};
