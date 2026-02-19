# x402 Lighthouse Upload API

Pay-per-use file upload to [Lighthouse](https://www.lighthouse.storage/) IPFS storage, powered by the [x402](https://docs.cdp.coinbase.com/x402/quickstart-for-sellers) payment protocol. Users pay **$0.004 per MB** in USDC on Base and receive an IPFS CID in return.

## How It Works

The server follows the standard **x402 payment protocol** — the first request returns a **402 Payment Required** with pricing details. The client pays on-chain and retries with a payment proof.

```
Client                           Server                      Lighthouse
  │                                │                              │
  │  POST /api/upload              │                              │
  │  + file body (no payment)      │                              │
  │ ─────────────────────────────► │  calculate $0.004 × MB       │
  │ ◄───────── 402 Payment Required│                              │
  │    { price, network, payTo }   │                              │
  │                                │                              │
  │  (pay USDC on Base)            │                              │
  │                                │                              │
  │  POST /api/upload              │                              │
  │  + PAYMENT-SIGNATURE header    │                              │
  │  + file body                   │                              │
  │ ─────────────────────────────► │  verify & settle payment     │
  │                                │  create user record          │
  │                                │  upload file ──────────────► │
  │                                │ ◄────────── CID              │
  │ ◄───────────────── 200 { cid } │                              │
```

### Steps

1. `POST /api/upload` with file body (no payment header) → **402** with price & payment details
2. Client pays USDC on-chain using the details from the 402 response
3. `POST /api/upload` with file body + `PAYMENT-SIGNATURE` header → **200** with CID

### Price Check (optional shortcut)

To know the cost before sending the file, use the price endpoint:

```bash
GET /api/upload/price?size=<bytes>
```

This returns the exact price for a given file size — useful for showing the cost in a UI before the user commits.

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Create a `.env` file:

```env
# Server
PORT=4021

# Your wallet address that receives USDC payments
RECIPIENT_ADDRESS=0xYourWalletAddress

# Lighthouse API key (get one at https://files.lighthouse.storage/)
LIGHTHOUSE_API_KEY=your_lighthouse_api_key

# Network — Base Sepolia testnet (use eip155:8453 for mainnet)
NETWORK=eip155:84532

# x402 facilitator (testnet)
FACILITATOR_URL=https://www.x402.org/facilitator

# Pricing
PRICE_PER_MB=0.004

# Max file size in bytes (default 100 MB)
MAX_FILE_SIZE_BYTES=104857600
```

### 3. Run

```bash
# Development (with hot reload)
npm run dev

# Production
npm run build && npm start
```

## API Endpoints

### `GET /health`

Health check. Returns `OK`.

---

### `POST /api/upload`

Upload a file to Lighthouse via x402 payment.

**Without payment** — returns 402 with pricing details:

```bash
curl -X POST http://localhost:4021/api/upload \
  -H "Content-Type: application/octet-stream" \
  --data-binary @photo.png
```

**402 response** (contains everything needed to pay):

```json
{
  "x402Version": 2,
  "error": "Payment required",
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:84532",
      "maxAmountRequired": "20000",
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "payTo": "0xYourWalletAddress",
      "maxTimeoutSeconds": 300
    }
  ],
  "resource": {
    "description": "Upload file to Lighthouse IPFS storage"
  }
}
```

**With payment** — verifies, settles, uploads, and returns the CID:

```bash
curl -X POST http://localhost:4021/api/upload \
  -H "Content-Type: application/octet-stream" \
  -H "PAYMENT-SIGNATURE: <base64-encoded-payment>" \
  -H "x-file-name: photo.png" \
  --data-binary @photo.png
```

**Headers:**

| Header               | Required | Description                              |
| -------------------- | -------- | ---------------------------------------- |
| `Content-Type`       | Yes      | `application/octet-stream`               |
| `Content-Length`      | Yes      | File size in bytes (used for pricing)    |
| `PAYMENT-SIGNATURE`  | Yes      | x402 payment proof (base64)              |
| `x-file-name`        | No       | Original file name                       |

**200 response:**

```json
{
  "success": true,
  "cid": "QmXoypiz...",
  "fileName": "photo.png",
  "fileSizeBytes": 2048000,
  "walletAddress": "0xPayerAddress",
  "ipfsUrl": "https://gateway.lighthouse.storage/ipfs/QmXoypiz..."
}
```

---

### `GET /api/upload/price?size=<bytes>` *(optional helper)*

Check the price before uploading. No payment required.

```bash
curl "http://localhost:4021/api/upload/price?size=5242880"
```

```json
{
  "fileSizeBytes": 5242880,
  "fileSizeMB": 5,
  "pricePerMB": "$0.004",
  "totalPrice": "$0.020000",
  "network": "eip155:84532",
  "payTo": "0xYourWalletAddress"
}
```

## Project Structure

```
src/
├── index.ts              # Entry point — starts the server
├── app.ts                # Express app — routes + middleware wiring
├── config.ts             # Environment configuration
├── routes/
│   └── upload.ts         # x402 middleware, upload handler, price helper
├── services/
│   └── lighthouse.ts     # Lighthouse SDK upload wrapper
└── utils/
    ├── pricing.ts        # $0.004/MB price calculation
    └── users.ts          # Dummy user record (replace with real DB)
```

## Key Design Decisions

| Decision | Rationale |
|---|---|
| **Official x402 SDK** (`@x402/express`, `@x402/evm`, `@x402/core`) | Handles 402 responses, payment verification, and settlement via the facilitator — no custom on-chain verification needed. |
| **Standard 402 flow** | First request returns 402 with the price. Client pays and retries. This is how x402 is designed to work — no custom payment logic needed. |
| **`DynamicPrice` function** | The SDK supports passing a function for `price` in the route config. We use `Content-Length` to compute per-MB cost on every request. |
| **Streaming to disk** | The request body is piped directly to a temp file — the full file never sits in memory. Lighthouse SDK reads from the temp file. Safe for large uploads under concurrent load. |
| **Content-Length validation** | After streaming, actual file size is compared against declared `Content-Length`. A mismatch returns 400 and prevents settlement — the user is not charged. |
| **Direct Lighthouse upload** | Files go straight to IPFS — no intermediate S3 staging or background workers. Simpler and faster. |
| **Price endpoint** | Optional convenience — lets clients check the cost before sending the file. |

## Switching to Mainnet

1. Change `NETWORK` to `eip155:8453` (Base mainnet).
2. Change `FACILITATOR_URL` to `https://api.cdp.coinbase.com/platform/v2/x402` and set up [CDP API keys](https://cdp.coinbase.com).
3. Set `RECIPIENT_ADDRESS` to your mainnet wallet.

See the [x402 mainnet docs](https://docs.cdp.coinbase.com/x402/quickstart-for-sellers#running-on-mainnet) for details.

## Suggested Improvements

- **Persist user records** — replace the in-memory `Map` in `utils/users.ts` with a real database.
- **Encrypted uploads** — Lighthouse supports [Kavach encryption](https://docs.lighthouse.storage/how-to/upload-data/encrypted-uploads) for privacy-sensitive files.
- **Batch uploads** — accept multiple files in a single payment transaction.
- **Upload history** — store CID + wallet mappings so users can retrieve their past uploads.

## References

- [x402 Quickstart for Sellers](https://docs.cdp.coinbase.com/x402/quickstart-for-sellers)
- [Lighthouse Upload Docs](https://docs.lighthouse.storage/how-to/upload-data/)
- [Lighthouse x402 Tutorial](https://docs.lighthouse.storage/tutorials/x402-pay-per-use-file-upload)
