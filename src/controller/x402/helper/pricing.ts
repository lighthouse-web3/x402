const X402_PRICE_PER_MB = parseFloat(process.env.X402_PRICE_PER_MB || '0.01')
const USDC_DECIMALS = 6
// x402 requires minimum price of $0.0001 (0.0001 dollars)
// In USDC with 6 decimals: 0.0001 * 10^6 = 100 base units
const MINIMUM_PRICE_USDC = 100 // $0.0001

/**
 * Get minimum price (for very small files)
 * @returns Minimum price in USDC base units
 */
export const getMinimumPrice = (): string => {
  return MINIMUM_PRICE_USDC.toString()
}

/**
 * Calculate price in USDC based on file size
 * @param fileSizeInBytes - File size in bytes
 * @returns Price in USDC (as string with 6 decimals)
 */
export const calculatePrice = (fileSizeInBytes: number): string => {
  // Convert bytes to MB
  const fileSizeInMB = fileSizeInBytes / (1024 * 1024)

  // Calculate price in USD
  const priceInUSD = fileSizeInMB * X402_PRICE_PER_MB

  // Convert to USDC (6 decimals)
  const priceInUSDC = Math.ceil(priceInUSD * Math.pow(10, USDC_DECIMALS))

  // Enforce minimum price (x402 requires at least $0.0001)
  const finalPrice = Math.max(priceInUSDC, MINIMUM_PRICE_USDC)

  // Return as string (for BigNumber compatibility)
  return finalPrice.toString()
}

/**
 * Format price for x402 payment request (in dollars)
 * @param priceInUSDC - Price in USDC (6 decimals)
 * @returns Price string in dollars format (e.g., "$0.0001")
 */
export const formatPriceForX402 = (priceInUSDC: string): string => {
  const priceInDollars = parseFloat(priceInUSDC) / Math.pow(10, USDC_DECIMALS)
  // Ensure minimum of $0.0001
  const minDollars = MINIMUM_PRICE_USDC / Math.pow(10, USDC_DECIMALS)
  const finalPrice = Math.max(priceInDollars, minDollars)
  return `$${finalPrice.toFixed(6)}`
}

