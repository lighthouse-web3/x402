import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import config from "../config.js";

const client = new DynamoDBClient({
  region: config.awsRegion,
  credentials: {
    accessKeyId: config.aws_access_key_id ?? '',
    secretAccessKey: config.aws_secret_access_key ?? '',
  },
});

const docClient = DynamoDBDocumentClient.from(client);

export default docClient;
