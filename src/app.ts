import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import logger from "./utils/logger.js";
import { x402Middleware, uploadHandler, priceHandler } from "./routes/upload.js";

const app = express();
app.use(cors());

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

export default app;
