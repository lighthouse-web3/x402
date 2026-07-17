import config from "../config.js";
import { estimateWalrusSize } from "./walrusSize.js";

export interface PriceQuote {
  fileSizeBytes: number;
  encodedSizeBytes: number;
  encodedSizeMiB: number;
  billableMiB: number;
  pricePerMb: number;
  facilitatorFee: number;
  totalPriceUsd: number;
  totalPrice: string;
}

/**
 * Yearly price based on the Walrus *encoded* size (what we actually pay Walrus
 * to store), billed in whole MiB units to avoid fractional-GB rounding:
 * billableMiB × pricePerMb + facilitatorFee.
 */
export function calculatePriceQuote(fileSizeBytes: number): PriceQuote {
  if (!Number.isFinite(fileSizeBytes) || fileSizeBytes < 0) {
    throw new Error(`Invalid file size for pricing: ${fileSizeBytes}`);
  }
  const { encodedSizeBytes, encodedSizeMiB, storageUnits } = estimateWalrusSize(fileSizeBytes);
  const billableMiB = storageUnits;
  const totalPriceUsd = billableMiB * config.pricePerMb + config.facilitatorFee;

  return {
    fileSizeBytes,
    encodedSizeBytes,
    encodedSizeMiB,
    billableMiB,
    pricePerMb: config.pricePerMb,
    facilitatorFee: config.facilitatorFee,
    totalPriceUsd,
    totalPrice: `$${totalPriceUsd.toFixed(6)}`,
  };
}

/** Returns the x402 price string for one year of storage. */
export function calculatePrice(fileSizeBytes: number): string {
  return calculatePriceQuote(fileSizeBytes).totalPrice;
}
