import dotenv from "dotenv";
dotenv.config();

const config = {
  // Server
  port: parseInt(process.env.PORT || "4021"),
  nodeEnv: process.env.NODE_ENV || "development",
  serviceName: process.env.SERVICE_NAME || "x402-lighthouse",

  // Logging
  logLevel: process.env.LOG_LEVEL || "info",
  victoriaLogsUrl: process.env.VICTORIA_LOGS_URL || "",
  victoriaLogsToken: process.env.VICTORIA_LOGS_TOKEN || "",

  // Lighthouse
  lighthouseApiKey: process.env.LIGHTHOUSE_API_KEY || "",

  // x402 / Payments
  recipientAddress: process.env.RECIPIENT_ADDRESS || "",
  network: process.env.NETWORK || "eip155:84532", // Base Sepolia testnet
  facilitatorUrl: process.env.FACILITATOR_URL || "https://www.x402.org/facilitator",
  cdpApiKeyId: process.env.CDP_API_KEY_ID || "",
  cdpApiKeySecret: process.env.CDP_API_KEY_SECRET || "",
  // Yearly price per MiB of Walrus *encoded* storage (what we pay Walrus for).
  // Billed in whole MiB units to avoid fractional-GB rounding errors.
  pricePerMb: parseFloat(process.env.PRICE_PER_MB || "0.0005"),
  facilitatorFee: parseFloat(process.env.FACILITATOR_FEE || "0.001"),
  /** Days of storage granted per upload or renew payment. */
  storagePeriodDays: parseInt(process.env.STORAGE_PERIOD_DAYS || "365"),
  maxFileSizeBytes: parseInt(process.env.MAX_FILE_SIZE_BYTES || "1073741824"), // 1GB

  // AWS / DynamoDB
  awsRegion: process.env.AWS_REGION || "us-east-1",
  fileRecordTable: process.env.FILE_RECORD_TABLE || "files-x402-walrus",
  /** GSI on the file record table with publicKey as partition key (for upload history). */
  publicKeyIndexName: process.env.FILE_RECORD_PUBLIC_KEY_INDEX || "publicKey-index",
  aws_access_key_id: process.env.AWS_ACCESS_KEY_ID || "",
  aws_secret_access_key: process.env.AWS_SECRET_ACCESS_KEY || "",
};

export default config;
