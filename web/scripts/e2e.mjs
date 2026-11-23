#!/usr/bin/env node
// End-to-end private trading against a local stack (anvil + backend relayer), using the exact
// zk library the web app uses (web/src/lib/zk, loaded via Node's built-in TypeScript type stripping).
//
//   node scripts/e2e.mjs
//
// Env (defaults match the local test stack): RPC_URL, API_URL, POOL, ORACLE, USDT, E2E_PRIVATE_KEY, MARKET_ID
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
// anvil default account #4 (public test key) -- Node scripts only
const PK = env.E2E_PRIVATE_KEY ?? '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a'
const MARKET_ID = BigInt(env.MARKET_ID ?? 1)

const zkDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'zk')
const fmt = (v) => `${formatUnits(v, 18)} USDT`
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`)
}

const account = privateKeyToAccount(PK)
const publicClient = createPublicClient({ chain: foundry, transport: http(RPC_URL) })
const wallet = createWalletClient({ account, chain: foundry, transport: http(RPC_URL) })

const ctx = {
  publicClient,
  apiUrl: API_URL,
  pool: POOL,
  oracle: ORACLE,
  artifacts: (c) => ({ wasm: path.join(zkDir, `${c}.wasm`), zkey: path.join(zkDir, `${c}.zkey`) }),
}
const step = (m) => log(`   · ${m}`)
const usdtBal = (a) => publicClient.readContract({ address: USDT, abi: zk.erc20Abi, functionName: 'balanceOf', args: [a] })

async function send(request) {
  const hash = await wallet.writeContract(request)
  await zk.waitForSuccess(ctx, hash)
  return hash
}

async function main() {
  log(`wallet ${account.address}`)
  const health = await (await fetch(`${API_URL}/health`)).json()
  assert(health.relayer?.configured, 'relayer configured')
  log(`backend ok: relayer ${health.relayer.address}, pool indexer block ${health.pool.lastSyncedBlock}`)

  // 1. shielded account from a wallet signature (exactly as the web app does)
  const sig = await account.signMessage({ message: zk.SHIELDED_ACCOUNT_MESSAGE })
  const kp = await zk.keypairFromSignature(sig)
  const empty = new zk.MerkleTree(20).root()
  assert(empty === 15019797232609675441998260052101280400536945603062888308240081994073687793470n, 'empty tree root matches circuits/README')
  log(`shielded pubKey ${zk.toHex32(kp.pubKey).slice(0, 18)}…`)
  const scanner = new zk.ShieldedScanner(ctx, kp)
  let scan = await scanner.scan()
  const startBal = scan.balance
  log(`initial shielded balance ${fmt(startBal)} (${scan.notes.length} notes, ${scan.positions.length} open positions)`)

  // 2. mint 1000 test USDT
  const mintHash = await send({ address: USDT, abi: zk.erc20Abi, functionName: 'mint', args: [account.address, parseUnits('1000', 18)] })
  log(`mint 1000 USDT       tx ${mintHash}  wallet ${fmt(await usdtBal(account.address))}`)

  // 3. deposit 500 (approve exact amount, user wallet calls pool.transact directly)
  const dep = parseUnits('500', 18)
  const approveHash = await send({ address: USDT, abi: zk.erc20Abi, functionName: 'approve', args: [POOL, dep] })
  log(`approve 500          tx ${approveHash}`)
  const { request, commitment: depCommitment } = await zk.prepareDeposit(ctx, kp, scan, dep, step)
  const depHash = await send({ ...request, account })
  log(`deposit 500          tx ${depHash}`)
  await zk.waitForCommitment(ctx, 'notes', depCommitment)
  scan = await scanner.scan()
  log(`shielded balance     ${fmt(scan.balance)}  (root known: ${scan.noteRootKnown})`)
  assert(scan.balance - startBal === dep, `balance increased by 500 (got ${fmt(scan.balance - startBal)})`)
  assert(scan.noteRootKnown, 'rebuilt note root is known on-chain')

  // 4. open long 5x, margin 100 on market 1 (via relayer)
  const margin = parseUnits('100', 18)
  let opened
  for (let attempt = 1; ; attempt++) {
    try {
      opened = await zk.openPosition(ctx, kp, scan, { marketId: MARKET_ID, isLong: true, margin, leverage: 5 }, step)
      break
    } catch (err) {
      // the local reporter occasionally skips an epoch (20% move cap); the pool then rejects opens as StaleOracle
      if (attempt >= 4 || !/stale/i.test(String(err?.message))) throw err
      log(`   · ${err.message} (retry ${attempt})`)
      await sleep(10_000)
    }
  }
  log(`open long 5x m=100   tx ${opened.txHash}  entryEpoch ${opened.epoch}`)
  await zk.waitForCommitment(ctx, 'positions', opened.positionCommitment)
  await zk.waitForCommitment(ctx, 'notes', opened.changeCommitment)
  scan = await scanner.scan()
  const pos = scan.positions.find((p) => p.commitment === opened.positionCommitment)
  assert(pos, 'scan finds the new position')
  assert(pos.isLong && pos.leverage === 5n && pos.margin === margin, 'decrypted position fields')
  assert(scan.balance - startBal === dep - margin, `balance is 400 after open (got ${fmt(scan.balance - startBal)})`)
  log(`shielded balance     ${fmt(scan.balance)}; positions ${scan.positions.length} (root known: ${scan.positionRootKnown})`)

  // 5. wait for entry finalization + a couple more epochs (reporter keeps pushing in real time)
  let st
  for (;;) {
    st = await zk.positionStatus(ctx, pos)
    if (st.closeOffset >= 2) break
    log(`   · waiting: epoch ${st.currentEpoch}, entry ${st.entry ?? 'pending'}, closeOffset ${st.closeOffset}${st.live ? `, live payout ≈ ${fmt(st.live.payout)}` : ''}`)
    await sleep(5000)
  }
  log(`entry ${st.entry} (=${Number(st.entry) / 1e4}), mark ${st.mark}, closeOffset ${st.closeOffset}, settle-now payout ${st.settle ? fmt(st.settle.payout) : 'n/a'}${st.settle?.knockedOut ? ' (knocked out)' : ''}`)

  // 6. close (payout computed exactly as circuits/js/payout.mjs, all 56 public signals)
  const closed = await zk.closePosition(ctx, kp, scan, pos, step)
  log(`close                tx ${closed.txHash}  closeOffset ${closed.closeOffset} payout ${fmt(closed.payout)}${closed.knockedOut ? ' (knocked out)' : ''}`)
  await zk.waitForCommitment(ctx, 'notes', closed.outCommitment)
  scan = await scanner.scan()
  log(`shielded balance     ${fmt(scan.balance)}  (expected ${fmt(startBal + dep - margin + closed.payout)})`)
  assert(scan.balance === startBal + dep - margin + closed.payout, 'balance = 400 + payout')
  assert(!scan.positions.some((p) => p.commitment === pos.commitment), 'closed position no longer listed')

  // 7. withdraw 50 to a fresh address via relayer
  const fresh = privateKeyToAccount(generatePrivateKey()).address
  const amt = parseUnits('50', 18)
  const before = scan.balance
  const w = await zk.withdraw(ctx, kp, scan, amt, fresh, step)
  log(`withdraw 50 → ${fresh}  tx ${w.txHash}`)
  const recv = await usdtBal(fresh)
  log(`recipient USDT balance ${fmt(recv)}`)
  assert(recv === amt, 'recipient received exactly 50 USDT')
  await zk.waitForCommitment(ctx, 'notes', w.changeCommitment)
  scan = await scanner.scan()
  log(`shielded balance     ${fmt(scan.balance)}`)
  assert(scan.balance === before - amt, 'shielded balance decreased by 50')

  log('E2E PASSED')
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err)
    process.exit(1)
  },
)
