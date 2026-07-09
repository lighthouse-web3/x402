import lighthouse from "@lighthouse-web3/sdk";
import config from "../config.js";
import logger from "../utils/logger.js";

export async function uploadToLighthouse(filePath: string): Promise<{ cid: string; size: number }> {
  if (!config.lighthouseApiKey) {
    logger.error("LIGHTHOUSE_API_KEY is not configured");
    throw new Error("LIGHTHOUSE_API_KEY is not configured");
  }

  logger.debug("Sending file to Lighthouse SDK", { filePath });

  const response = await lighthouse.upload(filePath, config.lighthouseApiKey, {
    cidVersion: 1,
    headers: { storageType: "walrus" },
  });

  if (!response?.data?.Hash) {
    logger.error("Invalid response from Lighthouse — no CID returned", {
      response: JSON.stringify(response?.data),
    });
    throw new Error("Invalid response from Lighthouse — no CID returned");
  }

  const result = {
    cid: response.data.Hash,
    size: parseInt(String(response.data.Size)) || 0,
  };

  logger.debug("Lighthouse SDK response", { cid: result.cid, size: result.size });
  return result;
}
