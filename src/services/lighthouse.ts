import lighthouse from "@lighthouse-web3/sdk";
import config from "../config.js";

export async function uploadToLighthouse(filePath: string): Promise<{ cid: string; size: number }> {
  if (!config.lighthouseApiKey) {
    throw new Error("LIGHTHOUSE_API_KEY is not configured");
  }

  const response = await lighthouse.upload(filePath, config.lighthouseApiKey, {
    cidVersion: 1,
    headers: { storageType: "lifetime" },
  });

  if (!response?.data?.Hash) {
    throw new Error("Invalid response from Lighthouse — no CID returned");
  }

  return {
    cid: response.data.Hash,
    size: parseInt(String(response.data.Size)) || 0,
  };
}
