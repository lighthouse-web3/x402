import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import docClient from "./client.js";
import config from "../config.js";
import logger from "../utils/logger.js";
import { FileRecord, nextExpiresAt } from "../utils/fileRecord.js";

export async function putFileRecord(record: FileRecord): Promise<void> {
  logger.debug("Saving file record to DynamoDB", { id: record.id, cid: record.cid });
  await docClient.send(
    new PutCommand({
      TableName: config.fileRecordTable,
      Item: record,
    })
  );
  logger.debug("File record saved", { id: record.id });
}

export async function getFileRecordById(recordId: string): Promise<FileRecord | null> {
  logger.debug("Getting file record by id", { recordId });
  const result = await docClient.send(
    new GetCommand({
      TableName: config.fileRecordTable,
      Key: { id: recordId },
    })
  );

  const record = (result.Item as FileRecord | undefined) ?? null;
  logger.debug("File record lookup", { recordId, found: !!record });
  return record;
}

export async function updateFileRecordTxHash(recordId: string, txHash: string): Promise<void> {
  logger.debug("Updating file record with tx hash", { recordId, txHash });
  await docClient.send(
    new UpdateCommand({
      TableName: config.fileRecordTable,
      Key: {
        id: recordId,
      },
      UpdateExpression: "SET txHash = :tx, updatedAt = :now",
      ExpressionAttributeValues: {
        ":tx": txHash,
        ":now": Date.now(),
      },
    })
  );
  logger.debug("File record tx hash updated", { recordId, txHash });
}

/** Extend paid-through expiry by one storage period. Does not touch bytes or CID. */
export async function renewFileRecord(record: FileRecord): Promise<FileRecord> {
  const now = Date.now();
  const expiresAt = nextExpiresAt(record.expiresAt ?? 0, now);

  logger.debug("Renewing file record", { recordId: record.id, expiresAt });
  await docClient.send(
    new UpdateCommand({
      TableName: config.fileRecordTable,
      Key: { id: record.id },
      UpdateExpression: "SET expiresAt = :exp, updatedAt = :now, txHash = :tx",
      ExpressionAttributeValues: {
        ":exp": expiresAt,
        ":now": now,
        ":tx": "",
      },
    })
  );

  return {
    ...record,
    expiresAt,
    updatedAt: now,
    txHash: "",
  };
}

export async function getFileRecordsByPublicKey(publicKey: string): Promise<FileRecord[]> {
  logger.debug("Querying file records", { publicKey });
  const result = await docClient.send(
    new QueryCommand({
      TableName: config.fileRecordTable,
      KeyConditionExpression: "publicKey = :pk",
      ExpressionAttributeValues: {
        ":pk": publicKey.toLowerCase(),
      },
    })
  );

  const records = (result.Items as FileRecord[]) ?? [];
  logger.debug("File records found", { publicKey, count: records.length });
  return records;
}
