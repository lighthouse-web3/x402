import { type NextFunction, type Request, type Response } from "express";
import CustomError from "./customError.js";

export default (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): Response => {
  if (err instanceof CustomError) {
    const errorCode = err?.error?.code ?? 500;
    return res.status(errorCode).json({ error: err.error });
  }

  if (err instanceof Error) {
    return res.status(400).json({
      error: {
        code: 400,
        message: err.message || "Something went wrong.",
      },
    });
  }

  return res.status(400).json({
    error: {
      code: 400,
      message: err?.message || String(err) || "Something went wrong.",
    },
  });
};
