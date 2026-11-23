// Port of circuits/js/payout.mjs -- must stay bit-for-bit identical to close.circom.
export const WINDOW = 16
export const MAX_LEVERAGE = 20n
const BIG = 1n << 136n

export type CloseParams = {
  isLong: bigint | number | boolean
  margin: bigint
  leverage: bigint | number
  closeOffset: number | bigint
  closes: Array<bigint | number | string>
  lows: Array<bigint | number | string>
  highs: Array<bigint | number | string>
}

export type CloseResult = {
  payout: bigint
  knockedOut: boolean
  pnl: bigint
  fee: bigint
  notional: bigint
  entry: bigint
  exit: bigint
}

export function computeClose({ isLong, margin, leverage, closeOffset, closes, lows, highs }: CloseParams): CloseResult {
  const long = BigInt(isLong ? 1 : 0) === 1n
  const M = BigInt(margin)
  const L = BigInt(leverage)
  const off = Number(closeOffset)
  if (L < 1n || L > MAX_LEVERAGE) throw new Error('leverage must be in [1,20]')
  if (!(off >= 1 && off <= 15)) throw new Error('closeOffset must be in [1,15]')
  const C = closes.map(BigInt)
  const lo = lows.map(BigInt)
  const hi = highs.map(BigInt)
  for (let i = 0; i <= off; i++) if (C[i] === 0n) throw new Error(`closes[${i}] not finalized`)

  const entry = C[0]
  const exit = C[off]
  const notional = M * L
  const tenL = 10n * L

  let knockedOut = false
  for (let i = 1; i <= off; i++) {
    if (long && lo[i] * tenL <= entry * (tenL - 9n)) knockedOut = true
    if (!long && hi[i] * tenL >= entry * (tenL + 9n)) knockedOut = true
  }

  const up = exit >= entry
  const absDiff = up ? exit - entry : entry - exit
  const prod = notional * absDiff
  const absPnl = prod >= BIG * entry ? BIG : prod / entry
  const win = (long && up) || (!long && !up)
  const pnl = win ? absPnl : -absPnl
  const fee = notional / 500n

  let net = M + pnl - fee
  if (net < 0n) net = 0n
  const cap = 10n * M
  if (net > cap) net = cap
  const payout = knockedOut ? 0n : net
  return { payout, knockedOut, pnl, fee, notional, entry, exit }
}

/** Index level at/below which a long is knocked out (float, for UI). */
export function liquidationLevel(entry: number | bigint, leverage: number | bigint, isLong: boolean): number {
  const e = Number(entry)
  const l = Number(leverage)
  return isLong ? e * (1 - 0.9 / l) : e * (1 + 0.9 / l)
}
