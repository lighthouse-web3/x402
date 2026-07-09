import { paymentMiddleware, x402ResourceServer, Network } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient, RoutesConfig } from "@x402/core/server";
import { generateJwt } from "@coinbase/cdp-sdk/auth";
import config from "../config.js";
import logger from "../utils/logger.js";
import { updateFileRecordTxHash } from "../db/fileRecord.js";

const network = config.network as Network;

logger.info("Initializing x402 payment middleware", {
  network,
  facilitatorUrl: config.facilitatorUrl,
  recipientAddress: config.recipientAddress,
});

const useCdpAuth = !!(config.cdpApiKeyId && config.cdpApiKeySecret);

async function cdpCreateAuthHeaders() {
  const makeBearerHeader = async (method: string, path: string) => {
    const jwt = await generateJwt({
      apiKeyId: config.cdpApiKeyId,
      apiKeySecret: config.cdpApiKeySecret,
      requestMethod: method,
      requestHost: "api.cdp.coinbase.com",
      requestPath: `/platform/v2/x402/${path}`,
    });
    return { Authorization: `Bearer ${jwt}` } as Record<string, string>;
  };

  return {
    verify: await makeBearerHeader("POST", "verify"),
    settle: await makeBearerHeader("POST", "settle"),
    supported: await makeBearerHeader("GET", "supported"),
  };
}

const facilitatorClient = new HTTPFacilitatorClient({
  url: config.facilitatorUrl,
  ...(useCdpAuth && { createAuthHeaders: cdpCreateAuthHeaders }),
});

export const resourceServer = new x402ResourceServer(facilitatorClient).register(
  network,
  new ExactEvmScheme()
);

// Map payer address → file record ID so the settlement hook can update the DB
// with the real tx hash (which only exists after the facilitator settles on-chain).
export const pendingSettlements = new Map<string, { recordId: string; publicKey: string }>();

resourceServer.onAfterSettle(async (context) => {
  const payer =
    (context.result.payer as string | undefined) ||
    (context.paymentPayload.payload as Record<string, Record<string, string>>)?.authorization
      ?.from ||
    (context.paymentPayload.payload as Record<string, Record<string, string>>)?.permit2Authorization
      ?.from ||
    "";

  const txHash = context.result.transaction || "";
  const payerKey = payer.toLowerCase();

  logger.info("Payment settled on-chain", {
    payer,
    txHash,
    success: context.result.success,
    network: context.requirements.network,
  });

  const pending = pendingSettlements.get(payerKey);
  if (pending && txHash) {
    try {
      await updateFileRecordTxHash(pending.recordId, txHash);
      logger.info("File record updated with tx hash", {
        recordId: pending.recordId,
        txHash,
      });
    } catch (err) {
      logger.error("Failed to update file record with tx hash", {
        recordId: pending.recordId,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      pendingSettlements.delete(payerKey);
    }
  } else if (!pending) {
    logger.warn("Settlement completed but no pending file record found", { payer, txHash });
  }
});

export function createPaymentMiddleware(routes: RoutesConfig) {
  return paymentMiddleware(routes, resourceServer);
}

export { network };
