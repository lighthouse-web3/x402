# Project Context & Memory

This file captures the design and decisions behind this repo so work can continue seamlessly.
Read this first when resuming.

## Goal

An **x402 pay-per-use file storage API**. A client uploads a file, pays in USDC on Base via the
[x402 protocol](https://docs.cdp.coinbase.com/x402/quickstart-for-sellers), and the server stores it
on **Lighthouse** (with a **Walrus** storage backend) and returns an IPFS CID. Storage is sold as a
**yearly plan priced from Walrus's encoded storage cost**, and each file can be **renewed year on
year without re-uploading**.

## Architecture

```
Client ──x402──▶ Express API ──┬── file bytes ─────▶ Lighthouse SDK (storageType: "walrus") ─▶ CID
                               ├── price quote  ────▶ utils/pricing.ts + utils/walrusSize.ts
                               ├── file record ─────▶ DynamoDB (id, cid, size, expiresAt, txHash, ...)
                               └── settlement hook ─▶ facilitator settles on-chain → tx hash → DB
```

- **Payments:** official x402 SDK (`@x402/express`, `@x402/evm`, `@x402/core`). Standard 402 flow:
  first request returns `402 Payment Required` with the price; client pays and retries with a
  `PAYMENT-SIGNATURE` header. Verification + settlement go through a facilitator (testnet:
  `x402.org/facilitator`; mainnet: CDP with JWT auth).
- **Storage:** Lighthouse SDK `lighthouse.upload(filePath, apiKey, { cidVersion: 1, headers: {
  storageType: "walrus" } })`. Files are streamed to a temp file first (never fully buffered in
  memory), then handed to the SDK by path.
- **Index/records:** DynamoDB (`database/sql`-style single-table), one item per uploaded file.

## Key decisions (locked)

- **Pricing = per encoded-MiB per year (simple, integer-billed).**
  - Formula: `totalPrice = billableMiB × pricePerMb + facilitatorFee`, where
    `billableMiB = ceil(encodedSizeBytes / 1 MiB)` (integer) and `pricePerMb` = `PRICE_PER_MB`
    (default **$0.0005** per encoded MiB per year); `facilitatorFee` default $0.001.
  - Billing uses the Walrus **encoded** size (not raw file size) because that is what we actually pay
    Walrus to store. Billed in **whole MiB units** — matches how Walrus sells storage and keeps the
    size term an integer, so there is **no fractional-GB round-off** (the reason we moved off a
    per-GB rate). Consequence: even a 1 KiB file bills for ~63 MiB due to Walrus's fixed ~64 MiB/blob
    overhead — this is intentional and reflects real cost.
  - Config is just `pricePerMb` (`PRICE_PER_MB`), `facilitatorFee` (`FACILITATOR_FEE`), and
    `storagePeriodDays` (`STORAGE_PERIOD_DAYS`, default 365). The earlier plan/quota/monthly-derived
    scheme (`STORAGE_PRICE_USD`, `STORAGE_QUOTA_GB`, `BILLING_PERIOD_MONTHS`, `pricePerMiB`,
    `billingPeriodLabel`) was **removed** in favor of this flat rate.
  - Verified spot prices @ $0.0005/MiB: 1 KiB → $0.0325 (63 MiB), 5 MiB → $0.0430 (84 MiB),
    1 GiB → $2.3325 (4663 MiB), 10 GiB → $23.0375 (46073 MiB).
- **Walrus encoded-size calculator** (`src/utils/walrusSize.ts`) is a direct port of
  [`go-ds-s3-walrus/encoding.go`](https://github.com/lighthouse-web3/go-ds-s3-walrus/blob/main/encoding.go)
  (RS2 formula, decoding safety limit = 0, `DEFAULT_N_SHARDS = 1000`). Verified exact: 17 bytes →
  66,034,000 encoded bytes. `estimateWalrusSize()` returns `{ encodedSizeBytes, encodedSizeMiB,
  storageUnits }` where `storageUnits` (ceil whole MiB) is what pricing bills on. Models a **single
  plain blob** — no quilt/packing math (one upload = one blob here).
- **Recurring payment = renew, not re-upload.** `POST /api/renew` charges another year for an
  existing file using the **stored** file size and only extends the paid-through date. It **rejects a
  file body / never re-uploads** and is **owner-gated** (payer wallet must equal `record.publicKey`).
- **Paid-through tracking via `expiresAt`** (ms epoch) on the record. Upload sets it one period out;
  renew extends from `max(now, expiresAt)` so **early renewals stack** a full period. Helper:
  `nextExpiresAt()` / `storagePeriodMs()` in `utils/fileRecord.ts`.
- **`expiresAt` is billing state only.** Extending the actual Walrus blob lifetime on-chain (e.g. via
  `go-ds-s3-walrus`'s `renew.js`) is a **separate operational step** driven by paid records nearing
  `expiresAt` — not done by this API.
- **`txHash` is filled in asynchronously.** On-chain settlement happens AFTER the handler responds,
  so records are written with `txHash: ""` first, then the `onAfterSettle` hook writes the real hash
  via `updateFileRecordTxHash`. See caveat #1 below for why it can remain `""`.
- **Content-Length is required and validated.** Upload needs it for pricing; after streaming, the
  actual byte count is compared and a mismatch returns 400 (prevents price manipulation / avoids
  charging on a bad upload).
- **MIME type** detected from file magic bytes (`file-type`), falling back to the `Content-Type`
  header then `application/octet-stream`.

## Repo layout

```
x402/
  src/
    index.ts              # entry point; process handlers; startup logging
    app.ts                # Express app: CORS (exposes PAYMENT-* headers), request logging, routes
    config.ts             # all env config (pricing, plan, x402, Lighthouse, AWS)
    payments/
      server.ts           # x402ResourceServer, facilitator client (CDP JWT auth on mainnet),
                          #   onAfterSettle hook, pendingSettlements map, createPaymentMiddleware()
    routes/
      upload.ts           # x402UploadMiddleware (alias x402Middleware), uploadHandler, priceHandler
      renew.ts            # x402RenewMiddleware, renewHandler, renewPriceHandler
    services/
      lighthouse.ts       # uploadToLighthouse(filePath) → { cid, size }; storageType "walrus"
    db/
      client.ts           # DynamoDBDocumentClient
      fileRecord.ts       # putFileRecord, getFileRecordById, updateFileRecordTxHash,
                          #   renewFileRecord, getFileRecordsByPublicKey
    utils/
      pricing.ts          # calculatePriceQuote()/calculatePrice(); bills whole encoded MiB × pricePerMb + fee
      walrusSize.ts       # encodedBlobLength(), encodedStorageUnits(), estimateWalrusSize()
      fileRecord.ts       # FileRecord type, createFileRecord(), expiry math (nextExpiresAt)
      paymentHeader.ts    # getPayerFromRequest(): decode payer wallet from payment header
      logger.ts           # Winston logger (+ optional Victoria Logs transport)
  README.md               # user-facing docs (endpoints, pricing, mainnet, txHash lifecycle)
  CONTEXT.md              # this file
  package.json, tsconfig.json, .env.example
```

TypeScript, ESM (`"type": "module"`, `NodeNext`), Node/Express. Build with `npm run build` (tsc →
`dist/`); dev with `npm run dev` (tsx). **Imports use `.js` extensions** (ESM/NodeNext requirement).

## Data model — `FileRecord` (DynamoDB, table `FILE_RECORD_TABLE`, default `files-x402-walrus`)

| field           | notes                                                        |
| --------------- | ----------------------------------------------------------- |
| `id`            | uuid v4, partition key; returned to client, used to renew   |
| `publicKey`     | payer wallet, lowercased; used for owner-gating + queries   |
| `cid`           | Lighthouse/IPFS CID                                          |
| `fileSizeInBytes` | raw size; renew prices from this                          |
| `fileName`, `mimeType` |                                                      |
| `createdAt`, `updatedAt` | ms epoch                                           |
| `dataPartition` | `dd/mm/yyyy` string                                         |
| `txHash`        | `""` until `onAfterSettle` writes the settled tx hash       |
| `expiresAt`     | ms epoch paid-through; renew extends from `max(now, this)`  |

`getFileRecordsByPublicKey` queries by `publicKey` (assumes a suitable key/GSI on the table).

## HTTP API

- `GET /health` → `OK`
- `POST /api/upload` — x402-gated; body = file bytes; headers `Content-Length` (req), `x-file-name`
  (opt), `PAYMENT-SIGNATURE`. Price from `Content-Length`. Returns `{ id, cid, expiresAt,
  storagePeriodDays, publicKey, ipfsUrl, ... }`.
- `GET /api/upload/price?size=<bytes>` — quote for a new upload (no payment).
- `POST /api/renew` — x402-gated; header `x-file-id` (req), `PAYMENT-SIGNATURE`; **no body**. Price
  from stored size; owner-gated. Returns `{ id, previousExpiresAt, expiresAt, ... }`.
- `GET /api/renew/price?id=<recordId>` — renew quote (+ `currentExpiresAt`).

## Status

- Implemented and compiling (`npm run build` passes, no lint errors). Yearly pricing + renew flow +
  Walrus encoded-size calculator all in place and spot-checked (17 B → 66,034,000 encoded bytes;
  @ $0.0005/encoded-MiB/yr: 1 GiB → $2.3325/yr, 10 GiB → $23.0375/yr).
- **Not integration-tested** against a live facilitator + real Lighthouse/Walrus + real DynamoDB
  (no credentials in the dev environment). No automated test suite in the repo.

## Important caveats / things to verify next

1. **`txHash` can stay `""`.** `pendingSettlements` (in `payments/server.ts`) is keyed **only by
   payer wallet address** and kept **in memory**, so: (a) concurrent payments from the same wallet
   overwrite each other (earlier record loses its hash); (b) a server restart between response and
   settlement loses the pending entry; (c) a settlement with no `result.transaction` writes nothing.
   Fix: key by the payment **nonce** (`authorization.nonce` / `permit2Authorization`) and persist the
   pending mapping (e.g. a DynamoDB item) instead of a `Map`. (Documented in README →
   "Transaction Hash Lifecycle".)
2. **No on-chain Walrus renewal.** `expiresAt` is only DB state; a background sweep must actually
   extend/renew blobs on Walrus for paid files (and could expire/GC unpaid ones). Not built yet.
3. **Renew payment authorization amount.** The renew price is computed in the x402 `price` fn from
   the stored record; verify the facilitator enforces that exact amount and that the owner check in
   `renewHandler` (payer == `publicKey`) is sufficient for your threat model.
4. **`getFileRecordsByPublicKey` is unused by any route** — exists for a future "list my files"
   endpoint (see README Suggested Improvements). Confirm the DynamoDB table actually supports
   querying by `publicKey`.
5. **Walrus size models one plain blob.** If uploads ever get packed (quilt) or chunked into
   multiple blobs, the per-file datacap/encoded-size math would need the packing logic from
   `go-ds-s3-walrus` (distinct-`blob_id` summation).
6. **`ExactEvmScheme` only.** Only the EVM exact scheme is registered; the `price` fns are typed with
   a minimal inline `ctx.adapter.getHeader` shape because the SDK's `RoutesConfig` lives in
   `@x402/core/server` (not re-exported from `@x402/express`).

## Env config (see `.env.example`)

Server: `PORT`, `NODE_ENV`, `SERVICE_NAME`. Logging: `LOG_LEVEL`, `VICTORIA_LOGS_URL/TOKEN`.
Lighthouse: `LIGHTHOUSE_API_KEY`. x402: `RECIPIENT_ADDRESS`, `NETWORK` (default Base Sepolia
`eip155:84532`; mainnet `eip155:8453`), `FACILITATOR_URL`, `CDP_API_KEY_ID/SECRET` (mainnet).
Pricing: `PRICE_PER_MB` (0.0005, per encoded MiB per year), `FACILITATOR_FEE` (0.001),
`STORAGE_PERIOD_DAYS` (365), `MAX_FILE_SIZE_BYTES` (1 GB). AWS: `AWS_REGION`, `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`, `FILE_RECORD_TABLE`.
