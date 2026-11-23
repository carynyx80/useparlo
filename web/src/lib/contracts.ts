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

export const CONTRACTS_CONFIGURED = !!(POOL_ADDRESS && ORACLE_ADDRESS && VAULT_ADDRESS)

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

export const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
])

export const oracleAbi = parseAbi([
  'function currentEpoch() view returns (uint256)',
  'function getEpoch(uint256 marketId, uint256 epoch) view returns (uint256 close, uint256 low, uint256 high, bool finalized)',
  'function marketSymbol(uint256 marketId) view returns (string)',
  'event Pushed(uint256 indexed marketId, uint256 indexed epoch, uint256 value)',
  'event MarketAdded(uint256 indexed marketId, string symbol)',
])

export const vaultAbi = parseAbi([
  'function deposit(uint256 assets) returns (uint256 shares)',
  'function withdraw(uint256 shares) returns (uint256 assets)',
  'function totalAssets() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
])

/**
 * ParloPool ABI. Proof args are Groth16 (a, b, c) + public signals per circuit.
 * Kept loose (bytes for ext data) so it can be swapped for the compiled ABI from contracts/out.
 */
export const poolAbi = parseAbi([
  'struct ExtData { address recipient; int256 extAmount; address relayer; uint256 fee; bytes encOut0; bytes encOut1; }',
  'function transact(uint256[2] a, uint256[2][2] b, uint256[2] c, uint256[] publicSignals, ExtData ext)',
  'function openPosition(uint256[2] a, uint256[2][2] b, uint256[2] c, uint256[7] publicSignals, bytes encPosition, bytes encChange)',
  'function closePosition(uint256[2] a, uint256[2][2] b, uint256[2] c, uint256[] publicSignals, bytes encOut)',
  'function getLastNoteRoot() view returns (bytes32)',
  'function getLastPositionRoot() view returns (bytes32)',
  'function isSpent(bytes32 nullifier) view returns (bool)',
  'event NewNote(bytes32 commitment, uint256 index, bytes encryptedOutput)',
  'event NewPosition(bytes32 commitment, uint256 index, uint256 marketId, uint256 margin, uint256 epoch, bytes encryptedOutput)',
  'event NullifierSpent(bytes32 nullifier)',
])
