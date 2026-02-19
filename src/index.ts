import app from "./app.js";
import config from "./config.js";
import logger from "./utils/logger.js";

process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  logger.error("Unhandled promise rejection", { message, stack });
  setTimeout(() => process.exit(1), 500);
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception", { message: error.message, stack: error.stack });
  setTimeout(() => process.exit(1), 500);
});

app.listen(config.port, () => {
  logger.info(`x402 Lighthouse Upload API running on http://localhost:${config.port}`);
  logger.info(`Network: ${config.network}`);
  logger.info(`Recipient: ${config.recipientAddress}`);
  logger.info(`Price: $${config.pricePerMb} / MB`);
  logger.info(`Log level: ${config.logLevel}`);
});
