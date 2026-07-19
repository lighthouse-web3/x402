import { v4 as uuidv4 } from "uuid";
import config from "../config.js";
import { putFileRecord } from "../db/fileRecord.js";

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

/** Next paid-through time: stacks on current expiry when still active. */
export function nextExpiresAt(currentExpiresAt: number, now = Date.now()): number {
  const base = Math.max(currentExpiresAt || 0, now);
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
  };

  await putFileRecord(fileRecord);
  return fileRecord;
}
