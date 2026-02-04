# x402 Payment API - Complete Application Flow

## Overview

This is a **paid file upload API** that:
1. Accepts USDC payments on **Base blockchain** (Mainnet/Sepolia)
2. Stores files temporarily in **Wasabi S3**
3. Moves files to **IPFS via Lighthouse**
4. Creates **Filecoin deals** for permanent storage
5. Cleans up S3 after deals are confirmed

---

## Complete Request Flow

### Step 1: Client Makes First Request (No Payment)

```
POST /api/x402/upload
Content-Type: application/octet-stream
X-File-Name: myfile.pdf
Body: <binary file data>
```

### Step 2: Server Returns 402 Payment Required

The request goes through the following middleware chain:

```
┌─────────────────────────────────────────────────────────┐
│  express.raw() - Parses binary file up to 4GB           │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│  dynamicPricingMiddleware (src/middlewares/x402.ts)     │
│                                                         │
│  • Calculates price based on file size                  │
│  • Formula: $0.01 per MB (configurable)                 │
│  • Minimum: $0.0001 (100 USDC base units)              │
│  • Sets req.x402RequiredAmount = "10000" (example)      │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│  customPaymentMiddleware (src/middlewares/customPayment.ts) │
│                                                         │
│  • Checks for X-PAYMENT header                          │
│  • ❌ No header found                                   │
│  • Returns HTTP 402 with payment instructions           │
└─────────────────────────────────────────────────────────┘
```

**Server Response (402):**
```json
{
  "x402Version": 1,
  "payment_id": "abc123-def456-...",
  "error": "Payment required",
  "resource": {
    "url": "https://x402.lighthouse.storage/upload",
    "description": "Create Filecoin Deal"
  },
  "accepts": [{
    "scheme": "exact",
    "network": "eip155:84532",
    "amount": "10000",
    "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    "payTo": "0xYourRecipientAddress",
    "maxTimeoutSeconds": 300
  }]
}
```

---

### Step 3: Client Makes USDC Payment On-Chain

Client (outside our system):
1. Reads the 402 response
2. Sends USDC to `payTo` address on Base
3. Gets transaction hash: `0xabc123...`

---

### Step 4: Client Retries With Payment Proof

```
POST /api/x402/upload
Content-Type: application/octet-stream
X-File-Name: myfile.pdf
X-PAYMENT: <base64 encoded payment proof>
Body: <binary file data>
```

**X-PAYMENT header (decoded):**
```json
{
  "success": true,
  "transaction": "0xabc123...",
  "network": "eip155:84532",
  "payer": "0xClientWallet",
  "requirements": {
    "scheme": "exact",
    "network": "eip155:84532",
    "amount": "10000",
    "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    "payTo": "0xYourRecipientAddress",
    "maxTimeoutSeconds": 300,
    "payment_id": "abc123-def456-..."
  }
}
```

---

### Step 5: Server Validates Payment

```
┌─────────────────────────────────────────────────────────┐
│  customPaymentMiddleware                                │
│                                                         │
│  1. Decode X-PAYMENT header (Base64 → JSON)             │
│  2. Validate structure (has transaction, payer, etc.)   │
│  3. Validate network matches (eip155:84532)             │
│  4. Validate recipient matches our wallet               │
│  5. Validate amount >= required amount                  │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│  ON-CHAIN VERIFICATION (if PAYMENT_VERIFICATION_ENABLED)│
│  (src/services/blockchain/paymentVerification.ts)       │
│                                                         │
│  1. Connect to Base RPC                                 │
│  2. Fetch transaction receipt by hash                   │
│  3. Check transaction succeeded (status = 1)            │
│  4. Check has enough confirmations                      │
│  5. Parse USDC Transfer event logs                      │
│  6. Verify: from = payer, to = recipient, amount >= req │
└─────────────────────────────────────────────────────────┘
```

---

### Step 6: Upload Controller Processes File

```
┌─────────────────────────────────────────────────────────┐
│  x402_upload (src/controller/x402/upload.ts)            │
│                                                         │
│  1. Validate file buffer exists                         │
│  2. Check file size <= 4GB                              │
│  3. Extract metadata (fileName, mimeType)               │
│                                                         │
│  4. Record payment in DynamoDB                          │
│     Table: x402-payments                                │
│     Status: "pending"                                   │
│                                                         │
│  5. Generate unique S3 key                              │
│     Format: uploads/{paymentId}/{timestamp}-{random}-{name} │
│                                                         │
│  6. Upload file to Wasabi S3                            │
│     (src/services/s3/wasabiClient.ts)                   │
│                                                         │
│  7. Create file record in DynamoDB                      │
│     Table: x402-files                                   │
│     storageStage: "queued"                              │
│     sentForDeal: false                                  │
│                                                         │
│  8. Return success response                             │
└─────────────────────────────────────────────────────────┘
```

**Server Response (200):**
```json
{
  "success": true,
  "id": "file-uuid-123",
  "fileName": "myfile.pdf",
  "fileSizeInBytes": 1048576,
  "storageStage": "queued",
  "blockStatus": null,
  "sentForDeal": false,
  "s3Key": "uploads/abc123/1234567890-xyz-myfile.pdf",
  "createdAt": "2026-02-04T12:00:00.000Z",
  "message": "File uploaded to staging. IPFS upload will be processed shortly.",
  "payment": {
    "txHash": "0xabc123...",
    "payment_id": "abc123-def456-...",
    "amount": "10000",
    "payer": "0xClientWallet"
  }
}
```

---

## Background Workers

### Worker 1: S3 → IPFS (Every 5 minutes)

```
┌─────────────────────────────────────────────────────────┐
│  s3ToIpfsWorker (src/workers/s3ToIpfsWorker.ts)         │
│                                                         │
│  1. Query DynamoDB for files where storageStage="queued"│
│                                                         │
│  2. For each file:                                      │
│     a. Update storageStage = "uploading"                │
│     b. Download from Wasabi S3                          │
│     c. Upload to IPFS via Lighthouse SDK                │
│     d. Get CID (Content Identifier)                     │
│     e. Update storageStage = "uploaded"                 │
│     f. Store CID in database                            │
│                                                         │
│  On error: storageStage = "failed"                      │
└─────────────────────────────────────────────────────────┘
```

### Worker 2: Deal Checker (Every 15 minutes)

```
┌─────────────────────────────────────────────────────────┐
│  dealCheckerWorker (src/workers/dealCheckerWorker.ts)   │
│                                                         │
│  1. Query DynamoDB for files where:                     │
│     - storageStage = "uploaded"                         │
│     - sentForDeal = false                               │
│     - cid exists                                        │
│                                                         │
│  2. For each file:                                      │
│     a. Call Lighthouse API:                             │
│        GET /api/lighthouse/deal_status?cid={cid}        │
│                                                         │
│     b. Check if deal is "Active" or "Proving"           │
│                                                         │
│     c. If deal confirmed:                               │
│        - Set sentForDeal = true, blockStatus from API   │
│        - Delete file from S3 (cleanup)                  │
│        - Clear s3Key from database                      │
└─────────────────────────────────────────────────────────┘
```

---

## Database Tables

### Table 1: x402-payments

| Field | Type | Description |
|-------|------|-------------|
| `paymentTxHash` | String (PK) | Transaction hash |
| `requestId` | String | payment_id from 402 response |
| `payerAddress` | String | Client wallet address |
| `amount` | String | Amount in USDC base units |
| `priceInDollars` | String | Human readable price |
| `status` | String | pending/completed/failed |
| `cid` | String | IPFS CID (if successful) |
| `error` | String | Error message (if failed) |
| `retryCount` | Number | Retry attempts |
| `maxRetries` | Number | Max allowed retries (3) |
| `createdAt` | Number | Timestamp |

### Table 2: x402-files

| Field | Type | Description |
|-------|------|-------------|
| `id` | String (PK) | UUID |
| `storageStage` | String | Pipeline: queued/uploading/uploaded/failed |
| `blockStatus` | String (optional) | Filecoin deal status (e.g. Active, Proving) when deal confirmed |
| `cid` | String | IPFS CID |
| `createdAt` | String | ISO timestamp |
| `encryption` | Boolean | Is file encrypted |
| `fileName` | String | Original name |
| `fileSizeInBytes` | Number | Size in bytes |
| `lastUpdate` | String | Last update timestamp |
| `mimeType` | String | Content type |
| `sentForDeal` | Boolean | Deal confirmed |
| `s3Key` | String | S3 storage key |
| `s3Bucket` | String | S3 bucket name |
| `paymentTxHash` | String | Link to payments table |
| `payerAddress` | String | Client wallet |

---

## File Status Lifecycle

```
storageStage:  ┌──────────┐     ┌───────────┐     ┌──────────┐     ┌─────────────┐
                │  queued  │ ──▶ │ uploading │ ──▶ │ uploaded │ ──▶ │ sentForDeal │
                └──────────┘     └───────────┘     └──────────┘     │   = true    │
                     │                │                  │          │ blockStatus │
                     │                │                  │          │ set from API│
                     │                ▼                  │          └─────────────┘
                     │           ┌────────┐              │
                     └─────────▶ │ failed │ ◀────────────┘
                                 └────────┘
```

### storageStage (pipeline)

| Stage | Description |
|--------|-------------|
| `queued` | File in S3, waiting for IPFS worker |
| `uploading` | S3 → IPFS transfer in progress |
| `uploaded` | File on IPFS, waiting for Filecoin deal |
| `failed` | Pipeline step failed |

### blockStatus (Filecoin)

Optional. Set when deal is confirmed (e.g. `Active`, `Proving`). Comes from Lighthouse deal_status.

### sentForDeal

`true` = Filecoin deal confirmed, S3 file deleted.

---

## Security Features

| Feature | Implementation |
|---------|----------------|
| **Payment Verification** | On-chain verification via Base RPC |
| **Amount Validation** | Check USDC transfer >= required |
| **Recipient Check** | Verify payment goes to our wallet |
| **Network Check** | Only Base Mainnet/Sepolia |
| **Replay Prevention** | payment_id ties to specific request |
| **Retry Protection** | Max 3 retries per payment |
| **File Size Limit** | 4GB maximum |

---

## External Services Used

| Service | Purpose |
|---------|---------|
| **Base RPC** | On-chain payment verification |
| **Wasabi S3** | Temporary file storage |
| **Lighthouse SDK** | IPFS upload |
| **Lighthouse API** | Filecoin deal status |
| **DynamoDB** | Payment & file tracking |

---

## Supported Networks

| Network | Chain ID | EIP-155 Format | USDC Address |
|---------|----------|----------------|--------------|
| Base Mainnet | 8453 | `eip155:8453` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Base Sepolia | 84532 | `eip155:84532` | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

---

## API Endpoints

### Production Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/api/x402/upload` | Upload file with payment |
| `POST` | `/api/x402/retry-upload` | Retry failed upload |

### Test Endpoints (Development Only)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/test/files` | List all files |
| `GET` | `/api/test/files/:id` | Get file by ID |
| `POST` | `/api/test/files/:id/mock-ipfs` | Mock IPFS upload |
| `POST` | `/api/test/files/:id/mock-deal` | Mock deal completion |
| `POST` | `/api/test/trigger-s3-to-ipfs` | Trigger S3→IPFS worker |
| `POST` | `/api/test/trigger-deal-checker` | Trigger deal checker |
| `GET` | `/api/test/config` | Show current config |

---

## Configuration

### Required Environment Variables

```env
# Server
PORT=8005
ENVIRONMENT=development

# Recipient wallet (receives USDC payments)
X402_RECIPIENT_ADDRESS=0x...
X402_NETWORK=base-sepolia

# Pricing
X402_PRICE_PER_MB=0.01

# AWS DynamoDB
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_ENDPOINT=http://localhost:4566  # For LocalStack

# Wasabi S3
WASABI_ACCESS_KEY_ID=
WASABI_SECRET_ACCESS_KEY=
WASABI_BUCKET_NAME=x402-uploads
WASABI_REGION=us-east-1
WASABI_ENDPOINT=https://s3.us-east-1.wasabisys.com

# Lighthouse
LIGHTHOUSE_API_KEY=

# RPC (for on-chain verification)
RPC_BASE_MAINNET=https://mainnet.base.org
RPC_BASE_SEPOLIA=https://sepolia.base.org

# Verification
PAYMENT_VERIFICATION_ENABLED=true
PAYMENT_MIN_CONFIRMATIONS=1

# Workers
WORKERS_ENABLED=true
S3_TO_IPFS_INTERVAL_MS=300000
DEAL_CHECK_INTERVAL_MS=900000
```

---

## Project Structure

```
src/
├── index.ts                 # Entry point, starts server & workers
├── app.ts                   # Express app setup
├── config/
│   └── index.ts             # Configuration management
├── routes/
│   ├── x402.ts              # Main API routes
│   └── test.ts              # Test/debug routes
├── middlewares/
│   ├── customPayment.ts     # Payment validation + on-chain verification
│   ├── x402.ts              # Dynamic pricing
│   ├── x402Retry.ts         # Retry validation
│   ├── getNetwork.ts        # Address type detection
│   └── error/               # Error handling
├── controller/
│   └── x402/
│       ├── upload.ts        # Upload controller
│       └── helper/
│           └── pricing.ts   # Price calculation
├── services/
│   ├── blockchain/
│   │   └── paymentVerification.ts  # On-chain verification
│   ├── s3/
│   │   └── wasabiClient.ts  # S3 operations
│   └── ipfs/
│       └── lighthouseService.ts    # IPFS upload & deal check
├── db/
│   ├── db/
│   │   └── ddbClient.ts     # DynamoDB client
│   └── x402/
│       ├── paymentTracking.ts  # Payment records
│       └── fileTracking.ts     # File records
├── workers/
│   ├── index.ts             # Worker orchestration
│   ├── s3ToIpfsWorker.ts    # S3 → IPFS worker
│   └── dealCheckerWorker.ts # Deal checker worker
├── types/
│   └── x402.ts              # TypeScript types
└── utils/
    └── logger.ts            # Logging
```

---

## Summary

**This application is a complete payment-gated file storage system:**

1. **Client requests upload** → Gets 402 with payment instructions
2. **Client pays USDC on Base** → Gets transaction hash
3. **Client retries with payment proof** → Server verifies on-chain
4. **File uploaded to S3** → Immediate availability
5. **Worker moves to IPFS** → Permanent decentralized storage
6. **Worker checks Filecoin deals** → Once confirmed, S3 cleanup
