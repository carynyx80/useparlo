// Port of circuits/js/merkle.mjs (+ a level-wise bulk builder that yields the identical tree).
import { poseidon, toField } from './field.ts'

export const TREE_LEVELS = 20

const zeroCache = new Map<number, bigint[]>()
/** zeros[0] = 0, zeros[i+1] = H(zeros[i], zeros[i]) -- matches MerkleTreeWithHistory. */
export function zeros(levels = TREE_LEVELS): bigint[] {
  const cached = zeroCache.get(levels)
  if (cached) return cached
  const z = [0n]
  for (let i = 0; i < levels; i++) z.push(poseidon([z[i], z[i]]))
  zeroCache.set(levels, z)
  return z
}

export type MerklePath = { pathElements: bigint[]; pathIndices: bigint[]; root?: bigint }

/** Append-only incremental Poseidon Merkle tree, identical to the on-chain tree. */
export class MerkleTree {
  levels: number
  capacity: number
  zeros: bigint[]
  layers: bigint[][]

  constructor(levels = TREE_LEVELS, leaves: Array<bigint | string> = []) {
    this.levels = levels
    this.capacity = 2 ** levels
    this.zeros = zeros(levels)
    this.layers = [[]]
    for (let i = 1; i <= levels; i++) this.layers.push([])
    if (leaves.length) this.build(leaves.map((l) => toField(l)))
  }

  /** Level-wise build: hashes only populated nodes (~2n hashes instead of 20n). */
  private build(leaves: bigint[]) {
    if (leaves.length > this.capacity) throw new Error('tree is full')
    this.layers[0] = leaves
    for (let level = 0; level < this.levels; level++) {
      const cur = this.layers[level]
      const next: bigint[] = []
      for (let i = 0; i < cur.length; i += 2) {
        const right = i + 1 < cur.length ? cur[i + 1] : this.zeros[level]
        next.push(poseidon([cur[i], right]))
      }
      this.layers[level + 1] = next
    }
  }

  get length(): number {
    return this.layers[0].length
  }

  insert(leaf: bigint | string): number {
    if (this.length >= this.capacity) throw new Error('tree is full')
    let index = this.length
    let node = toField(leaf)
    this.layers[0].push(node)
    for (let level = 0; level < this.levels; level++) {
      const isRight = index & 1
      const sibling = isRight ? this.layers[level][index - 1] : this.layers[level][index + 1] ?? this.zeros[level]
      node = isRight ? poseidon([sibling, node]) : poseidon([node, sibling])
      index >>= 1
      this.layers[level + 1][index] = node
    }
    return this.length - 1
  }

  root(): bigint {
    return this.layers[this.levels][0] ?? this.zeros[this.levels]
  }

  indexOf(leaf: bigint): number {
    const v = toField(leaf)
    return this.layers[0].findIndex((x) => x === v)
  }

  /** Authentication path for leaf `index`. pathIndices are the little-endian bits of index. */
  path(index: number): MerklePath {
    if (index < 0 || index >= this.length) throw new Error(`index ${index} not in tree`)
    const pathElements: bigint[] = []
    const pathIndices: bigint[] = []
    let idx = index
    for (let level = 0; level < this.levels; level++) {
      const isRight = idx & 1
      const siblingIdx = isRight ? idx - 1 : idx + 1
      pathElements.push(this.layers[level][siblingIdx] ?? this.zeros[level])
      pathIndices.push(BigInt(isRight))
      idx >>= 1
    }
    return { pathElements, pathIndices, root: this.root() }
  }

  /** Dummy path (all zeros) used for zero-amount inputs. */
  emptyPath(): MerklePath {
    return {
      pathElements: new Array(this.levels).fill(0n),
      pathIndices: new Array(this.levels).fill(0n),
    }
  }
}
