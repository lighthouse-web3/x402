import dotenv from "dotenv";
dotenv.config();

const isDevelopment = process.env.ENVIRONMENT === "development";

const baseConfig = {
  environment: process.env.ENVIRONMENT || "development",
  port: process.env.PORT ?? 8000,
  devLogPath: "./combined.log",
  lighthouse_api_key: process.env.LIGHTHOUSE_API_KEY || "",
  x402_recipient_address: process.env.X402_RECIPIENT_ADDRESS || "",
  x402_network: process.env.X402_NETWORK || "base-sepolia",
  x402_price_per_mb: process.env.X402_PRICE_PER_MB || "0.01",
  max_file_size_bytes: parseInt(
    process.env.MAX_FILE_SIZE_BYTES || "4294967296"
  ), // 4GB default

  // AWS DynamoDB
  aws_access_key_id: process.env.AWS_ACCESS_KEY_ID || "",
  aws_secret_access_key: process.env.AWS_SECRET_ACCESS_KEY || "",
  aws_region: process.env.AWS_REGION || "us-east-1",
  aws_endpoint: process.env.AWS_ENDPOINT || "",
  x402_payment_table: isDevelopment ? "tn-x402-payments" : "x402-payments",
  x402_files_table: isDevelopment ? "tn-x402-files" : "x402-files",

  // Wasabi S3
  wasabi_access_key_id: process.env.WASABI_ACCESS_KEY_ID || "",
  wasabi_secret_access_key: process.env.WASABI_SECRET_ACCESS_KEY || "",
  wasabi_bucket_name: process.env.WASABI_BUCKET_NAME || "x402-uploads",
  wasabi_region: process.env.WASABI_REGION || "us-east-1",
  wasabi_endpoint:
    process.env.WASABI_ENDPOINT || "https://s3.us-east-1.wasabisys.com",

  // Lighthouse (for IPFS uploads)
  lighthouse_api_url:
    process.env.LIGHTHOUSE_API_URL || "https://api.lighthouse.storage",

  // Worker Intervals (in milliseconds)
  s3_to_ipfs_interval: parseInt(
    process.env.S3_TO_IPFS_INTERVAL_MS || "300000"
  ), // 5 minutes default
  deal_check_interval: parseInt(
    process.env.DEAL_CHECK_INTERVAL_MS || "900000"
  ), // 15 minutes default

  // Worker Settings
  workers_enabled: process.env.WORKERS_ENABLED !== "false", // Enabled by default

  // Blockchain RPC URLs (Base only)
  rpc_base_mainnet: process.env.RPC_BASE_MAINNET || "https://mainnet.base.org",
  rpc_base_sepolia: process.env.RPC_BASE_SEPOLIA || "https://sepolia.base.org",

  // Payment verification settings
  payment_verification_enabled:
    process.env.PAYMENT_VERIFICATION_ENABLED !== "false", // Enabled by default
  payment_min_confirmations: parseInt(
    process.env.PAYMENT_MIN_CONFIRMATIONS || "1"
  ),
};

export default baseConfig;
