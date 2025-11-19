import dbbClient from "../db/ddbClient.js";
import logger from "../../utils/logger.js";
import config from "../../config/index.js";
import CustomError from "../../middlewares/error/customError.js";
import { X402PaymentRecord } from "../../types/x402.js";

export const recordPayment = async (paymentInfo: {
  paymentTxHash: string;
  requestId?: string;
  payerAddress: string;
  amount: string;
  priceInDollars: string;
}): Promise<void> => {
  try {
    const params = {
      TableName: config.x402_payment_table,
      Item: {
        paymentTxHash: paymentInfo.paymentTxHash,
        requestId: paymentInfo.requestId,
        payerAddress: paymentInfo.payerAddress,
        amount: paymentInfo.amount,
        priceInDollars: paymentInfo.priceInDollars,
        status: "pending",
        createdAt: Date.now(),
        retryCount: 0,
        maxRetries: 3,
      },
      ConditionExpression: "attribute_not_exists(paymentTxHash)",
    };

    await dbbClient.put(params);
    logger.info(`Recorded x402 payment: ${paymentInfo.paymentTxHash}`);
  } catch (error: any) {
    if (error.name === "ConditionalCheckFailedException") {
      logger.warn(
        `Payment ${paymentInfo.paymentTxHash} already exists in database`
      );
      return;
    }
    logger.error("Error recording x402 payment: " + error);
    throw new CustomError(500, "Failed to record payment");
  }
};

export const checkPaymentStatus = async (
  paymentTxHash: string
): Promise<X402PaymentRecord | null> => {
  try {
    const params = {
      TableName: config.x402_payment_table,
      Key: { paymentTxHash },
    };

    const result = await dbbClient.get(params);
    return result.Item as X402PaymentRecord | null;
  } catch (error) {
    logger.error("Error checking payment status: " + error);
    throw new CustomError(500, "Failed to check payment status");
  }
};

export const markPaymentCompleted = async (
  paymentTxHash: string,
  cid: string
): Promise<void> => {
  try {
    const params = {
      TableName: config.x402_payment_table,
      Key: { paymentTxHash },
      UpdateExpression:
        "SET #status = :status, cid = :cid, completedAt = :completedAt",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":status": "completed",
        ":cid": cid,
        ":completedAt": Date.now(),
      },
    };

    await dbbClient.update(params);
    logger.info(
      `Marked payment ${paymentTxHash} as completed with CID: ${cid}`
    );
  } catch (error) {
    logger.error("Error marking payment as completed: " + error);
    throw new CustomError(500, "Failed to update payment status");
  }
};

export const markPaymentFailed = async (
  paymentTxHash: string,
  error: string,
  isRetry: boolean = false
): Promise<void> => {
  try {
    const updateExpression = isRetry
      ? "SET #status = :status, error = :error, retryCount = retryCount + :inc"
      : "SET #status = :status, error = :error";

    const expressionAttributeValues: any = {
      ":status": "failed",
      ":error": error,
    };

    if (isRetry) {
      expressionAttributeValues[":inc"] = 1;
    }

    const params = {
      TableName: config.x402_payment_table,
      Key: { paymentTxHash },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: expressionAttributeValues,
    };

    await dbbClient.update(params);
    logger.info(`Marked payment ${paymentTxHash} as failed: ${error}`);
  } catch (error) {
    logger.error("Error marking payment as failed: " + error);
    throw new CustomError(500, "Failed to update payment status");
  }
};

export const canRetry = (payment: X402PaymentRecord): boolean => {
  return payment.status === "failed" && payment.retryCount < payment.maxRetries;
};
