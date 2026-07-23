import { v4 as uuidv4 } from "uuid";
import config from "../config.js";
import { putFileRecord } from "../db/fileRecord.js";

/**
 * Lifecycle state used to coordinate the out-of-band Walrus renewal worker.
 * - `to-extend`: a fresh upload settled and its blob's initial on-chain lifetime
 *   still needs to be extended. The worker picks these up first.
 * - `renew`: a renewal payment settled and the blob's on-chain lifetime needs to
 *   be extended again.
 * - `active`: file is live; no pending on-chain extension work. The renewal
 *   worker (a separate microservice) sets this once the on-chain extension is done.
 */
export type FileState = "to-extend" | "renew" | "active";

export interface FileRecord {
  id: string;
  publicKey: string;
  cid: string;
  fileSizeInBytes: number;
  fileName: string;
  createdAt: number;
  updatedAt: number;
  dataPartition: string;
  mimeType: string;
  txHash: string;
  /**
   * Paid-through timestamp (ms). Storage is owed through this instant.
   * 0 means no settled payment yet — the record is created before settlement
   * and marked paid by the onAfterSettle hook once the payment lands on-chain.
   */
  expiresAt: number;
  /** Renewal-worker coordination flag. See FileState. */
  fileState: FileState;
}

function todayPartition(): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = now.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function storagePeriodMs(): number {
  return config.storagePeriodDays * 24 * 60 * 60 * 1000;
}

/**
 * Normalize a paid-through value to a numeric ms epoch.
 *
 * Records are supposed to hold `expiresAt` as a ms-epoch number, but some rows
 * (e.g. written by the separate renewal microservice) store it as an ISO date
 * string. Coercing here keeps the expiry math from producing `NaN`, which
 * DynamoDB rejects ("Special numeric value NaN is not allowed").
 */
export function toEpochMs(value: number | string | null | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) {
      return asNumber;
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

/** Next paid-through time: stacks on current expiry when still active. */
export function nextExpiresAt(
  currentExpiresAt: number | string | null | undefined,
  now = Date.now()
): number {
  const base = Math.max(toEpochMs(currentExpiresAt), now);
  return base + storagePeriodMs();
}

export async function createFileRecord(
  publicKey: string,
  cid: string,
  fileSizeBytes: number,
  fileName: string,
  mimeType: string
): Promise<FileRecord> {
  const now = Date.now();
  const fileRecord: FileRecord = {
    id: uuidv4(),
    publicKey: publicKey.toLowerCase(),
    createdAt: now,
    cid: cid,
    fileSizeInBytes: fileSizeBytes,
    fileName: fileName,
    updatedAt: now,
    dataPartition: todayPartition(),
    mimeType: mimeType,
    txHash: "",
    expiresAt: 0,
    fileState: "to-extend",
  };

  await putFileRecord(fileRecord);
  return fileRecord;
}
