# x402 API Testing Guide

## Prerequisites

### 1. Start LocalStack (Docker)

```bash
docker run -d -p 4566:4566 localstack/localstack
```

### 2. Create S3 Bucket

```bash
curl -X PUT http://localhost:4566/x402-uploads
```

### 3. Create DynamoDB Tables

**Create payments table:**
```bash
curl -X POST http://localhost:4566 \
  -H "Content-Type: application/x-amz-json-1.0" \
  -H "X-Amz-Target: DynamoDB_20120810.CreateTable" \
  -d '{
    "TableName": "tn-x402-payments",
    "KeySchema": [{"AttributeName": "paymentTxHash", "KeyType": "HASH"}],
    "AttributeDefinitions": [{"AttributeName": "paymentTxHash", "AttributeType": "S"}],
    "BillingMode": "PAY_PER_REQUEST"
  }'
```

**Create files table:**
```bash
curl -X POST http://localhost:4566 \
  -H "Content-Type: application/x-amz-json-1.0" \
  -H "X-Amz-Target: DynamoDB_20120810.CreateTable" \
  -d '{
    "TableName": "tn-x402-files",
    "KeySchema": [{"AttributeName": "fileId", "KeyType": "HASH"}],
    "AttributeDefinitions": [{"AttributeName": "fileId", "AttributeType": "S"}],
    "BillingMode": "PAY_PER_REQUEST"
  }'
```

### 4. Verify LocalStack Setup

**Check LocalStack health:**
```bash
curl -s http://localhost:4566/_localstack/health
```

**List S3 bucket contents:**
```bash
curl -s http://localhost:4566/x402-uploads
```

**List DynamoDB tables:**
```bash
curl -s -X POST http://localhost:4566 \
  -H "Content-Type: application/x-amz-json-1.0" \
  -H "X-Amz-Target: DynamoDB_20120810.ListTables" \
  -d '{}'
```

---

## Environment Setup

### .env file for LocalStack testing

```env
# Server
PORT=8005
ENVIRONMENT=development

# Payment
X402_RECIPIENT_ADDRESS=0x4486f8AFE9554063056cFA204208EFf62dEAaa56
X402_NETWORK=base-sepolia
X402_PRICE_PER_MB=0.01

# LocalStack DynamoDB
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
AWS_REGION=us-east-1
AWS_ENDPOINT=http://localhost:4566

# LocalStack S3
WASABI_ACCESS_KEY_ID=test
WASABI_SECRET_ACCESS_KEY=test
WASABI_BUCKET_NAME=x402-uploads
WASABI_REGION=us-east-1
WASABI_ENDPOINT=http://localhost:4566
```

### Start the server

```bash
npm run dev
```

---

## API Testing Commands

### 1. Health Check

```bash
curl http://localhost:8005/health
```

**Expected Response:**
```
OK
```

---

### 2. Upload Without Payment (402 Response)

```bash
curl -X POST http://localhost:8005/api/x402/upload \
  -H "Content-Type: application/octet-stream" \
  --data "test file content"
```

**Expected Response (402 Payment Required):**
```json
{
  "x402Version": 1,
  "payment_id": "e0a2e0c2-6703-4399-aa39-317e89bc1c19",
  "error": "Payment required",
  "resource": {
    "url": "https://x402.lighthouse.storage/upload",
    "description": "Create Filecoin Deal"
  },
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:84532",
      "amount": "100",
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "payTo": "0x4486f8AFE9554063056cFA204208EFf62dEAaa56",
      "maxTimeoutSeconds": 300
    }
  ]
}
```

---

### 3. Upload With Payment (Full Flow)

**Step 1: Create Base64 encoded payment header**

```bash
PAYMENT=$(echo -n '{"success":true,"transaction":"0x1234567890abcdef","network":"eip155:84532","payer":"0xa6F47836C431ffBb2346eeFdBa1Bd1d7382fD482","requirements":{"scheme":"exact","network":"eip155:84532","amount":"100","asset":"0x036CbD53842c5426634e7929541eC2318f3dCF7e","payTo":"0x4486f8AFE9554063056cFA204208EFf62dEAaa56","maxTimeoutSeconds":300,"payment_id":"test-payment-123"}}' | base64 -w 0)
```

**Step 2: Upload file with payment**

```bash
curl -X POST http://localhost:8005/api/x402/upload \
  -H "Content-Type: application/octet-stream" \
  -H "x-file-name: test.txt" \
  -H "X-PAYMENT: $PAYMENT" \
  --data "Hello this is a test file content"
```

**Expected Response (200 Success):**
```json
{
  "success": true,
  "fileId": "uuid-xxx-xxx",
  "fileName": "test.txt",
  "fileSize": 33,
  "s3Url": "http://localhost:4566/x402-uploads/uploads/...",
  "status": "pending",
  "message": "File uploaded to staging. IPFS upload will be processed shortly.",
  "payment": {
    "txHash": "0x1234567890abcdef",
    "payment_id": "test-payment-123",
    "amount": "100",
    "payer": "0xa6F47836C431ffBb2346eeFdBa1Bd1d7382fD482"
  }
}
```

---

### 4. Upload With Verbose Output

```bash
curl -v -X POST http://localhost:8005/api/x402/upload \
  -H "Content-Type: application/octet-stream" \
  -H "x-file-name: test.txt" \
  -H "X-PAYMENT: $PAYMENT" \
  --data "Hello this is a test file content"
```

---

### 5. Upload With File

```bash
# Upload an actual file
curl -X POST http://localhost:8005/api/x402/upload \
  -H "Content-Type: application/octet-stream" \
  -H "x-file-name: myfile.pdf" \
  -H "X-PAYMENT: $PAYMENT" \
  --data-binary @/path/to/your/file.pdf
```

---

### 6. Retry Failed Upload

```bash
curl -X POST "http://localhost:8005/api/x402/retry-upload?paymentTxHash=0x1234567890abcdef" \
  -H "Content-Type: application/octet-stream" \
  -H "x-file-name: test.txt" \
  --data "Hello this is a test file content"
```

---

## Verify Data in LocalStack

### Check S3 uploads

```bash
# List all files in bucket
curl -s http://localhost:4566/x402-uploads | xmllint --format -
```

### Check DynamoDB records

**Scan payments table:**
```bash
curl -s -X POST http://localhost:4566 \
  -H "Content-Type: application/x-amz-json-1.0" \
  -H "X-Amz-Target: DynamoDB_20120810.Scan" \
  -d '{"TableName": "tn-x402-payments"}'
```

**Scan files table:**
```bash
curl -s -X POST http://localhost:4566 \
  -H "Content-Type: application/x-amz-json-1.0" \
  -H "X-Amz-Target: DynamoDB_20120810.Scan" \
  -d '{"TableName": "tn-x402-files"}'
```

---

## Payment Header Format

The `X-PAYMENT` header is a Base64-encoded JSON with this structure:

```json
{
  "success": true,
  "transaction": "0x...",
  "network": "eip155:84532",
  "payer": "0x...",
  "requirements": {
    "scheme": "exact",
    "network": "eip155:84532",
    "amount": "1000",
    "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    "payTo": "0x...",
    "maxTimeoutSeconds": 300,
    "payment_id": "uuid-from-402-response"
  }
}
```

### Encode payment to Base64:

```bash
echo -n 'YOUR_JSON_HERE' | base64 -w 0
```

### Decode Base64 payment:

```bash
echo 'BASE64_STRING' | base64 -d
```

---

## Error Responses

### Invalid payer address
```json
{"error":{"code":400,"message":"Invalid payer address"}}
```

### Recipient mismatch
```json
{"error":{"code":400,"message":"Recipient mismatch. Expected 0x..., got 0x..."}}
```

### Network mismatch
```json
{"error":{"code":400,"message":"Network mismatch. Expected eip155:84532, got eip155:1"}}
```

### Insufficient payment
```json
{"error":{"code":400,"message":"Insufficient payment. Required: 1000, provided: 100"}}
```

---

## Quick Test Script

Save this as `test-upload.sh`:

```bash
#!/bin/bash

# Configuration
SERVER_URL="http://localhost:8005"
RECIPIENT="0x4486f8AFE9554063056cFA204208EFf62dEAaa56"
PAYER="0xa6F47836C431ffBb2346eeFdBa1Bd1d7382fD482"

echo "=== Testing x402 API ==="

# Test 1: Health check
echo -e "\n1. Health Check:"
curl -s $SERVER_URL/health
echo ""

# Test 2: Get 402 response
echo -e "\n2. Get Payment Requirements (402):"
curl -s -X POST $SERVER_URL/api/x402/upload \
  -H "Content-Type: application/octet-stream" \
  --data "test"

# Test 3: Upload with payment
echo -e "\n\n3. Upload with Payment:"
PAYMENT=$(echo -n "{\"success\":true,\"transaction\":\"0xtest123\",\"network\":\"eip155:84532\",\"payer\":\"$PAYER\",\"requirements\":{\"scheme\":\"exact\",\"network\":\"eip155:84532\",\"amount\":\"100\",\"asset\":\"0x036CbD53842c5426634e7929541eC2318f3dCF7e\",\"payTo\":\"$RECIPIENT\",\"maxTimeoutSeconds\":300,\"payment_id\":\"test-$(date +%s)\"}}" | base64 -w 0)

curl -s -X POST $SERVER_URL/api/x402/upload \
  -H "Content-Type: application/octet-stream" \
  -H "x-file-name: test-$(date +%s).txt" \
  -H "X-PAYMENT: $PAYMENT" \
  --data "Test file uploaded at $(date)"

echo -e "\n\n=== Tests Complete ==="
```

Make executable and run:
```bash
chmod +x test-upload.sh
./test-upload.sh
```

---

## Test Endpoints (No Lighthouse API Key Required)

These endpoints allow testing the worker flow without a Lighthouse API key.

### List All Files

```bash
# List all files
curl -s http://localhost:8005/api/test/files

# List files by status
curl -s "http://localhost:8005/api/test/files?status=pending"
curl -s "http://localhost:8005/api/test/files?status=ipfs_done"
curl -s "http://localhost:8005/api/test/files?status=deal_done"
```

### Get File Details

```bash
curl -s http://localhost:8005/api/test/files/{fileId}
```

### Mock IPFS Upload (Simulate S3 → IPFS Worker)

```bash
# Mock IPFS upload with auto-generated CID
curl -X POST http://localhost:8005/api/test/files/{fileId}/mock-ipfs \
  -H "Content-Type: application/json" \
  -d '{}'

# Mock IPFS upload with custom CID
curl -X POST http://localhost:8005/api/test/files/{fileId}/mock-ipfs \
  -H "Content-Type: application/json" \
  -d '{"cid": "QmYourCustomCID123"}'
```

### Mock Deal Completion (Simulate Deal Checker Worker)

```bash
# Mark deal as done (keep S3 file)
curl -X POST http://localhost:8005/api/test/files/{fileId}/mock-deal \
  -H "Content-Type: application/json" \
  -d '{}'

# Mark deal as done AND delete S3 file
curl -X POST http://localhost:8005/api/test/files/{fileId}/mock-deal \
  -H "Content-Type: application/json" \
  -d '{"deleteS3": true}'
```

### Mark File as Failed

```bash
curl -X POST http://localhost:8005/api/test/files/{fileId}/mark-failed \
  -H "Content-Type: application/json" \
  -d '{"error": "Test error message"}'
```

### Check Configuration

```bash
curl -s http://localhost:8005/api/test/config
```

---

## Complete Test Flow (Without Lighthouse API Key)

```bash
# Step 1: Upload a file (get fileId from response)
PAYMENT=$(echo -n '{"success":true,"transaction":"0xtest123","network":"eip155:84532","payer":"0xa6F47836C431ffBb2346eeFdBa1Bd1d7382fD482","requirements":{"scheme":"exact","network":"eip155:84532","amount":"100","asset":"0x036CbD53842c5426634e7929541eC2318f3dCF7e","payTo":"0x4486f8AFE9554063056cFA204208EFf62dEAaa56","maxTimeoutSeconds":300,"payment_id":"test-123"}}' | base64 -w 0)

curl -X POST http://localhost:8005/api/x402/upload \
  -H "Content-Type: application/octet-stream" \
  -H "x-file-name: test.txt" \
  -H "X-PAYMENT: $PAYMENT" \
  --data "Hello world"

# Step 2: Check file status (should be "pending")
curl -s http://localhost:8005/api/test/files

# Step 3: Mock IPFS upload
curl -X POST http://localhost:8005/api/test/files/{fileId}/mock-ipfs \
  -H "Content-Type: application/json" \
  -d '{}'

# Step 4: Check file status (should be "ipfs_done" with CID)
curl -s http://localhost:8005/api/test/files/{fileId}

# Step 5: Mock deal completion + S3 cleanup
curl -X POST http://localhost:8005/api/test/files/{fileId}/mock-deal \
  -H "Content-Type: application/json" \
  -d '{"deleteS3": true}'

# Step 6: Verify final status (should be "deal_done" with s3DeletedAt)
curl -s http://localhost:8005/api/test/files/{fileId}
```
