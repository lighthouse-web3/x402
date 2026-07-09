import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import logger from "./utils/logger.js";
import { x402Middleware, uploadHandler, priceHandler } from "./routes/upload.js";
import { x402RenewMiddleware, renewHandler, renewPriceHandler } from "./routes/renew.js";

const app = express();

const X402_EXPOSED_HEADERS = [
  "PAYMENT-REQUIRED",
  "PAYMENT-RESPONSE",
  "X-PAYMENT-RESPONSE",
] as const;

app.use(
  cors({
    exposedHeaders: [...X402_EXPOSED_HEADERS],
  })
);

app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.originalUrl} ${res.statusCode}`, {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      durationMs: duration,
    });
  });
  next();
});

app.get("/health", (_req: Request, res: Response) => {
  res.send("OK");
});

app.get("/api/upload/price", priceHandler);
app.post("/api/upload", x402Middleware, uploadHandler);

app.get("/api/renew/price", renewPriceHandler);
app.post("/api/renew", x402RenewMiddleware, renewHandler);

export default app;
