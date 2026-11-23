# Parlo circuits

> ## ⚠️ DEV TRUSTED SETUP — NOT FOR REAL FUNDS
> `build.sh` makes its own powers of tau (`build/pot16_final.ptau`, 2^16) and one phase-2
> contribution per circuit, all on one machine using local OS randomness. Whoever knows that
> randomness (the "toxic waste") can forge proofs for **any** statement and drain the pool.
> Before real funds go in you **must**:
> 1. use a public, multi-party phase-1 ptau (for example a Perpetual Powers of Tau / Hermez
>    `powersOfTau28_hez_final_16.ptau` file, checked against its published hash), and
> 2. run a multi-party phase-2 ceremony for each circuit (`snarkjs zkey contribute` from several
>    independent parties, then `zkey beacon`), and
> 3. regenerate the verifiers, the zkeys in `web/public/zk/` and the contract fixtures.

Circom 2 (circom 2.2.3 via `npx circom2`), Groth16 on BN254, snarkjs 0.7.5, circomlib Poseidon.
Hashes, public-input order and the math follow `../SPEC.md` exactly.

## Layout
| Path | |
|---|---|
| `lib/merkle.circom` | Poseidon Merkle proof (depth 20). `pathIndices[i]` = bit i of the leaf index (0 = left), each binary-constrained |
| `transact.circom` | 2-in/2-out join-split, N=7 public inputs |
| `open.circom` | Spend a note, create a change note and a position note, N=7 |
| `close.circom` | Settle a position against oracle closes/lows/highs, N=56 |
| `build.sh` | ptau (if missing), compile, setup + 1 contribution, vkeys, Solidity verifiers, copy to `web/public/zk/` |
| `js/` | ES-module helpers (Node and browser): Poseidon, keys, commitments and nullifiers, Merkle tree, payout math, input builders, proof formatting for Solidity |
| `test/*.test.mjs` | `node --test`: real proofs plus negative cases |
| `test/fixtures.mjs` | writes `contracts/test/fixtures/{transact,open,close}.json` |

```bash
./build.sh                 # ~5 min the first time (ptau), then ~2-3 min
npm test                   # node --test test/*.test.mjs
npm run fixtures           # regenerate contract fixtures
```

## Public inputs (order is binding)
- **transact** `[root, publicAmount, extDataHash, inNullifier0, inNullifier1, outCommitment0, outCommitment1]`
- **open** `[root, inNullifier, changeCommitment, positionCommitment, marketId, margin, epoch]`
- **close** `[positionRoot, positionNullifier, outCommitment, marketId, margin, entryEpoch, closeOffset, payout, closes[0..15], lows[0..15], highs[0..15]]`

## Constraint details and choices the SPEC leaves open
- **Amounts** (note amounts, margin, change, payout) are checked to fit in 128 bits with `Num2Bits(128)`.
- **transact**: one `privKey` owns both inputs. Outputs can go to any `outPubKey` (to yourself or a
  transfer). An input with amount 0 skips the root check (`ForceEqualIfEnabled`, enabled = amount).
  The two input nullifiers must be different. `extDataHash` is squared inside the circuit to bind it.
- **open**: `margin <= inAmount` holds because `change = inAmount - margin` must fit in 128 bits.
  `leverage` is in [1,20] (`Num2Bits(5)`, `< 21`, `!= 0`) and `isLong` is 0 or 1.
- **close**:
  - **Index values** (`closes`, `lows`, `highs`) must be below 2^64. This keeps every product
    below the field size. A value of 2^64 or more cannot be proven.
  - **Slot selection**: `closeOffset` must be in [1,15] (`Num2Bits(4)`, `!= 0`). `closes[0..closeOffset]`
    must be **non-zero**. An unfinalized (zero) slot at or before the exit makes the proof fail.
  - **Knock-out** is computed exactly, with no rounding:
    - long: `lows[i]*10L <= entry*(10L-9)`
    - short: `highs[i]*10L >= entry*(10L+9)`

    Only slots `1..closeOffset` are checked.
  - **pnl**: `|pnl| = floor(notional*|exit-entry|/entry)` (rounds toward zero). The sign is + for a
    long when `exit >= entry`, and + for a short when `exit < entry`. The division is checked
    as `q*entry + r == prod`, `r < entry` (`LessThan(64)` with `r` range-checked).
  - **Huge pnl**: if `|pnl| >= 2^136`, the circuit uses 2^136 instead. Its sign alone then decides
    the clamp: payout is 0 or `10*margin`. This keeps `q < 2^136`, so `q*entry < 2^200` and the
    field cannot wrap around.
  - **Fee**: `fee = floor(notional/500)`, the same value as `notional*20/10000`.
  - **Payout**: `payout = knockedOut ? 0 : clamp(margin + pnl - fee, 0, 10*margin)`.
  - `js/payout.mjs#computeClose` mirrors the circuit exactly. Use it to fill the public `payout`.
- **Merkle**: `H(l, r) = Poseidon(l, r)`, zero leaf 0, `zeros[i+1] = H(zeros[i], zeros[i])`, which
  matches `MerkleTreeWithHistory` with PoseidonT3. Empty depth-20 root:
  `15019797232609675441998260052101280400536945603062888308240081994073687793470`.

## Solidity proof format
`js/prover.mjs#toSolidityProof(proof, publicSignals)` returns `{a, b, c, publicSignals}` in the
argument order of `verifyProof(uint[2], uint[2][2], uint[2], uint[N])`. The G2 point `b` has its
coordinates swapped: `[[b01, b00], [b11, b10]]`. The fixtures in `contracts/test/fixtures/` use this
format, as decimal strings.
