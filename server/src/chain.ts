import { createPublicClient, createWalletClient, defineChain, http, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc, bscTestnet } from "viem/chains";
import { config, normalizeKey, rpcUrl } from "./config.js";

export const chain: Chain =
  config.CHAIN_ID === 56
    ? bsc
    : config.CHAIN_ID === 97
      ? bscTestnet
      : defineChain({
          id: config.CHAIN_ID,
          name: `chain-${config.CHAIN_ID}`,
          nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
          rpcUrls: { default: { http: [rpcUrl] } },
        });

export const publicClient = createPublicClient({ chain, transport: http(rpcUrl, { timeout: 20_000, retryCount: 2 }) });

export function walletFor(privateKey: string) {
  const account = privateKeyToAccount(normalizeKey(privateKey));
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl, { timeout: 20_000, retryCount: 1 }) });
  return { account, wallet };
}

/** Serialize async tasks (one in-flight tx per signer keeps nonces sane). */
export class Mutex {
  private chainP: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chainP.then(fn, fn);
    this.chainP = p.catch(() => undefined);
    return p;
  }
}
