import app from "./app.js";
import config from "./config.js";
import logger from "./utils/logger.js";

app.listen(config.port, () => {
  logger.info(`x402 Lighthouse Upload API running on http://localhost:${config.port}`);
  logger.info(`Network: ${config.network}`);
  logger.info(`Recipient: ${config.recipientAddress}`);
  logger.info(`Price: $${config.pricePerMb} / MB`);
  logger.info(`Log level: ${config.logLevel}`);
});
