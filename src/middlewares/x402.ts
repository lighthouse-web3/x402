import { Request, Response, NextFunction } from "express";
import {
  calculatePrice,
  getMinimumPrice,
  formatPriceForX402,
} from "../controller/x402/helper/pricing.js";
import CustomError from "./error/customError.js";
import getNetwork from "./getNetwork.js";

declare module "express-serve-static-core" {
  interface Request {
    x402Payment?: any;
    x402RequiredAmount?: string;
    x402RequestId?: string;
    x402Verified?: boolean;
    x402CalculatedPrice?: string;
    x402Payer?: string;
  }
}

export const dynamicPricingMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    let fileSize = 0;
    if (req.body && Buffer.isBuffer(req.body)) {
      fileSize = req.body.length;
    } else if (req.headers["content-length"]) {
      fileSize = parseInt(req.headers["content-length"], 10) || 0;
    }

    const requiredAmount =
      fileSize > 0 ? calculatePrice(fileSize) : getMinimumPrice();
    const priceInDollars = formatPriceForX402(requiredAmount);

    req.x402RequiredAmount = requiredAmount;
    req.x402CalculatedPrice = priceInDollars;
    (req as any).actualFileSize = fileSize;

    const originalJson = res.json.bind(res);
    res.json = function (body: any) {
      if (res.statusCode === 402 && body?.payment) {
        body.payment.amount = priceInDollars;
        if (req.x402RequestId) {
          body.payment.requestId = req.x402RequestId;
        }
      }
      return originalJson(body);
    };

    next();
  } catch (error) {
    next(new CustomError(500, "Failed to calculate pricing"));
  }
};
