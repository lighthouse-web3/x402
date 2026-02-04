import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocument } from '@aws-sdk/lib-dynamodb'
import config from '../../config/index.js'

// Build DynamoDB client config
const clientConfig: any = {
  region: config.aws_region || 'us-east-1',
}

// Add endpoint for LocalStack if configured
if (config.aws_endpoint) {
  clientConfig.endpoint = config.aws_endpoint
}

// Add credentials if provided
if (config.aws_access_key_id && config.aws_secret_access_key) {
  clientConfig.credentials = {
    accessKeyId: config.aws_access_key_id,
    secretAccessKey: config.aws_secret_access_key,
  }
}

const client = new DynamoDBClient(clientConfig)

export default DynamoDBDocument.from(client)

