import dotenv from "dotenv";
dotenv.config();

const isDevelopment = process.env.ENVIRONMENT === "development";

const baseConfig = {
  environment: process.env.ENVIRONMENT || "development",
  port: process.env.PORT ?? 8000,
  devLogPath: "./combined.log",
  lighthouse_api_key: process.env.LIGHTHOUSE_API_KEY || "",
  x402_recipient_address: process.env.X402_RECIPIENT_ADDRESS || "",
  x402_facilitator_url:
    process.env.X402_FACILITATOR_URL || "https://x402.org/facilitator",
  x402_network: process.env.X402_NETWORK || "base-sepolia",
  x402_price_per_mb: process.env.X402_PRICE_PER_MB || "0.01",
  aws_access_key_id: process.env.AWS_ACCESS_KEY_ID ?? "",
  aws_secret_access_key: process.env.AWS_SECRET_ACCESS_KEY ?? "",
  aws_region: process.env.AWS_REGION ?? "ap-south-1",
  x402_payment_table: isDevelopment ? "tn-x402-payments" : "x402-payments",
};

export default baseConfig;
