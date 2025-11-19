export interface X402PaymentRecord {
  paymentTxHash: string // Partition key - unique payment transaction hash
  requestId?: string // x402 requestId if available
  payerAddress: string
  amount: string // Amount in USDC base units
  priceInDollars: string // Formatted price string
  status: 'pending' | 'completed' | 'failed' | 'refunded'
  cid?: string // CID if upload succeeded
  error?: string // Error message if failed
  createdAt: number
  completedAt?: number
  retryCount: number
  maxRetries: number
}

