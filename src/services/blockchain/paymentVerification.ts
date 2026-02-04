import { ethers } from "ethers";
import config from "../../config/index.js";
import logger from "../../utils/logger.js";
import { NetworkId, USDC_ADDRESSES, CHAIN_IDS } from "../../types/x402.js";

// ============================================
// USDC ERC-20 Transfer Event ABI
// ============================================

const USDC_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];

// ============================================
// Types
// ============================================

export interface PaymentVerificationResult {
  success: boolean;
  verified: boolean;
  error?: string;
  details?: {
    txHash: string;
    from: string;
    to: string;
    amount: string;
    blockNumber: number;
    confirmations: number;
    timestamp?: number;
  };
}

export interface VerifyPaymentParams {
  txHash: string;
  network: NetworkId;
  expectedFrom: string;
  expectedTo: string;
  expectedAmount: string;
  minConfirmations?: number;
}

// ============================================
// RPC Provider Management
// ============================================

/**
 * Get RPC URL for a network
 */
const getRpcUrl = (network: NetworkId): string => {
  switch (network) {
    case "eip155:8453":
      return config.rpc_base_mainnet;
    case "eip155:84532":
      return config.rpc_base_sepolia;
    default:
      throw new Error(`Unsupported network: ${network}`);
  }
};

/**
 * Create a provider for the specified network
 */
const getProvider = (network: NetworkId): ethers.JsonRpcProvider => {
  const rpcUrl = getRpcUrl(network);
  const chainId = CHAIN_IDS[network];

  return new ethers.JsonRpcProvider(rpcUrl, {
    chainId,
    name: network,
  });
};

// ============================================
// Payment Verification
// ============================================

/**
 * Verify a USDC payment transaction on-chain
 *
 * Checks:
 * 1. Transaction exists and is confirmed
 * 2. Transaction is on the expected network
 * 3. USDC Transfer event exists with correct from/to/amount
 */
export const verifyPayment = async (
  params: VerifyPaymentParams
): Promise<PaymentVerificationResult> => {
  const {
    txHash,
    network,
    expectedFrom,
    expectedTo,
    expectedAmount,
    minConfirmations = config.payment_min_confirmations,
  } = params;

  try {
    logger.info(`Verifying payment: ${txHash} on ${network}`);

    // 1. Validate network is supported
    if (network !== "eip155:8453" && network !== "eip155:84532") {
      return {
        success: false,
        verified: false,
        error: `Unsupported network: ${network}. Only Base Mainnet and Base Sepolia are supported.`,
      };
    }

    // 2. Get provider and USDC address
    const provider = getProvider(network);
    const usdcAddress = USDC_ADDRESSES[network];

    // 3. Get transaction receipt
    const receipt = await provider.getTransactionReceipt(txHash);

    if (!receipt) {
      return {
        success: true,
        verified: false,
        error: "Transaction not found or not yet confirmed",
      };
    }

    // 4. Check transaction status (1 = success)
    if (receipt.status !== 1) {
      return {
        success: true,
        verified: false,
        error: "Transaction failed on-chain",
      };
    }

    // 5. Check confirmations
    const currentBlock = await provider.getBlockNumber();
    const confirmations = currentBlock - receipt.blockNumber + 1;

    if (confirmations < minConfirmations) {
      return {
        success: true,
        verified: false,
        error: `Insufficient confirmations: ${confirmations}/${minConfirmations}`,
      };
    }

    // 6. Parse USDC Transfer events from the receipt
    const usdcInterface = new ethers.Interface(USDC_ABI);
    let transferFound = false;
    let transferDetails: PaymentVerificationResult["details"] | undefined;

    for (const log of receipt.logs) {
      // Check if this log is from the USDC contract
      if (log.address.toLowerCase() !== usdcAddress.toLowerCase()) {
        continue;
      }

      try {
        const parsed = usdcInterface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        });

        if (parsed && parsed.name === "Transfer") {
          const from = parsed.args[0] as string;
          const to = parsed.args[1] as string;
          const value = parsed.args[2] as bigint;

          // Check if this is the transfer we're looking for
          if (
            from.toLowerCase() === expectedFrom.toLowerCase() &&
            to.toLowerCase() === expectedTo.toLowerCase()
          ) {
            transferFound = true;

            // Verify amount (allow slight tolerance for gas)
            const expectedAmountBigInt = BigInt(expectedAmount);
            const actualAmount = value;

            if (actualAmount < expectedAmountBigInt) {
              return {
                success: true,
                verified: false,
                error: `Insufficient payment amount. Expected: ${expectedAmount}, Got: ${actualAmount.toString()}`,
              };
            }

            // Get block timestamp
            const block = await provider.getBlock(receipt.blockNumber);

            transferDetails = {
              txHash,
              from,
              to,
              amount: actualAmount.toString(),
              blockNumber: receipt.blockNumber,
              confirmations,
              timestamp: block?.timestamp,
            };

            break;
          }
        }
      } catch {
        // Not a Transfer event or parsing failed, continue
        continue;
      }
    }

    if (!transferFound) {
      return {
        success: true,
        verified: false,
        error: `No USDC transfer found from ${expectedFrom} to ${expectedTo}`,
      };
    }

    logger.info(`Payment verified: ${txHash}`);

    return {
      success: true,
      verified: true,
      details: transferDetails,
    };
  } catch (error: any) {
    logger.error(`Payment verification error: ${error.message}`);

    return {
      success: false,
      verified: false,
      error: `Verification failed: ${error.message}`,
    };
  }
};

/**
 * Quick check if a transaction exists and is confirmed
 * (Does not verify transfer details)
 */
export const checkTransactionExists = async (
  txHash: string,
  network: NetworkId
): Promise<{ exists: boolean; confirmed: boolean; error?: string }> => {
  try {
    const provider = getProvider(network);
    const receipt = await provider.getTransactionReceipt(txHash);

    if (!receipt) {
      return { exists: false, confirmed: false };
    }

    return {
      exists: true,
      confirmed: receipt.status === 1,
    };
  } catch (error: any) {
    return {
      exists: false,
      confirmed: false,
      error: error.message,
    };
  }
};

/**
 * Get current block number for a network
 */
export const getCurrentBlockNumber = async (
  network: NetworkId
): Promise<number> => {
  const provider = getProvider(network);
  return provider.getBlockNumber();
};
