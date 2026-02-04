// ============================================
// x402 Protocol Types (Custom Format)
// Base Mainnet & Base Sepolia ONLY
// ============================================

/**
 * Supported blockchain networks (EIP-155 format)
 * Only Base Mainnet and Base Sepolia are supported
 */
export type NetworkId =
  | "eip155:8453" // Base Mainnet
  | "eip155:84532"; // Base Sepolia

/**
 * Network name to EIP-155 ID mapping
 */
export const NETWORK_TO_EIP155: Record<string, NetworkId> = {
  base: "eip155:8453",
  "base-mainnet": "eip155:8453",
  "base-sepolia": "eip155:84532",
};

/**
 * USDC contract addresses per network
 */
export const USDC_ADDRESSES: Record<NetworkId, string> = {
  "eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base Mainnet USDC
  "eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // Base Sepolia USDC
};

/**
 * Chain IDs per network
 */
export const CHAIN_IDS: Record<NetworkId, number> = {
  "eip155:8453": 8453,
  "eip155:84532": 84532,
};

/**
 * RPC URLs per network (will use config values)
 */
export const RPC_URLS: Record<NetworkId, string> = {
  "eip155:8453": "https://mainnet.base.org",
  "eip155:84532": "https://sepolia.base.org",
};

// ============================================
// 402 Payment Required Response
// ============================================

/**
 * Payment scheme in the accepts array
 */
export interface PaymentScheme {
  scheme: string; // "exact"
  network: NetworkId; // e.g., "eip155:84532"
  amount: string; // Amount in USDC base units
  asset: string; // Token contract address
  payTo: string; // Recipient address
  maxTimeoutSeconds: number;
}

/**
 * Resource information
 */
export interface ResourceInfo {
  url: string;
  description: string;
}

/**
 * 402 Payment Required response format
 */
export interface PaymentRequiredResponse {
  x402Version: number;
  payment_id: string; // UUID for this payment request
  error: string; // "Payment required"
  resource: ResourceInfo;
  accepts: PaymentScheme[];
}

// ============================================
// X-PAYMENT Header Format (from client)
// ============================================

/**
 * Payment requirements sent back by client
 */
export interface PaymentRequirements {
  scheme: string;
  network: NetworkId;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  payment_id: string;
}

/**
 * X-PAYMENT header payload (Base64 decoded)
 */
export interface PaymentPayload {
  success: boolean;
  transaction: string; // Transaction hash
  network: NetworkId;
  payer: string; // Payer wallet address
  requirements: PaymentRequirements;
}

// ============================================
// Route Configuration
// ============================================

/**
 * Configuration for a protected route
 */
export interface X402RouteConfig {
  price: string; // e.g., "$0.01" - will be overridden by dynamic pricing
  network: string; // e.g., "base-sepolia"
  description?: string;
  resourceUrl?: string;
}

// ============================================
// Payment Record (DynamoDB - x402-payments)
// ============================================

export interface X402PaymentRecord {
  paymentTxHash: string; // Partition key - unique payment transaction hash
  payment_id?: string; // UUID payment ID
  requestId?: string; // x402 requestId if available
  payerAddress: string;
  amount: string; // Amount in USDC base units
  priceInDollars: string; // Formatted price string
  status: "pending" | "completed" | "failed" | "refunded";
  cid?: string; // CID if upload succeeded
  error?: string; // Error message if failed
  createdAt: number;
  completedAt?: number;
  retryCount: number;
  maxRetries: number;
}

// ============================================
// File Record (DynamoDB - x402-files)
// Matches existing Lighthouse file schema
// ============================================

export type BlockStatus =
  | "queued" // Uploaded to S3, waiting for IPFS
  | "uploading" // Currently uploading to IPFS
  | "uploaded" // Uploaded to IPFS
  | "failed"; // Upload failed

export interface X402FileRecord {
  id: string; // Partition key (UUID)
  blockStatus: BlockStatus; // Status of the file
  cid?: string; // IPFS CID (set after upload)
  createdAt: string; // ISO timestamp
  dataPartition?: string; // Data partition info
  encryption: boolean; // Whether file is encrypted
  fileName: string; // Original file name
  fileSizeInBytes: number; // File size in bytes
  lastUpdate: string; // ISO timestamp of last update
  mimeType: string; // MIME type
  publicKey?: string; // Public key for encryption
  sentForDeal: boolean; // Whether sent for Filecoin deal

  // Additional fields for x402 tracking (not in original schema)
  paymentTxHash?: string; // Payment transaction hash
  payment_id?: string; // Payment ID from 402 response
  s3Key?: string; // S3 key for cleanup
  s3Bucket?: string; // S3 bucket name
  payerAddress?: string; // Payer wallet address
}
