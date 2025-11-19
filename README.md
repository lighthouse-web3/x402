# x402 API

A standalone API service for handling x402 payment-based file uploads to IPFS via Lighthouse.

## Overview

This repository provides a dedicated API service for x402 payment integration with Lighthouse file storage. It handles pay-per-use file uploads using the x402 payment protocol.

## Features

- x402 payment integration for file uploads
- Dynamic pricing based on file size
- IPFS file upload via Lighthouse SDK
- Express.js REST API
- TypeScript support
- Error handling and logging

## Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- Lighthouse API key
- x402 recipient address and facilitator URL

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd x402-api
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory:
```env
PORT=8000
ENVIRONMENT=development
LIGHTHOUSE_API_KEY=your_lighthouse_api_key
X402_RECIPIENT_ADDRESS=0x8880d92C43B1c3Ee80581E3c5ab972bAEF897303
X402_FACILITATOR_URL=https://x402.org/facilitator
X402_NETWORK=base-sepolia
X402_PRICE_PER_MB=0.01
```

## Usage

### Development

Run the server in development mode:
```bash
npm run dev
```

### Production

Build and start the production server:
```bash
npm run start:prod
```

## API Endpoints

### POST /api/x402/upload

Upload a file to IPFS via Lighthouse with x402 payment.

**Headers:**
- `Content-Type: application/octet-stream`
- `x-file-name: <filename>` (optional)
- `Content-Length: <file-size>`

**Request Body:**
- Raw file buffer (binary data)

**Response:**
```json
{
  "name": "filename.ext",
  "cid": "QmHash...",
  "amount": "1000"
}
```

## Project Structure

```
x402-api/
├── src/
│   ├── controller/
│   │   └── x402/
│   │       ├── helper/
│   │       │   └── pricing.ts      # Price calculation logic
│   │       └── upload.ts           # Upload controller
│   ├── middlewares/
│   │   ├── error/
│   │   │   ├── customError.ts      # Custom error class
│   │   │   └── index.ts            # Error handler
│   │   ├── getNetwork.ts           # Network detection
│   │   └── x402.ts                 # x402 middleware
│   ├── routes/
│   │   └── x402.ts                 # x402 routes
│   ├── config/
│   │   └── index.ts                # Configuration
│   ├── utils/
│   │   └── logger.ts               # Winston logger
│   ├── app.ts                      # Express app setup
│   └── index.ts                    # Entry point
├── package.json
├── tsconfig.json
└── README.md
```

## License

ISC
