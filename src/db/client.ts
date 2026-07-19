import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import config from "../config.js";

// Only pass explicit credentials when both are configured; otherwise let the
// SDK use its default provider chain (IAM role, shared config, etc.).
const useStaticCredentials = !!(config.aws_access_key_id && config.aws_secret_access_key);

const client = new DynamoDBClient({
  region: config.awsRegion,
  ...(useStaticCredentials && {
    credentials: {
      accessKeyId: config.aws_access_key_id,
      secretAccessKey: config.aws_secret_access_key,
    },
  }),
});

const docClient = DynamoDBDocumentClient.from(client);

export default docClient;
