import express, { Request, Response } from "express";
import cors from "cors";
import { x402Middleware, uploadHandler, priceHandler } from "./routes/upload.js";

const app = express();
app.use(cors());

app.get("/health", (_req: Request, res: Response) => {
  res.send("OK");
});

app.get("/api/upload/price", priceHandler);
app.post("/api/upload", x402Middleware, uploadHandler);

export default app;
