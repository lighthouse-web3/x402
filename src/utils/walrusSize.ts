/**
 * Walrus bills storage by a blob's *encoded* size, not its raw size: RedStuff
 * erasure coding expands the data (~4.5–5x) and adds fixed per-blob metadata
 * overhead (~64 MiB on a 1000-shard committee). Ported from
 * github.com/lighthouse-web3/go-ds-s3-walrus/encoding.go
 */

/** Walrus mainnet committee shard count. */
export const DEFAULT_N_SHARDS = 1000;

/** Walrus sells storage in whole 1 MiB units of encoded size per epoch. */
export const STORAGE_UNIT_BYTES = 1 << 20;

/**
 * Returns the Walrus *encoded* size in bytes for a blob of the given raw length.
 * Mirrors Mysten's RS2 formula (decoding safety limit = 0). A 17-byte blob on
 * 1000 shards returns 66_034_000.
 */
export function encodedBlobLength(unencodedLength: number, nShards = DEFAULT_N_SHARDS): number {
  if (nShards <= 0) {
    nShards = DEFAULT_N_SHARDS;
  }

  const n = nShards;
  const maxFaulty = Math.floor((n - 1) / 3);
  const minCorrect = n - maxFaulty;
  const primarySymbols = minCorrect - maxFaulty;
  const secondarySymbols = minCorrect;

  if (primarySymbols <= 0 || secondarySymbols <= 0) {
    return 0;
  }

  let u = unencodedLength;
  if (u < 1) {
    u = 1;
  }

  let symbolSize = Math.floor((u - 1) / (primarySymbols * secondarySymbols)) + 1;
  if (symbolSize % 2 === 1) {
    symbolSize += 1;
  }

  const sliverSize = (primarySymbols + secondarySymbols) * symbolSize * n;
  const digestLen = 32;
  const blobIdLen = 32;
  const metadata = n * digestLen * 2 + blobIdLen;

  return n * metadata + sliverSize;
}

/** Whole 1 MiB storage units billed for an encoded size. */
export function encodedStorageUnits(encodedSize: number): number {
  if (encodedSize <= 0) {
    return 0;
  }
  return Math.ceil(encodedSize / STORAGE_UNIT_BYTES);
}

export interface WalrusSizeEstimate {
  fileSizeBytes: number;
  encodedSizeBytes: number;
  storageUnits: number;
  encodedSizeMiB: number;
}

/** Estimate Walrus datacap for a single blob (one upload, no quilt packing). */
export function estimateWalrusSize(
  fileSizeBytes: number,
  nShards = DEFAULT_N_SHARDS
): WalrusSizeEstimate {
  const encodedSizeBytes = encodedBlobLength(fileSizeBytes, nShards);
  const storageUnits = encodedStorageUnits(encodedSizeBytes);

  return {
    fileSizeBytes,
    encodedSizeBytes,
    storageUnits,
    encodedSizeMiB: encodedSizeBytes / STORAGE_UNIT_BYTES,
  };
}
