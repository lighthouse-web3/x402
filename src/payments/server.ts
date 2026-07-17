import { paymentMiddleware, x402ResourceServer, Network } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient, RoutesConfig } from "@x402/core/server";
import { generateJwt } from "@coinbase/cdp-sdk/auth";
import config from "../config.js";
import logger from "../utils/logger.js";
import { markFileRecordPaid, extendFileRecordExpiry } from "../db/fileRecord.js";
import { paymentKeyFromPayload } from "../utils/paymentHeader.js";

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

/**
 * DB mutation to perform once a payment settles on-chain.
 *
 * DB writes are deferred to settlement so a failed payment can never leave a
 * record showing paid storage. The map is keyed per payment (payer + nonce, see
 * paymentKeyFromPayload) so concurrent payments from one wallet can't cross-wire.
 */
export type PendingSettlementInput =
  | { kind: "upload"; recordId: string; expiresAt: number }
  | { kind: "renew"; recordId: string };

export type PendingSettlement = PendingSettlementInput & { registeredAt: number };

const pendingSettlements = new Map<string, PendingSettlement>();

/** Entries older than this are considered abandoned (settlement never fired). */
const PENDING_TTL_MS = 15 * 60 * 1000;

function pruneStalePending(): void {
  const cutoff = Date.now() - PENDING_TTL_MS;
  for (const [key, entry] of pendingSettlements) {
    if (entry.registeredAt < cutoff) {
      logger.warn("Dropping stale pending settlement (settlement never completed)", {
        paymentKey: key,
        kind: entry.kind,
        recordId: entry.recordId,
      });
      pendingSettlements.delete(key);
    }
  }
}

export function registerPendingSettlement(paymentKey: string, entry: PendingSettlementInput): void {
  pruneStalePending();
  if (!paymentKey) {
    logger.warn("Cannot register pending settlement without payment key", {
      recordId: entry.recordId,
    });
    return;
  }
  pendingSettlements.set(paymentKey, { ...entry, registeredAt: Date.now() });
}

function settlementKeyFromContext(context: {
  result: { payer?: unknown };
  paymentPayload: { payload: unknown };
}): { payer: string; paymentKey: string } {
  const payload = context.paymentPayload.payload as
    | {
        authorization?: { from?: string; nonce?: string };
        permit2Authorization?: { from?: string; nonce?: string };
      }
    | undefined;

  const payer = (
    (context.result.payer as string | undefined) ||
    payload?.authorization?.from ||
    payload?.permit2Authorization?.from ||
    ""
  ).toLowerCase();

  return { payer, paymentKey: payer ? paymentKeyFromPayload(payload, payer) : "" };
}

// IMPORTANT: this hook must never throw. @x402/express treats an onAfterSettle
// error as a settlement failure and replies 402 to a client whose payment
// already went through on-chain.
resourceServer.onAfterSettle(async (context) => {
  const { payer, paymentKey } = settlementKeyFromContext(context);
  const txHash = context.result.transaction || "";

  logger.info("Payment settled on-chain", {
    payer,
    txHash,
    success: context.result.success,
    network: context.requirements.network,
  });

  const pending = paymentKey ? pendingSettlements.get(paymentKey) : undefined;
  if (!pending) {
    logger.warn("Settlement completed but no pending file record found", { payer, txHash });
    return;
  }
  pendingSettlements.delete(paymentKey);

  if (!context.result.success) {
    logger.warn("Settlement reported failure — leaving record unpaid", {
      recordId: pending.recordId,
      payer,
    });
    return;
  }

  try {
    if (pending.kind === "upload") {
      await markFileRecordPaid(pending.recordId, txHash, pending.expiresAt);
      logger.info("File record marked paid after settlement", {
        recordId: pending.recordId,
        txHash,
        expiresAt: pending.expiresAt,
      });
    } else {
      const expiresAt = await extendFileRecordExpiry(pending.recordId, txHash);
      logger.info("File record expiry extended after settlement", {
        recordId: pending.recordId,
        txHash,
        expiresAt,
      });
    }
  } catch (err) {
    // Payment settled but the DB write failed: needs manual reconciliation.
    logger.error("PAYMENT RECONCILIATION NEEDED: settled payment not reflected in DB", {
      kind: pending.kind,
      recordId: pending.recordId,
      payer,
      txHash,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

resourceServer.onSettleFailure(async (context) => {
  const { payer, paymentKey } = settlementKeyFromContext({
    result: {},
    paymentPayload: context.paymentPayload,
  });

  const pending = paymentKey ? pendingSettlements.get(paymentKey) : undefined;
  if (pending) {
    pendingSettlements.delete(paymentKey);
  }

  logger.warn("Payment settlement failed — record left unpaid", {
    payer,
    recordId: pending?.recordId,
    error: context.error instanceof Error ? context.error.message : String(context.error),
  });
});

export function createPaymentMiddleware(routes: RoutesConfig) {
  return paymentMiddleware(routes, resourceServer);
}

export { network };
