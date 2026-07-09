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
  // Walrus storage plan: $11/month base for 250 GB, billed yearly ($132/year).
  // storagePriceUsd is the amount charged per billing period (year).
  storagePriceUsd:
    parseFloat(process.env.STORAGE_PRICE_USD || "11") *
    parseInt(process.env.BILLING_PERIOD_MONTHS || "12"),
  storageQuotaGb: parseFloat(process.env.STORAGE_QUOTA_GB || "250"),
  billingPeriodLabel: process.env.BILLING_PERIOD_LABEL || "year",
  // Per-MiB price for the whole billing period (overridable via PRICE_PER_MB).
  pricePerMiB: process.env.PRICE_PER_MB
    ? parseFloat(process.env.PRICE_PER_MB)
    : (parseFloat(process.env.STORAGE_PRICE_USD || "11") *
        parseInt(process.env.BILLING_PERIOD_MONTHS || "12")) /
      (parseFloat(process.env.STORAGE_QUOTA_GB || "250") * 1024),
  facilitatorFee: parseFloat(process.env.FACILITATOR_FEE || "0.001"),
  /** Days of storage granted per upload or renew payment. */
  storagePeriodDays: parseInt(process.env.STORAGE_PERIOD_DAYS || "365"),
  maxFileSizeBytes: parseInt(process.env.MAX_FILE_SIZE_BYTES || "1073741824"), // 1GB

  // AWS / DynamoDB
  awsRegion: process.env.AWS_REGION || "us-east-1",
  fileRecordTable: process.env.FILE_RECORD_TABLE || "files-x402-walrus",
  aws_access_key_id: process.env.AWS_ACCESS_KEY_ID || "",
  aws_secret_access_key: process.env.AWS_SECRET_ACCESS_KEY || "",
};

export default config;
