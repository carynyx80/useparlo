import { parseAbi, type Address } from 'viem'

const env = import.meta.env
const addr = (v: unknown): Address | undefined =>
  typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as Address) : undefined

/** BSC USDT (18 decimals). Override with VITE_USDT_ADDRESS (e.g. a testnet mock). */
export const USDT_ADDRESS: Address = addr(env.VITE_USDT_ADDRESS) ?? '0x55d398326f99059fF775485246999027B3197955'
export const USDT_DECIMALS = 18
export const POOL_ADDRESS = addr(env.VITE_POOL_ADDRESS)
export const ORACLE_ADDRESS = addr(env.VITE_ORACLE_ADDRESS)
export const VAULT_ADDRESS = addr(env.VITE_VAULT_ADDRESS)
export const TREASURY_ADDRESS: Address = '0xB34296465F18F55003100e925aBc70656E224035'

/** Real private trading needs the pool + oracle. Without VITE_POOL_ADDRESS the app falls back to a local simulation. */
export const CONTRACTS_CONFIGURED = !!(POOL_ADDRESS && ORACLE_ADDRESS)

// Protocol constants (SPEC.md)
export const MAX_LEVERAGE = 20
export const FEE_BPS_OPEN = 10
export const FEE_BPS_CLOSE = 10
export const POSITION_WINDOW_EPOCHS = 16
export const PROFIT_CAP_MULTIPLE = 10
export const INDEX_SCALE = 10_000 // on-chain index values are uint * 1e4
export const MERKLE_DEPTH = 20

/** Knock-out level per SPEC: long ≤ entry·(1 − 0.9/L), short ≥ entry·(1 + 0.9/L). */
export function liquidationLevel(entry: number, leverage: number, isLong: boolean) {
  const f = 0.9 / leverage
  return isLong ? entry * (1 - f) : entry * (1 + f)
}

export const POOL_DEPLOY_BLOCK = (() => {
  try { return BigInt((env.VITE_POOL_DEPLOY_BLOCK as string | undefined) || 0) } catch { return 0n }
})()

// Exact subsets of contracts/abi/*.json (shared with the zk library / e2e script).
export { erc20Abi, oracleAbi, poolAbi } from './zk/abi.ts'

export const vaultAbi = parseAbi([
  'function deposit(uint256 assets) returns (uint256 shares)',
  'function withdraw(uint256 shares) returns (uint256 assets)',
  'function totalAssets() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
])
