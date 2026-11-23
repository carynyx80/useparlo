// Shielded-account scanning: fetch every leaf, try-decrypt, confirm ownership by recomputing the
// commitment, compute nullifiers, check spent status on-chain, and rebuild both Merkle trees.
import { getAbiItem, type Address, type Hex, type PublicClient } from 'viem'
import { poolAbi } from './abi.ts'
import { decryptNote, decryptPosition, type NotePayload, type PositionPayload } from './encryption.ts'
import { toHex32 } from './field.ts'
import type { Keypair } from './keys.ts'
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

export class ShieldedScanner {
  ctx: ZkContext
  keypair: Keypair
  private noteCache = new Map<bigint, NotePayload | null>()
  private posCache = new Map<bigint, PositionPayload | null>()
  private spent = new Set<bigint>()

  constructor(ctx: ZkContext, keypair: Keypair) {
    this.ctx = ctx
    this.keypair = keypair
  }

  async scan(): Promise<ScanResult> {
    const { ctx, keypair } = this
    const [noteLeaves, posLeaves] = await Promise.all([fetchLeaves(ctx, 'notes'), fetchLeaves(ctx, 'positions')])
    const noteTree = new MerkleTree(20, noteLeaves.map((l) => l.commitment))
    const positionTree = new MerkleTree(20, posLeaves.map((l) => l.commitment))

    const notes: OwnedNote[] = []
    for (const leaf of noteLeaves) {
      let p = this.noteCache.get(leaf.commitment)
      if (p === undefined) {
        p = await decryptNote(keypair.privKey, leaf.encryptedOutput)
        if (p && noteCommitment({ amount: p.amount, pubKey: keypair.pubKey, blinding: p.blinding }) !== leaf.commitment) p = null
        this.noteCache.set(leaf.commitment, p)
      }
      if (!p || p.amount === 0n) continue
      notes.push({ ...p, index: leaf.index, commitment: leaf.commitment, nullifier: noteNullifier(leaf.commitment, keypair.privKey) })
    }
    const positions: OwnedPosition[] = []
    for (const leaf of posLeaves) {
      let p = this.posCache.get(leaf.commitment)
      if (p === undefined) {
        p = await decryptPosition(keypair.privKey, leaf.encryptedOutput)
        if (p && positionCommitment({ ...p, pubKey: keypair.pubKey }) !== leaf.commitment) p = null
        this.posCache.set(leaf.commitment, p)
      }
      if (!p) continue
      positions.push({ ...p, index: leaf.index, commitment: leaf.commitment, nullifier: positionNullifier(leaf.commitment, keypair.privKey) })
    }

    const isSpent = async (fn: 'nullifierSpent' | 'positionNullifierSpent', n: bigint) => {
      if (this.spent.has(n)) return true
      const s = await ctx.publicClient.readContract({ address: ctx.pool, abi: poolAbi, functionName: fn, args: [n] })
      if (s) this.spent.add(n)
      return s
    }
    const [noteSpent, posSpent, noteRootKnown, positionRootKnown] = await Promise.all([
      Promise.all(notes.map((n) => isSpent('nullifierSpent', n.nullifier))),
      Promise.all(positions.map((p) => isSpent('positionNullifierSpent', p.nullifier))),
      ctx.publicClient.readContract({ address: ctx.pool, abi: poolAbi, functionName: 'isKnownNoteRoot', args: [noteTree.root()] }),
      ctx.publicClient.readContract({ address: ctx.pool, abi: poolAbi, functionName: 'isKnownPositionRoot', args: [positionTree.root()] }),
    ])
    const unspentNotes = notes.filter((_, i) => !noteSpent[i])
    const unspentPositions = positions.filter((_, i) => !posSpent[i])
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
