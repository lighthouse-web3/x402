import { Request, Response, NextFunction } from "express";
import { checkPaymentStatus, canRetry } from "../db/x402/paymentTracking.js";
import {
  calculatePrice,
  formatPriceForX402,
} from "../controller/x402/helper/pricing.js";
import CustomError from "./error/customError.js";

export const x402RetryValidationMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const paymentTxHash =
      (req.query.paymentTxHash as string) ||
      (req.headers["x-payment-tx-hash"] as string);

    if (!paymentTxHash) {
      return next(
        new CustomError(
          400,
          "paymentTxHash is required. Provide it as query parameter or x-payment-tx-hash header."
        )
      );
    }

    const payment = await checkPaymentStatus(paymentTxHash);

    if (!payment) {
      return next(
        new CustomError(
          404,
          "Payment not found. This payment transaction was not found in our records."
        )
      );
    }

    if (payment.status === "completed") {
      return next(
        new CustomError(
          400,
          `Payment already used. This payment has already been used for a successful upload. CID: ${payment.cid}`
        )
      );
    }

    if (payment.status !== "failed") {
      return next(
        new CustomError(
          400,
          `Invalid payment status. Payment status is ${payment.status}. Only failed payments can be retried.`
        )
      );
    }

    if (!canRetry(payment)) {
      return next(
        new CustomError(
          400,
          `Retry limit exceeded. Maximum retry attempts (${payment.maxRetries}) exceeded for this payment.`
        )
      );
    }

    let fileSize = 0;
    if (req.body && Buffer.isBuffer(req.body)) {
      fileSize = req.body.length;
    } else {
      return next(
        new CustomError(
          400,
          "File data is required. Request body must contain the file to upload."
        )
      );
    }

    if (fileSize > 0) {
      const currentFileAmount = calculatePrice(fileSize);
      const currentFilePrice = formatPriceForX402(currentFileAmount);

      if (currentFileAmount !== payment.amount) {
        return next(
          new CustomError(
            400,
            `File size mismatch. The file you are uploading (${currentFilePrice}, ${fileSize} bytes) does not match the original payment (${payment.priceInDollars}). Please use the same file or make a new payment for this file size.`
          )
        );
      }
    } else {
      return next(
        new CustomError(400, "File size is zero. Cannot process empty file.")
      );
    }

    (req as any).retryPaymentTxHash = paymentTxHash;
    (req as any).x402RequiredAmount = payment.amount;
    (req as any).x402CalculatedPrice = payment.priceInDollars;
    (req as any).x402Payer = payment.payerAddress;
    (req as any).existingPayment = payment;

    next();
  } catch (error) {
    next(error);
  }
};
