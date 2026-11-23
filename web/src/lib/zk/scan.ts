// Shielded-account scanning: fetch every leaf, try-decrypt, confirm ownership by recomputing the
// commitment, compute nullifiers, check spent status on-chain, and rebuild both Merkle trees.
import { decodeEventLog, getAbiItem, type Address, type Hex, type PublicClient } from 'viem'
import { poolAbi } from './abi.ts'
import { decryptNote, decryptPosition, type NotePayload, type PositionPayload } from './encryption.ts'
import { toHex32 } from './field.ts'
import type { Keypair } from './keys.ts'
import { closeBlinding, openBlindings } from './derive.ts'
import { MerkleTree } from './merkle.ts'
import { noteCommitment, noteNullifier, positionCommitment, positionNullifier } from './note.ts'
import type { ArtifactResolver } from './prover.ts'

export type ZkContext = {
  publicClient: PublicClient
  /** Backend base URL (indexer + relayer). Optional: scanning falls back to getLogs. */
  apiUrl?: string
  pool: Address
  oracle: Address
  /** Pool deployment block for the getLogs fallback. */
  fromBlock?: bigint
  artifacts: ArtifactResolver
}

export type LeafKind = 'notes' | 'positions'
export type Leaf = { index: number; commitment: bigint; encryptedOutput: Hex }

export type OwnedNote = NotePayload & { index: number; commitment: bigint; nullifier: bigint }
export type OwnedPosition = PositionPayload & { index: number; commitment: bigint; nullifier: bigint }

export type ScanResult = {
  noteTree: MerkleTree
  positionTree: MerkleTree
  /** Unspent owned notes with amount > 0. */
  notes: OwnedNote[]
  /** Unspent owned positions. */
  positions: OwnedPosition[]
  balance: bigint
  noteRootKnown: boolean
  positionRootKnown: boolean
}

const PAGE = 5000

async function fetchLeavesApi(apiUrl: string, kind: LeafKind): Promise<Leaf[]> {
  const out: Leaf[] = []
  for (let from = 0; ; ) {
    const res = await fetch(`${apiUrl.replace(/\/$/, '')}/pool/${kind}?from=${from}&limit=${PAGE}`)
    if (!res.ok) throw new Error(`/pool/${kind}: HTTP ${res.status}`)
    const page = (await res.json()) as Array<{ index: number; commitment: string; encryptedOutput: string }>
    for (const l of page) out.push({ index: Number(l.index), commitment: BigInt(l.commitment), encryptedOutput: (l.encryptedOutput || '0x') as Hex })
    if (page.length < PAGE) break
    from = out[out.length - 1].index + 1
  }
  return out
}

const eventFor = (kind: LeafKind) => getAbiItem({ abi: poolAbi, name: kind === 'notes' ? 'NewNote' : 'NewPosition' })

async function fetchLeavesLogs(ctx: ZkContext, kind: LeafKind, fromBlock: bigint): Promise<Leaf[]> {
  const head = await ctx.publicClient.getBlockNumber()
  const event = eventFor(kind)
  const out: Leaf[] = []
  let chunk = 50_000n
  for (let from = fromBlock; from <= head; ) {
    const to = from + chunk - 1n > head ? head : from + chunk - 1n
    let logs
    try {
      logs = await ctx.publicClient.getLogs({ address: ctx.pool, event, fromBlock: from, toBlock: to })
    } catch (err) {
      if (chunk > 500n) { chunk /= 2n; continue }
      throw err
    }
    for (const log of logs) {
      const a = log.args as { commitment?: bigint; index?: bigint; encryptedOutput?: Hex }
      if (a.commitment === undefined || a.index === undefined) continue
      out.push({ index: Number(a.index), commitment: a.commitment, encryptedOutput: a.encryptedOutput ?? '0x' })
    }
    from = to + 1n
  }
  return out
}

function normalize(leaves: Leaf[]): Leaf[] {
  const byIndex = new Map<number, Leaf>()
  for (const l of leaves) byIndex.set(l.index, l)
  return [...byIndex.values()].sort((a, b) => a.index - b.index)
}

const contiguous = (leaves: Leaf[]) => leaves.every((l, i) => l.index === i)

/**
 * All leaves of one tree in index order. Uses the backend index, tops up a lagging index with a
 * recent-block getLogs, and falls back to a full getLogs scan if the result is not contiguous.
 */
export async function fetchLeaves(ctx: ZkContext, kind: LeafKind): Promise<Leaf[]> {
  const onchainCount = Number(
    await ctx.publicClient.readContract({ address: ctx.pool, abi: poolAbi, functionName: kind === 'notes' ? 'nextNoteIndex' : 'nextPositionIndex' }),
  )
  let leaves: Leaf[] = []
  if (ctx.apiUrl) {
    try { leaves = normalize(await fetchLeavesApi(ctx.apiUrl, kind)) } catch { leaves = [] }
  }
  if (leaves.length < onchainCount && contiguous(leaves) && leaves.length > 0) {
    // backend lags a few blocks: fill the tail from recent logs
    const head = await ctx.publicClient.getBlockNumber()
    const from = head > 5000n ? head - 5000n : 0n
    leaves = normalize([...leaves, ...(await fetchLeavesLogs(ctx, kind, from))])
  }
  if (!contiguous(leaves) || leaves.length < onchainCount) {
    leaves = normalize(await fetchLeavesLogs(ctx, kind, ctx.fromBlock ?? 0n))
  }
  return leaves.filter((l) => l.index < Math.max(onchainCount, leaves.length))
}

type NoteKey = bigint // commitment

/**
 * Scans the pool for notes/positions owned by `keypair`.
 * 1. Fast path: try-decrypt every leaf's ciphertext, confirm by recomputing the commitment.
 * 2. Recovery path: open/close outputs use blindings derived from (privKey, spent nullifier), so when a
 *    spent owned note/position's outputs were not found by decryption (garbled or dropped ciphertexts),
 *    the spending tx is located via NullifierSpent logs and the outputs are rebuilt from its public events
 *    (PositionOpened / PositionClosed + NewNote / NewPosition) and verified by commitment equality.
 *    Recovery is inductive: recovered items are themselves checked for spends and recovered again.
 */
export class ShieldedScanner {
  ctx: ZkContext
  keypair: Keypair
  private noteCache = new Map<bigint, NotePayload | null>()
  private posCache = new Map<bigint, PositionPayload | null>()
  private spent = new Set<bigint>()
  /** nullifiers whose spend has been examined (covered by decryption, recovered, or not recoverable) */
  private processed = new Set<bigint>()
  /** outputs rebuilt by the recovery path, keyed by commitment */
  private recoveredNotes = new Map<NoteKey, OwnedNote>()
  private recoveredPositions = new Map<NoteKey, OwnedPosition>()
  /** NullifierSpent index: nullifier -> tx hash (incremental, chunked getLogs) */
  private spendTx = new Map<bigint, Hex>()
  private spendLogsNext: bigint | undefined
  /** number of items rebuilt by the recovery path in the last scan (diagnostics) */
  lastRecovered = 0

  constructor(ctx: ZkContext, keypair: Keypair) {
    this.ctx = ctx
    this.keypair = keypair
  }

  private async syncSpendLogs(): Promise<void> {
    const { ctx } = this
    const head = await ctx.publicClient.getBlockNumber()
    let from = this.spendLogsNext ?? ctx.fromBlock ?? 0n
    const event = getAbiItem({ abi: poolAbi, name: 'NullifierSpent' })
    let chunk = 50_000n
    while (from <= head) {
      const to = from + chunk - 1n > head ? head : from + chunk - 1n
      let logs
      try {
        logs = await ctx.publicClient.getLogs({ address: ctx.pool, event, fromBlock: from, toBlock: to })
      } catch (err) {
        if (chunk > 500n) { chunk /= 2n; continue }
        throw err
      }
      for (const l of logs) {
        const n = (l.args as { nullifier?: bigint }).nullifier
        if (n !== undefined && l.transactionHash) this.spendTx.set(n, l.transactionHash)
      }
      from = to + 1n
    }
    this.spendLogsNext = head + 1n
  }

  private async findSpendTx(nullifier: bigint): Promise<Hex | undefined> {
    if (!this.spendTx.has(nullifier)) await this.syncSpendLogs()
    return this.spendTx.get(nullifier)
  }

  /** Pool events of the spending tx that follow the NullifierSpent(nullifier) log. */
  private async spendEvents(nullifier: bigint) {
    const hash = await this.findSpendTx(nullifier)
    if (!hash) return null
    const receipt = await this.ctx.publicClient.getTransactionReceipt({ hash })
    const pool = this.ctx.pool.toLowerCase()
    const events: Array<{ eventName: string; args: Record<string, unknown> }> = []
    let started = false
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== pool) continue
      let ev
      try { ev = decodeEventLog({ abi: poolAbi, data: log.data, topics: log.topics }) } catch { continue }
      const args = ev.args as unknown as Record<string, unknown>
      if (!started) {
        if (ev.eventName === 'NullifierSpent' && args.nullifier === nullifier) started = true
        continue
      }
      events.push({ eventName: ev.eventName, args })
    }
    return events
  }

  /** Rebuild the change note + position of an open that spent `note`. */
  private async recoverOpen(note: OwnedNote, tree: MerkleTree, posTree: MerkleTree) {
    const evs = await this.spendEvents(note.nullifier)
    if (!evs) return
    const opened = evs.find((e) => e.eventName === 'PositionOpened')
    if (!opened) return // not an open (transact outputs are bound by extDataHash and decrypt normally)
    const newNote = evs.find((e) => e.eventName === 'NewNote')
    const newPos = evs.find((e) => e.eventName === 'NewPosition')
    if (!newNote || !newPos) return
    const { privKey, pubKey } = this.keypair
    const b = openBlindings(privKey, note.nullifier)
    const margin = opened.args.margin as bigint
    const marketId = opened.args.marketId as bigint
    const entryEpoch = opened.args.epoch as bigint

    const cc = newNote.args.commitment as bigint
    const ci = Number(newNote.args.index as bigint)
    if (note.amount >= margin && tree.layers[0][ci] === cc) {
      const change = { amount: note.amount - margin, blinding: b.change }
      if (noteCommitment({ ...change, pubKey }) === cc) {
        this.recoveredNotes.set(cc, { ...change, index: ci, commitment: cc, nullifier: noteNullifier(cc, privKey) })
      }
    }
    const pc = newPos.args.commitment as bigint
    const pi = Number(newPos.args.index as bigint)
    if (posTree.layers[0][pi] === pc) {
      for (const isLong of [true, false]) {
        for (let L = 1n; L <= 20n; L++) {
          const p = { marketId, isLong, margin, leverage: L, entryEpoch, blinding: b.position }
          if (positionCommitment({ ...p, pubKey }) === pc) {
            this.recoveredPositions.set(pc, { ...p, index: pi, commitment: pc, nullifier: positionNullifier(pc, privKey) })
            return
          }
        }
      }
    }
  }

  /** Rebuild the payout note of a close that spent `pos`. */
  private async recoverClose(pos: OwnedPosition, tree: MerkleTree) {
    const evs = await this.spendEvents(pos.nullifier)
    if (!evs) return
    const closed = evs.find((e) => e.eventName === 'PositionClosed')
    const newNote = evs.find((e) => e.eventName === 'NewNote')
    if (!closed || !newNote) return
    const { privKey, pubKey } = this.keypair
    const cc = newNote.args.commitment as bigint
    const ci = Number(newNote.args.index as bigint)
    const out = { amount: closed.args.payout as bigint, blinding: closeBlinding(privKey, pos.nullifier) }
    if (tree.layers[0][ci] === cc && noteCommitment({ ...out, pubKey }) === cc) {
      this.recoveredNotes.set(cc, { ...out, index: ci, commitment: cc, nullifier: noteNullifier(cc, privKey) })
    }
  }

  private async isSpent(fn: 'nullifierSpent' | 'positionNullifierSpent', n: bigint): Promise<boolean> {
    if (this.spent.has(n)) return true
    const s = await this.ctx.publicClient.readContract({ address: this.ctx.pool, abi: poolAbi, functionName: fn, args: [n] })
    if (s) this.spent.add(n)
    return s
  }

  async scan(): Promise<ScanResult> {
    const { ctx, keypair } = this
    const [noteLeaves, posLeaves] = await Promise.all([fetchLeaves(ctx, 'notes'), fetchLeaves(ctx, 'positions')])
    const noteTree = new MerkleTree(20, noteLeaves.map((l) => l.commitment))
    const positionTree = new MerkleTree(20, posLeaves.map((l) => l.commitment))

    // ---- fast path: decrypt (zero-amount notes are kept here: they prove an output was found)
    const notes = new Map<NoteKey, OwnedNote>()
    for (const leaf of noteLeaves) {
      let p = this.noteCache.get(leaf.commitment)
      if (p === undefined) {
        p = await decryptNote(keypair.privKey, leaf.encryptedOutput)
        if (p && noteCommitment({ amount: p.amount, pubKey: keypair.pubKey, blinding: p.blinding }) !== leaf.commitment) p = null
        this.noteCache.set(leaf.commitment, p)
      }
      if (!p) continue
      notes.set(leaf.commitment, { ...p, index: leaf.index, commitment: leaf.commitment, nullifier: noteNullifier(leaf.commitment, keypair.privKey) })
    }
    const positions = new Map<NoteKey, OwnedPosition>()
    for (const leaf of posLeaves) {
      let p = this.posCache.get(leaf.commitment)
      if (p === undefined) {
        p = await decryptPosition(keypair.privKey, leaf.encryptedOutput)
        if (p && positionCommitment({ ...p, pubKey: keypair.pubKey }) !== leaf.commitment) p = null
        this.posCache.set(leaf.commitment, p)
      }
      if (!p) continue
      positions.set(leaf.commitment, { ...p, index: leaf.index, commitment: leaf.commitment, nullifier: positionNullifier(leaf.commitment, keypair.privKey) })
    }
    // previously recovered items (still verified against the current tree)
    for (const [c, n] of this.recoveredNotes) if (!notes.has(c) && noteTree.layers[0][n.index] === c) notes.set(c, n)
    for (const [c, p] of this.recoveredPositions) if (!positions.has(c) && positionTree.layers[0][p.index] === c) positions.set(c, p)

    // ---- recovery path (inductive worklist)
    const before = this.recoveredNotes.size + this.recoveredPositions.size
    for (let round = 0; round < 64; round++) {
      const blindings = new Set<bigint>()
      for (const n of notes.values()) blindings.add(n.blinding)
      const posBlindings = new Set<bigint>()
      for (const p of positions.values()) posBlindings.add(p.blinding)

      const todoNotes: OwnedNote[] = []
      const todoPos: OwnedPosition[] = []
      const nList = [...notes.values()].filter((n) => !this.processed.has(n.nullifier))
      const pList = [...positions.values()].filter((p) => !this.processed.has(p.nullifier))
      const [nSpent, pSpent] = await Promise.all([
        Promise.all(nList.map((n) => this.isSpent('nullifierSpent', n.nullifier))),
        Promise.all(pList.map((p) => this.isSpent('positionNullifierSpent', p.nullifier))),
      ])
      nList.forEach((n, i) => {
        if (!nSpent[i]) return
        const b = openBlindings(keypair.privKey, n.nullifier)
        // an open that spent n is fully covered if both derived outputs were decrypted
        if (blindings.has(b.change) && posBlindings.has(b.position)) this.processed.add(n.nullifier)
        else todoNotes.push(n)
      })
      pList.forEach((p, i) => {
        if (!pSpent[i]) return
        if (blindings.has(closeBlinding(keypair.privKey, p.nullifier))) this.processed.add(p.nullifier)
        else todoPos.push(p)
      })
      if (!todoNotes.length && !todoPos.length) break

      for (const n of todoNotes) {
        try {
          await this.recoverOpen(n, noteTree, positionTree)
          this.processed.add(n.nullifier)
        } catch { /* transient RPC error: retry on next scan */ }
      }
      for (const p of todoPos) {
        try {
          await this.recoverClose(p, noteTree)
          this.processed.add(p.nullifier)
        } catch { /* retry on next scan */ }
      }
      let added = false
      for (const [c, n] of this.recoveredNotes) if (!notes.has(c)) { notes.set(c, n); added = true }
      for (const [c, p] of this.recoveredPositions) if (!positions.has(c)) { positions.set(c, p); added = true }
      if (!added) break
    }
    this.lastRecovered = this.recoveredNotes.size + this.recoveredPositions.size - before

    const noteArr = [...notes.values()].filter((n) => n.amount > 0n).sort((a, b) => a.index - b.index)
    const posArr = [...positions.values()].sort((a, b) => a.index - b.index)
    const [noteSpent, posSpent, noteRootKnown, positionRootKnown] = await Promise.all([
      Promise.all(noteArr.map((n) => this.isSpent('nullifierSpent', n.nullifier))),
      Promise.all(posArr.map((p) => this.isSpent('positionNullifierSpent', p.nullifier))),
      ctx.publicClient.readContract({ address: ctx.pool, abi: poolAbi, functionName: 'isKnownNoteRoot', args: [noteTree.root()] }),
      ctx.publicClient.readContract({ address: ctx.pool, abi: poolAbi, functionName: 'isKnownPositionRoot', args: [positionTree.root()] }),
    ])
    const unspentNotes = noteArr.filter((_, i) => !noteSpent[i])
    const unspentPositions = posArr.filter((_, i) => !posSpent[i])
    return {
      noteTree,
      positionTree,
      notes: unspentNotes,
      positions: unspentPositions,
      balance: unspentNotes.reduce((a, n) => a + n.amount, 0n),
      noteRootKnown,
      positionRootKnown,
    }
  }
}

/** Poll the leaf index until `commitment` appears (after a tx is mined). */
export async function waitForCommitment(ctx: ZkContext, kind: LeafKind, commitment: bigint, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const leaves = await fetchLeaves(ctx, kind)
    if (leaves.some((l) => l.commitment === commitment)) return
    if (Date.now() > deadline) throw new Error(`commitment ${toHex32(commitment)} not indexed after ${timeoutMs / 1000}s`)
    await new Promise((r) => setTimeout(r, 1500))
  }
}
