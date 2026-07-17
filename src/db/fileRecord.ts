import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
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

/**
 * Mark an upload as paid once its payment has settled on-chain: sets the
 * settlement tx hash and the first paid-through expiry.
 */
export async function markFileRecordPaid(
  recordId: string,
  txHash: string,
  expiresAt: number
): Promise<void> {
  logger.debug("Marking file record paid", { recordId, txHash, expiresAt });
  await docClient.send(
    new UpdateCommand({
      TableName: config.fileRecordTable,
      Key: { id: recordId },
      UpdateExpression: "SET txHash = :tx, expiresAt = :exp, updatedAt = :now",
      ExpressionAttributeValues: {
        ":tx": txHash,
        ":exp": expiresAt,
        ":now": Date.now(),
      },
    })
  );
  logger.debug("File record marked paid", { recordId, txHash });
}

const EXTEND_RETRIES = 3;

/**
 * Extend a record's paid-through expiry by one storage period, atomically.
 *
 * Uses a conditional update on the current expiresAt so two concurrent renewals
 * can never collapse into a single extension — each settled payment stacks one
 * full period. Returns the new expiresAt.
 */
export async function extendFileRecordExpiry(recordId: string, txHash: string): Promise<number> {
  for (let attempt = 1; attempt <= EXTEND_RETRIES; attempt++) {
    const record = await getFileRecordById(recordId);
    if (!record) {
      throw new Error(`File record not found: ${recordId}`);
    }

    const currentExpiresAt = record.expiresAt ?? 0;
    const now = Date.now();
    const expiresAt = nextExpiresAt(currentExpiresAt, now);

    try {
      await docClient.send(
        new UpdateCommand({
          TableName: config.fileRecordTable,
          Key: { id: recordId },
          UpdateExpression: "SET expiresAt = :exp, updatedAt = :now, txHash = :tx",
          ConditionExpression: "expiresAt = :prev OR attribute_not_exists(expiresAt)",
          ExpressionAttributeValues: {
            ":exp": expiresAt,
            ":now": now,
            ":tx": txHash,
            ":prev": currentExpiresAt,
          },
        })
      );
      logger.debug("File record expiry extended", { recordId, expiresAt, txHash });
      return expiresAt;
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException && attempt < EXTEND_RETRIES) {
        logger.warn("Concurrent expiry update detected, retrying extend", { recordId, attempt });
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Failed to extend expiry after ${EXTEND_RETRIES} attempts: ${recordId}`);
}

export async function getFileRecordsByPublicKey(publicKey: string): Promise<FileRecord[]> {
  logger.debug("Querying file records", { publicKey });
  const result = await docClient.send(
    new QueryCommand({
      TableName: config.fileRecordTable,
      IndexName: config.publicKeyIndexName,
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
