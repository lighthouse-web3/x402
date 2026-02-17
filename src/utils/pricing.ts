import config from "../config.js";

const MINIMUM_PRICE = 0.001;

export function calculatePrice(fileSizeBytes: number): string {
  const fileSizeMB = fileSizeBytes / (1024 * 1024);
  const priceUSD = Math.max(fileSizeMB * config.pricePerMb + config.facilitatorFee, MINIMUM_PRICE);
  return `$${priceUSD.toFixed(6)}`;
}
