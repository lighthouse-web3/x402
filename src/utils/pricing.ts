import config from "../config.js";
import { STORAGE_UNIT_BYTES, estimateWalrusSize } from "./walrusSize.js";

const MIN_BILLABLE_UNITS = 1;

export interface PriceQuote {
  fileSizeBytes: number;
  walrusEncodedSizeBytes: number;
  walrusStorageUnits: number;
  walrusEncodedSizeMiB: number;
  billableMiB: number;
  pricePerMiB: number;
  storagePriceUsd: number;
  storageQuotaGb: number;
  billingPeriodLabel: string;
  facilitatorFee: number;
  totalPriceUsd: number;
  totalPrice: string;
}

/** Whole MiB billed from raw file size (matches user-facing storage quota). */
export function rawStorageUnits(fileSizeBytes: number): number {
  if (fileSizeBytes <= 0) {
    return 0;
  }
  return Math.ceil(fileSizeBytes / STORAGE_UNIT_BYTES);
}

export function calculatePriceQuote(fileSizeBytes: number): PriceQuote {
  const walrus = estimateWalrusSize(fileSizeBytes);
  const billableMiB = Math.max(rawStorageUnits(fileSizeBytes), MIN_BILLABLE_UNITS);
  const totalPriceUsd = billableMiB * config.pricePerMiB + config.facilitatorFee;

  return {
    fileSizeBytes,
    walrusEncodedSizeBytes: walrus.encodedSizeBytes,
    walrusStorageUnits: walrus.storageUnits,
    walrusEncodedSizeMiB: walrus.encodedSizeMiB,
    billableMiB,
    pricePerMiB: config.pricePerMiB,
    storagePriceUsd: config.storagePriceUsd,
    storageQuotaGb: config.storageQuotaGb,
    billingPeriodLabel: config.billingPeriodLabel,
    facilitatorFee: config.facilitatorFee,
    totalPriceUsd,
    totalPrice: `$${totalPriceUsd.toFixed(6)}`,
  };
}

/** Returns x402 price string for one billing period (year) at the plan rate. */
export function calculatePrice(fileSizeBytes: number): string {
  return calculatePriceQuote(fileSizeBytes).totalPrice;
}
