import app from "./app.js";
import config from "./config/index.js";
import { startAllWorkers, stopAllWorkers } from "./workers/index.js";

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  stopAllWorkers();
  process.exit(1);
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection:", reason);
  stopAllWorkers();
  process.exit(1);
});

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\nReceived SIGINT. Graceful shutdown...");
  stopAllWorkers();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\nReceived SIGTERM. Graceful shutdown...");
  stopAllWorkers();
  process.exit(0);
});

try {
  const port = Number(config.port) || 8000;

  app.listen(port, () => {
    console.log(`x402 API Server is running on port ${port}`);
    console.log(`Environment: ${config.environment}`);

    // Start background workers after server is running
    if (config.workers_enabled) {
      console.log("\nStarting background workers...");
      startAllWorkers();
    } else {
      console.log("\nWorkers disabled (WORKERS_ENABLED=false)");
    }
  });
} catch (error) {
  console.error("Failed to start server:", error);
  process.exit(1);
}
