#!/usr/bin/env bash
# Parlo circuits build: compile -> groth16 setup (DEV, single contributor) -> vkeys -> Solidity verifiers
# -> copy wasm/zkey to the frontend.
#
#   !!! DEV TRUSTED SETUP ONLY. Both the powers-of-tau and the phase-2 contribution below are made by
#   !!! a single local party with OS randomness. Anyone who knows that randomness can forge proofs.
#   !!! A multi-party ceremony (and a public phase-1 ptau) is REQUIRED before real funds.
#
# Usage: ./build.sh            (from anywhere)
#        PTAU_POWER=16 ./build.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
cd "$HERE"

SNARKJS="$HERE/node_modules/.bin/snarkjs"
BUILD="$HERE/build"
VERIFIERS="$ROOT/contracts/src/verifiers"
WEB_ZK="$ROOT/web/public/zk"
PTAU_POWER="${PTAU_POWER:-16}"
PTAU="$BUILD/pot${PTAU_POWER}_final.ptau"
CIRCUITS=(transact open close)

mkdir -p "$BUILD" "$VERIFIERS" "$WEB_ZK"

rand() { node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))'; }

# ---------- 1. local DEV powers of tau (no downloads) ----------
if [[ ! -f "$PTAU" ]]; then
  echo "==> generating DEV powers of tau 2^$PTAU_POWER (local, single contributor)"
  "$SNARKJS" powersoftau new bn128 "$PTAU_POWER" "$BUILD/pot_tmp_0.ptau"
  "$SNARKJS" powersoftau contribute "$BUILD/pot_tmp_0.ptau" "$BUILD/pot_tmp_1.ptau" \
    --name="parlo-dev-ptau" -e="$(rand)"
  "$SNARKJS" powersoftau prepare phase2 "$BUILD/pot_tmp_1.ptau" "$PTAU"
  rm -f "$BUILD/pot_tmp_0.ptau" "$BUILD/pot_tmp_1.ptau"
fi

for c in "${CIRCUITS[@]}"; do
  Name="$(tr '[:lower:]' '[:upper:]' <<< "${c:0:1}")${c:1}"
  echo "==> [$c] compile"
  npx circom2 "$c.circom" --O2 --r1cs --wasm --sym -o "$BUILD"
  "$SNARKJS" r1cs info "$BUILD/$c.r1cs"

  echo "==> [$c] groth16 setup + 1 DEV contribution"
  "$SNARKJS" groth16 setup "$BUILD/$c.r1cs" "$PTAU" "$BUILD/${c}_0000.zkey"
  "$SNARKJS" zkey contribute "$BUILD/${c}_0000.zkey" "$BUILD/$c.zkey" \
    --name="parlo-dev-$c" -e="$(rand)"
  rm -f "$BUILD/${c}_0000.zkey"
  "$SNARKJS" zkey verify "$BUILD/$c.r1cs" "$PTAU" "$BUILD/$c.zkey"

  echo "==> [$c] export verification key + Solidity verifier"
  "$SNARKJS" zkey export verificationkey "$BUILD/$c.zkey" "$BUILD/${c}_vkey.json"
  "$SNARKJS" zkey export solidityverifier "$BUILD/$c.zkey" "$VERIFIERS/${Name}Verifier.sol"
  sed -i.bak "s/contract Groth16Verifier/contract ${Name}Verifier/" "$VERIFIERS/${Name}Verifier.sol"
  rm -f "$VERIFIERS/${Name}Verifier.sol.bak"

  echo "==> [$c] copy artifacts to web/public/zk"
  cp "$BUILD/${c}_js/$c.wasm" "$WEB_ZK/$c.wasm"
  cp "$BUILD/$c.zkey" "$WEB_ZK/$c.zkey"
  cp "$BUILD/${c}_vkey.json" "$WEB_ZK/${c}_vkey.json"
done

echo "==> done. DEV SETUP ONLY - run a multi-party ceremony before real funds."
