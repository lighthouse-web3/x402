import dotenv from "dotenv";
dotenv.config();

const config = {
  port: parseInt(process.env.PORT || "4021"),
  lighthouseApiKey: process.env.LIGHTHOUSE_API_KEY || "",
  recipientAddress: process.env.RECIPIENT_ADDRESS || "",
  network: process.env.NETWORK || "eip155:84532", // Base Sepolia testnet
  facilitatorUrl: process.env.FACILITATOR_URL || "https://www.x402.org/facilitator",
  pricePerMb: parseFloat(process.env.PRICE_PER_MB || "0.004"),
  facilitatorFee: parseFloat(process.env.FACILITATOR_FEE || "0.001"),
  maxFileSizeBytes: parseInt(process.env.MAX_FILE_SIZE_BYTES || "1073741824"), // 1GB
  awsRegion: process.env.AWS_REGION || "us-east-1",
  fileRecordTable: process.env.FILE_RECORD_TABLE || "files-x402",
  aws_access_key_id: process.env.AWS_ACCESS_KEY_ID || "",
  aws_secret_access_key: process.env.AWS_SECRET_ACCESS_KEY || "",
};

export default config;
