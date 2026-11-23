// Pure-JS mirror of the close circuit math (must stay bit-for-bit identical to close.circom).
export const WINDOW = 16;
export const MAX_LEVERAGE = 20n;
const BIG = 1n << 136n;

/**
 * @param {object} p
 * @param {bigint|number|boolean} p.isLong
 * @param {bigint} p.margin
 * @param {bigint|number} p.leverage   1..20
 * @param {number} p.closeOffset       1..15
 * @param {bigint[]} p.closes  16 values (index scaled 1e4)
 * @param {bigint[]} p.lows    16 values
 * @param {bigint[]} p.highs   16 values
 */
export function computeClose({ isLong, margin, leverage, closeOffset, closes, lows, highs }) {
  const long = BigInt(isLong ? 1 : 0) === 1n;
  const M = BigInt(margin);
  const L = BigInt(leverage);
  const off = Number(closeOffset);
  if (L < 1n || L > MAX_LEVERAGE) throw new Error("leverage must be in [1,20]");
  if (!(off >= 1 && off <= 15)) throw new Error("closeOffset must be in [1,15]");
  const C = closes.map(BigInt);
  const lo = lows.map(BigInt);
  const hi = highs.map(BigInt);
  for (let i = 0; i <= off; i++) if (C[i] === 0n) throw new Error(`closes[${i}] not finalized`);

  const entry = C[0];
  const exit = C[off];
  const notional = M * L;
  const tenL = 10n * L;

  let knockedOut = false;
  for (let i = 1; i <= off; i++) {
    if (long && lo[i] * tenL <= entry * (tenL - 9n)) knockedOut = true;
    if (!long && hi[i] * tenL >= entry * (tenL + 9n)) knockedOut = true;
  }

  const up = exit >= entry;
  const absDiff = up ? exit - entry : entry - exit;
  const prod = notional * absDiff;
  const absPnl = prod >= BIG * entry ? BIG : prod / entry; // BIG always clamps
  const win = (long && up) || (!long && !up);
  const pnl = win ? absPnl : -absPnl;
  const fee = notional / 500n; // = floor(notional * 20 / 10000)

  let net = M + pnl - fee;
  if (net < 0n) net = 0n;
  const cap = 10n * M;
  if (net > cap) net = cap;
  const payout = knockedOut ? 0n : net;

  // liquidation thresholds (informational): long KO if low <= liqLow, short KO if high >= liqHigh
  return { payout, knockedOut, pnl, fee, notional, entry, exit };
}

/** Index level at/below which a long is knocked out (exact rational, as a float for UI). */
export function liquidationLevel(entry, leverage, isLong) {
  const e = Number(entry);
  const l = Number(leverage);
  return isLong ? e * (1 - 0.9 / l) : e * (1 + 0.9 / l);
}
