import app from "./app.js";
import config from "./config.js";

app.listen(config.port, () => {
  console.log(
    `\nx402 Lighthouse Upload API running on http://localhost:${config.port}`
  );
  console.log(`  Network:   ${config.network}`);
  console.log(`  Recipient: ${config.recipientAddress}`);
  console.log(`  Price:     $${config.pricePerMb} / MB\n`);
});
