import config from "../config.js";

const MIN_BILLABLE_MB = 1;

export function calculatePrice(fileSizeBytes: number): string {
  const fileSizeMB = Math.max(fileSizeBytes / (1024 * 1024), MIN_BILLABLE_MB);
  const priceUSD = fileSizeMB * config.pricePerMb + config.facilitatorFee;
  return `$${priceUSD.toFixed(6)}`;
}
