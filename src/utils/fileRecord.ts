import { v4 as uuidv4 } from "uuid";
import { putFileRecord } from "../db/fileRecord.js";

export interface FileRecord {
  id: string;
  publicKey: string;
  fileCid: string;
  fileSizeInBytes: number;
  fileName: string;
  createdAt: number;
  updatedAt: number;
  dataPartition: string;
  mimeType: string;
  txHash: string;
}

function todayPartition(): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = now.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export async function createFileRecord(
  publicKey: string,
  fileCid: string,
  fileSizeBytes: number,
  fileName: string,
  mimeType: string
): Promise<FileRecord> {
  const fileRecord: FileRecord = {
    id: uuidv4(),
    publicKey: publicKey.toLowerCase(),
    createdAt: Date.now(),
    fileCid: fileCid,
    fileSizeInBytes: fileSizeBytes,
    fileName: fileName,
    updatedAt: Date.now(),
    dataPartition: todayPartition(),
    mimeType: mimeType,
    txHash: "",
  };

  await putFileRecord(fileRecord);
  return fileRecord;
}

// export function getFileRecord(publicKey: string): FileRecord | undefined {
//   return users.get(publicKey.toLowerCase());
// }
