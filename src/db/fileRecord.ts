import { PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import docClient from "./client.js";
import config from "../config.js";
import logger from "../utils/logger.js";
import { FileRecord } from "../utils/fileRecord.js";

export async function putFileRecord(record: FileRecord): Promise<void> {
  logger.debug("Saving file record to DynamoDB", { id: record.id, cid: record.fileCid });
  await docClient.send(
    new PutCommand({
      TableName: config.fileRecordTable,
      Item: record,
    })
  );
  logger.debug("File record saved", { id: record.id });
}

export async function updateFileRecordTxHash(
  publicKey: string,
  recordId: string,
  txHash: string
): Promise<void> {
  logger.debug("Updating file record with tx hash", { publicKey, recordId, txHash });
  await docClient.send(
    new UpdateCommand({
      TableName: config.fileRecordTable,
      Key: {
        publicKey: publicKey.toLowerCase(),
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
