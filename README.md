# x402 Lighthouse Upload API

Pay-per-use file storage on [Lighthouse](https://www.lighthouse.storage/) /
[Walrus](https://www.walrus.xyz/), powered by the
[x402](https://docs.cdp.coinbase.com/x402/quickstart-for-sellers) payment protocol. Users pay in
USDC on Base and receive an IPFS CID in return. Storage is priced on Walrus's *encoded* size (what we
actually pay Walrus to store) for a **one-year** period, and each file can be **renewed year on year
without re-uploading**.

## Pricing

The price is a flat rate **per MiB of Walrus encoded storage per year**, plus a flat facilitator fee:

```
totalPrice = billableMiB × PRICE_PER_MB + FACILITATOR_FEE

billableMiB  = ceil(encodedSizeBytes / 1 MiB)   # whole MiB, integer
PRICE_PER_MB = 0.0005   (default, per encoded MiB per year)
```

Billing uses the Walrus **encoded** size, not the raw file size, because that is what Walrus charges
us for: RedStuff erasure coding expands the data (~5x) and adds a fixed ~64 MiB/blob metadata
overhead on a 1000-shard committee. The encoded size is computed by `src/utils/walrusSize.ts` (ported
from [`go-ds-s3-walrus/encoding.go`](https://github.com/lighthouse-web3/go-ds-s3-walrus/blob/main/encoding.go)).
It is billed in **whole MiB units** (matching how Walrus sells storage) so the size term is always an
integer — no fractional-GB rounding.

| File size | Encoded (whole MiB) | Price (1 year) @ `$0.0005/MiB` |
| --------- | ------------------- | ------------------------------ |
| 1 KiB     | 63                  | ~$0.0325 |
| 5 MiB     | 84                  | ~$0.0430 |
| 1 GiB     | 4,663               | ~$2.3325 |
| 10 GiB    | 46,073              | ~$23.0375 |

> Note: even a tiny file bills for ~63 MiB because of Walrus's fixed per-blob overhead — this
> reflects the real Walrus storage cost. Set `PRICE_PER_MB` to your actual per-encoded-MiB rate.

Set `STORAGE_PERIOD_DAYS` to change the storage period granted per payment (default `365`).

## How It Works

The server follows the standard **x402 payment protocol** — the first request returns a **402
Payment Required** with pricing details. The client pays on-chain and retries with a payment proof.

```
Client                           Server                      Lighthouse
  │                                │                              │
  │  POST /api/upload              │                              │
  │  + file body (no payment)      │                              │
  │ ─────────────────────────────► │  calculate yearly price      │
  │ ◄───────── 402 Payment Required│                              │
  │    { price, network, payTo }   │                              │
  │                                │                              │
  │  (pay USDC on Base)            │                              │
  │                                │                              │
  │  POST /api/upload              │                              │
  │  + PAYMENT-SIGNATURE header    │                              │
  │  + file body                   │                              │
  │ ─────────────────────────────► │  verify & settle payment     │
  │                                │  create file record (1 year) │
  │                                │  upload file ──────────────► │
  │                                │ ◄────────── CID              │
  │ ◄──────────── 200 { id, cid } │                              │
```

Each upload includes the **first year** of storage and returns a record `id`. To keep the file
stored, the owner pays again via `POST /api/renew` (see below), which extends the paid-through date
by another year — **no file is re-uploaded**.

### Steps

1. `POST /api/upload` with file body (no payment header) → **402** with price & payment details
2. Client pays USDC on-chain using the details from the 402 response
3. `POST /api/upload` with file body + `PAYMENT-SIGNATURE` header → **200** with `{ id, cid, expiresAt }`
4. Before `expiresAt`, `POST /api/renew` with the record `id` + payment → paid-through extended one year

### Price Check (optional shortcut)

To know the cost before sending the file, use the price endpoints:

```bash
GET /api/upload/price?size=<bytes>   # quote for a new upload
GET /api/renew/price?id=<recordId>   # quote to renew an existing file
```

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

# Yearly price per MiB of Walrus encoded storage (billed in whole MiB units)
PRICE_PER_MB=0.0005
# Flat fee added to every payment
FACILITATOR_FEE=0.001
# Days of storage granted per upload or renew payment (365 = yearly)
STORAGE_PERIOD_DAYS=365

# Max file size in bytes (default 1 GB)
MAX_FILE_SIZE_BYTES=1073741824

# AWS / DynamoDB (file records)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_aws_access_key_id
AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key
FILE_RECORD_TABLE=files-x402-walrus
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

Upload a file and pay for the first year of storage via x402.

**Without payment** — returns 402 with pricing details:

```bash
curl -X POST http://localhost:4021/api/upload \
  -H "Content-Type: application/octet-stream" \
  --data-binary @photo.png
```

**With payment** — verifies, settles, uploads, and returns the CID + record id:

```bash
curl -X POST http://localhost:4021/api/upload \
  -H "Content-Type: application/octet-stream" \
  -H "PAYMENT-SIGNATURE: <base64-encoded-payment>" \
  -H "x-file-name: photo.png" \
  --data-binary @photo.png
```

**Headers:**

| Header              | Required | Description                           |
| ------------------- | -------- | ------------------------------------- |
| `Content-Type`      | Yes      | `application/octet-stream`            |
| `Content-Length`    | Yes      | File size in bytes (used for pricing) |
| `PAYMENT-SIGNATURE` | Yes      | x402 payment proof (base64)           |
| `x-file-name`       | No       | Original file name                    |

**200 response:**

```json
{
  "success": true,
  "id": "8f0c1e2a-...",
  "cid": "QmXoypiz...",
  "fileName": "photo.png",
  "mimeType": "image/png",
  "fileSizeBytes": 2048000,
  "expiresAt": 1785000000000,
  "storagePeriodDays": 365,
  "publicKey": "0xpayeraddress",
  "ipfsUrl": "https://gateway.lighthouse.storage/ipfs/QmXoypiz..."
}
```

Save the `id` — it is required to renew the file later.

---

### `POST /api/renew`

Pay for another year of storage for an existing file. **Does not accept a file body and never
re-uploads** — it only extends the paid-through date on the existing record. Only the original
uploader wallet may renew.

**Without payment** — returns 402 with the renewal price (computed from the stored file size):

```bash
curl -X POST http://localhost:4021/api/renew \
  -H "x-file-id: 8f0c1e2a-..."
```

**With payment:**

```bash
curl -X POST http://localhost:4021/api/renew \
  -H "x-file-id: 8f0c1e2a-..." \
  -H "PAYMENT-SIGNATURE: <base64-encoded-payment>"
```

**Headers:**

| Header              | Required | Description                          |
| ------------------- | -------- | ------------------------------------ |
| `x-file-id`         | Yes      | Record `id` returned from the upload |
| `PAYMENT-SIGNATURE` | Yes      | x402 payment proof (base64)          |

**200 response:**

```json
{
  "success": true,
  "id": "8f0c1e2a-...",
  "cid": "QmXoypiz...",
  "fileName": "photo.png",
  "fileSizeBytes": 2048000,
  "previousExpiresAt": 1785000000000,
  "expiresAt": 1816536000000,
  "storagePeriodDays": 365,
  "publicKey": "0xpayeraddress"
}
```

Renewing early stacks another full year onto the current `expiresAt`.

---

### `GET /api/upload/price?size=<bytes>` *(optional helper)*

Check the price before uploading. No payment required.

```bash
curl "http://localhost:4021/api/upload/price?size=1073741824"
```

```json
{
  "fileSizeBytes": 1073741824,
  "fileSizeMB": 1024,
  "encodedSizeBytes": 4888852000,
  "encodedSizeMiB": 4662.3726,
  "billableMiB": 4663,
  "pricePerMB": "$0.0005",
  "facilitatorFee": "$0.001000",
  "totalPrice": "$2.332500",
  "storagePeriodDays": 365,
  "network": "eip155:84532",
  "payTo": "0xYourWalletAddress"
}
```

### `GET /api/renew/price?id=<recordId>` *(optional helper)*

Same quote shape, priced from the stored file's size, plus `currentExpiresAt`.

## Project Structure

```
src/
├── index.ts              # Entry point — starts the server
├── app.ts                # Express app — routes + middleware wiring
├── config.ts             # Environment configuration (pricing, plan, AWS)
├── payments/
│   └── server.ts         # x402 resource server, facilitator client, settlement hook
├── routes/
│   ├── upload.ts         # Upload x402 middleware, handler, price helper
│   └── renew.ts          # Renew x402 middleware, handler, price helper
├── services/
│   └── lighthouse.ts     # Lighthouse SDK upload wrapper
├── db/
│   ├── client.ts         # DynamoDB document client
│   └── fileRecord.ts     # File record persistence (put/get/renew/query)
└── utils/
    ├── pricing.ts        # Yearly price calculation
    ├── walrusSize.ts     # Walrus encoded-size calculator (RS2)
    ├── fileRecord.ts     # FileRecord type + create + expiry math
    ├── paymentHeader.ts  # Decode payer wallet from payment header
    └── logger.ts         # Winston logger
```

## File Records

Uploads are persisted to DynamoDB (`FILE_RECORD_TABLE`). Each record carries an `expiresAt`
paid-through timestamp. It starts at `0` (unpaid) and is only set once the payment **settles
on-chain**: upload stamps it one billing period out; `POST /api/renew` extends it atomically from
`max(now, expiresAt)`.

> **Note:** `expiresAt` tracks what the customer has *paid for*. Extending the actual Walrus blob
> lifetime on-chain (e.g. via `go-ds-s3-walrus`'s `renew.js`) is a separate operational step driven
> by records that are paid and nearing `expiresAt`.

### Payment Settlement Lifecycle

The x402 middleware **buffers the handler's response and settles the payment before flushing it**.
This means the DB write granting storage can — and does — wait for settlement:

1. The handler does its work (upload: streams + uploads the file and writes the record with
   `txHash: ""`, `expiresAt: 0`; renew: just validates ownership) and registers a pending
   settlement in an in-memory map, keyed by **payer + payment nonce**
   (`authorization.nonce` / `permit2Authorization`), so concurrent payments from one wallet never
   collide.
2. The middleware settles the payment with the facilitator. If settlement **fails**, the buffered
   200 is discarded, the client receives a **402**, and the record keeps `expiresAt: 0` — a failed
   payment can never leave a record showing paid storage.
3. On success, the `onAfterSettle` hook in `src/payments/server.ts` writes the real tx hash and the
   new `expiresAt` (upload: first period; renew: conditional-update extend with retry), then the
   buffered 200 is flushed to the client.

**Known gaps** (logged loudly for reconciliation):

- **Server restart** between handler and settlement loses the in-memory pending entry — persist the
  map (e.g. a small DynamoDB item) for restart-durability.
- **Settled but DB write failed** — the hook never throws (that would turn a successful payment
  into a client-facing 402); it logs `PAYMENT RECONCILIATION NEEDED` with the record id and tx hash.
- **Upload settle failure after the blob reached Lighthouse** — the file exists on Walrus but its
  record is unpaid (`expiresAt: 0`); the expiry sweep can garbage-collect these.

## Key Design Decisions

| Decision | Rationale |
|---|---|
| **Official x402 SDK** (`@x402/express`, `@x402/evm`, `@x402/core`) | Handles 402 responses, payment verification, and settlement via the facilitator — no custom on-chain verification needed. |
| **Priced on Walrus encoded size, per MiB/year** | We bill what Walrus actually charges us for — the erasure-coded (encoded) size — in whole MiB units (integer, no fractional-GB rounding), for a one-year period. |
| **Renew without re-upload** | `POST /api/renew` extends the paid-through date on the existing record using the stored file size — no bytes are re-sent, and only the original uploader can renew. |
| **`DynamicPrice` function** | The SDK supports a function for `price` in the route config. Upload prices from `Content-Length`; renew prices from the stored record's size. |
| **Streaming to disk** | The request body is piped directly to a temp file — the full file never sits in memory. Safe for large uploads under concurrent load. |
| **Content-Length validation** | After streaming, actual file size is compared against declared `Content-Length`. A mismatch returns 400 and prevents settlement — the user is not charged. |
| **Preflight before payment** | Cheap validation middleware (`uploadPreflight`, `renewPreflight`) runs *before* the x402 middleware, so clients get a clean 400/404/413 instead of signing a payment for a doomed request. |
| **Storage granted only after settlement** | Records are written unpaid; the `onAfterSettle` hook stamps `txHash` + `expiresAt` once the money has moved. Failed settlement → client gets 402, record stays unpaid. |

## Switching to Mainnet

1. Change `NETWORK` to `eip155:8453` (Base mainnet).
2. Change `FACILITATOR_URL` to `https://api.cdp.coinbase.com/platform/v2/x402` and set up [CDP API keys](https://cdp.coinbase.com) (`CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`).
3. Set `RECIPIENT_ADDRESS` to your mainnet wallet.

See the [x402 mainnet docs](https://docs.cdp.coinbase.com/x402/quickstart-for-sellers#running-on-mainnet) for details.

## Suggested Improvements

- **Expiry sweep** — background job to expire/garbage-collect records past `expiresAt` and drive on-chain Walrus renewal for paid files.
- **Encrypted uploads** — Lighthouse supports [Kavach encryption](https://docs.lighthouse.storage/how-to/upload-data/encrypted-uploads) for privacy-sensitive files.
- **Upload history endpoint** — expose `getFileRecordsByPublicKey` so users can list their files and expiry dates.

## References

- [x402 Quickstart for Sellers](https://docs.cdp.coinbase.com/x402/quickstart-for-sellers)
- [Lighthouse Upload Docs](https://docs.lighthouse.storage/how-to/upload-data/)
- [go-ds-s3-walrus (Walrus datastore + encoded-size formula)](https://github.com/lighthouse-web3/go-ds-s3-walrus)
