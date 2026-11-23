#!/usr/bin/env node
// Malicious-relayer e2e: open/close proofs are built with the real zk lib, but submitted DIRECTLY to the
// pool from a different account with garbage ciphertexts (0xdeadbeef). A fresh scan with only the
// privKey must still recover the change note, the position (side + leverage) and the payout note via
// deterministic blindings, and the recovered funds must be withdrawable through the normal relayer.
//
//   node scripts/e2e-garbled.mjs
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicClient, createWalletClient, formatUnits, http, parseUnits } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'
import * as zk from '../src/lib/zk/index.ts'

const env = process.env
const RPC_URL = env.RPC_URL ?? 'http://127.0.0.1:8545'
const API_URL = env.API_URL ?? 'http://127.0.0.1:8090'
const POOL = env.POOL ?? '0x9A676e781A523b5d0C0e43731313A708CB607508'
const ORACLE = env.ORACLE ?? '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707'
const USDT = env.USDT ?? '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512'
// anvil default accounts (public test keys) -- Node scripts only
const USER_PK = env.E2E_PRIVATE_KEY ?? '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a' // #4
const ATTACKER_PK = env.E2E_ATTACKER_KEY ?? '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba' // #5
const MARKET_ID = BigInt(env.MARKET_ID ?? 1)
const GARBAGE = '0xdeadbeef'

const zkDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'zk')
const fmt = (v) => `${formatUnits(v, 18)} USDT`
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`)
  log(`   ✓ ${msg}`)
}

const user = privateKeyToAccount(USER_PK)
const attacker = privateKeyToAccount(ATTACKER_PK)
const publicClient = createPublicClient({ chain: foundry, transport: http(RPC_URL) })
const userWallet = createWalletClient({ account: user, chain: foundry, transport: http(RPC_URL) })
const attackerWallet = createWalletClient({ account: attacker, chain: foundry, transport: http(RPC_URL) })
const ctx = {
  publicClient,
  apiUrl: API_URL,
  pool: POOL,
  oracle: ORACLE,
  artifacts: (c) => ({ wasm: path.join(zkDir, `${c}.wasm`), zkey: path.join(zkDir, `${c}.zkey`) }),
}
const step = (m) => log(`   · ${m}`)
const usdtBal = (a) => publicClient.readContract({ address: USDT, abi: zk.erc20Abi, functionName: 'balanceOf', args: [a] })

async function send(wallet, request) {
  const hash = await wallet.writeContract(request)
  await zk.waitForSuccess(ctx, hash)
  return hash
}

/** A brand-new scanner + keypair built from nothing but the privKey (no caches carried over). */
async function freshScan(privKey) {
  const kp = await zk.keypairFromPrivKey(privKey)
  const scanner = new zk.ShieldedScanner(ctx, kp)
  const scan = await scanner.scan()
  return { scan, recovered: scanner.lastRecovered }
}

/** The on-chain leaf (backend index topped up from logs) carrying `commitment`. */
async function leafOf(kind, commitment) {
  return (await zk.fetchLeaves(ctx, kind)).find((l) => l.commitment === commitment)
}

async function main() {
  // Fresh shielded identity (signature of a throwaway signer) so the expected balances are exact.
  const shieldSigner = privateKeyToAccount(generatePrivateKey())
  const kp = await zk.keypairFromSignature(await shieldSigner.signMessage({ message: zk.SHIELDED_ACCOUNT_MESSAGE }))
  const privKey = kp.privKey
  log(`funding wallet ${user.address}; malicious submitter ${attacker.address}`)

  // deposit 300 (user wallet, normal path)
  const dep = parseUnits('300', 18)
  log(`mint 300            tx ${await send(userWallet, { address: USDT, abi: zk.erc20Abi, functionName: 'mint', args: [user.address, dep] })}`)
  log(`approve 300         tx ${await send(userWallet, { address: USDT, abi: zk.erc20Abi, functionName: 'approve', args: [POOL, dep] })}`)
  let scan = await new zk.ShieldedScanner(ctx, kp).scan()
  const { request, commitment } = await zk.prepareDeposit(ctx, kp, scan, dep, step)
  log(`deposit 300         tx ${await send(userWallet, { ...request, account: user })}`)
  await zk.waitForCommitment(ctx, 'notes', commitment)
  ;({ scan } = await freshScan(privKey))
  assert(scan.balance === dep, `fresh scan shows ${fmt(scan.balance)} after deposit`)

  // open SHORT 4x margin 100, submitted directly by the attacker with garbage ciphertexts
  const margin = parseUnits('100', 18)
  const LEV = 4n
  let prep
  for (let attempt = 1; ; attempt++) {
    try {
      prep = await zk.prepareOpen(ctx, kp, scan, { marketId: MARKET_ID, isLong: false, margin, leverage: LEV }, step)
      break
    } catch (err) {
      if (attempt >= 4 || !/stale/i.test(String(err?.message))) throw err
      log(`   · ${err.message} (retry ${attempt})`)
      await sleep(10_000)
    }
  }
  const openHash = await send(attackerWallet, {
    address: POOL, abi: zk.poolAbi, functionName: 'openPosition', args: zk.openCallArgs(prep, GARBAGE, GARBAGE),
  })
  log(`open (garbled)      tx ${openHash}  from ${attacker.address}, entryEpoch ${prep.epoch}`)
  await zk.waitForCommitment(ctx, 'positions', prep.positionCommitment)
  await zk.waitForCommitment(ctx, 'notes', prep.changeCommitment)
  const pLeaf = await leafOf('positions', prep.positionCommitment)
  const cLeaf = await leafOf('notes', prep.changeCommitment)
  assert(pLeaf?.encryptedOutput === GARBAGE && cLeaf?.encryptedOutput === GARBAGE, 'on-chain change + position ciphertexts are garbage (0xdeadbeef)')

  let r = await freshScan(privKey)
  scan = r.scan
  log(`fresh scan: balance ${fmt(scan.balance)}, positions ${scan.positions.length}, recovered ${r.recovered}`)
  const change = scan.notes.find((n) => n.commitment === prep.changeCommitment)
  assert(change && change.amount === dep - margin, 'change note (200) recovered from chain data')
  const pos = scan.positions.find((p) => p.commitment === prep.positionCommitment)
  assert(pos, 'position recovered')
  assert(pos.isLong === false && pos.leverage === LEV && pos.margin === margin && pos.entryEpoch === prep.epoch && pos.marketId === MARKET_ID,
    `position fields: ${pos.isLong ? 'LONG' : 'SHORT'} ${pos.leverage}x margin ${fmt(pos.margin)} market ${pos.marketId} epoch ${pos.entryEpoch}`)
  assert(scan.balance === dep - margin, 'balance exactly 200 after garbled open')
  assert(scan.noteRootKnown && scan.positionRootKnown, 'rebuilt roots known on-chain')

  // wait until closable
  for (;;) {
    const st = await zk.positionStatus(ctx, pos)
    if (st.closeOffset >= 1) break
    log(`   · waiting: epoch ${st.currentEpoch}, entry ${st.entry ?? 'pending'}, closeOffset ${st.closeOffset}`)
    await sleep(5000)
  }

  // close, again submitted directly with a garbage ciphertext
  const cprep = await zk.prepareClose(ctx, kp, scan, pos, step)
  const closeHash = await send(attackerWallet, {
    address: POOL, abi: zk.poolAbi, functionName: 'closePosition', args: zk.closeCallArgs(cprep, GARBAGE),
  })
  log(`close (garbled)     tx ${closeHash}  closeOffset ${cprep.closeOffset} payout ${fmt(cprep.payout)}${cprep.knockedOut ? ' (knocked out)' : ''}`)
  await zk.waitForCommitment(ctx, 'notes', cprep.outCommitment)
  const nLeaf = await leafOf('notes', cprep.outCommitment)
  assert(nLeaf?.encryptedOutput === GARBAGE, 'on-chain payout ciphertext is garbage (0xdeadbeef)')

  r = await freshScan(privKey)
  scan = r.scan
  log(`fresh scan: balance ${fmt(scan.balance)}, positions ${scan.positions.length}, recovered ${r.recovered}`)
  const expected = dep - margin + cprep.payout
  if (cprep.payout > 0n) assert(scan.notes.some((n) => n.commitment === cprep.outCommitment && n.amount === cprep.payout), 'payout note recovered (inductively: deposit → garbled open → garbled close)')
  assert(scan.positions.length === 0, 'closed position no longer listed')
  assert(scan.balance === expected, `balance exactly ${fmt(expected)} (200 + payout)`)

  // withdraw ALL recovered funds via the normal relayer
  const fresh = privateKeyToAccount(generatePrivateKey()).address
  const w = await zk.withdraw(ctx, kp, scan, expected, fresh, step)
  log(`withdraw ${formatUnits(expected, 18)} → ${fresh}  tx ${w.txHash}`)
  assert((await usdtBal(fresh)) === expected, `recipient received exactly ${fmt(expected)}`)
  await zk.waitForCommitment(ctx, 'notes', w.changeCommitment)
  r = await freshScan(privKey)
  assert(r.scan.balance === 0n, 'shielded balance is 0 after withdrawing everything')

  log('E2E-GARBLED PASSED')
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err)
    process.exit(1)
  },
)
