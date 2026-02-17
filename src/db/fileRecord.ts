import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import docClient from "./client.js";
import config from "../config.js";
import { FileRecord } from "../utils/fileRecord.js";

export async function putFileRecord(record: FileRecord): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: config.fileRecordTable,
      Item: record,
    })
  );
}

export async function getFileRecordsByPublicKey(publicKey: string): Promise<FileRecord[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: config.fileRecordTable,
      KeyConditionExpression: "publicKey = :pk",
      ExpressionAttributeValues: {
        ":pk": publicKey.toLowerCase(),
      },
    })
  );

  return (result.Items as FileRecord[]) ?? [];
}
