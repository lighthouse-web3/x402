import app from "./app.js";
import config from "./config/index.js";

process.on("uncaughtException", (error) => {
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  process.exit(1);
});

try {
  const port = Number(config.port) || 8000;
  app.listen(port, () => {
    console.log(`x402 API Server is running on port ${port}`);
  });
} catch (error) {
  process.exit(1);
}
