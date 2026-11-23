import { poseidon, toField } from "./field.mjs";

export const TREE_LEVELS = 20;

const zeroCache = new Map();
/** zeros[0] = 0, zeros[i+1] = H(zeros[i], zeros[i]) -- matches MerkleTreeWithHistory. */
export function zeros(levels = TREE_LEVELS) {
  if (zeroCache.has(levels)) return zeroCache.get(levels);
  const z = [0n];
  for (let i = 0; i < levels; i++) z.push(poseidon([z[i], z[i]]));
  zeroCache.set(levels, z);
  return z;
}

/**
 * Append-only incremental Poseidon Merkle tree (depth 20 by default), identical to the
 * on-chain tree: leaves inserted left to right, empty subtrees use zeros[level].
 */
export class MerkleTree {
  constructor(levels = TREE_LEVELS, leaves = []) {
    this.levels = levels;
    this.capacity = 2 ** levels;
    this.zeros = zeros(levels);
    this.layers = [[]];
    for (let i = 1; i <= levels; i++) this.layers.push([]);
    for (const l of leaves) this.insert(l);
  }

  get length() {
    return this.layers[0].length;
  }

  insert(leaf) {
    if (this.length >= this.capacity) throw new Error("tree is full");
    let index = this.length;
    let node = toField(leaf);
    this.layers[0].push(node);
    for (let level = 0; level < this.levels; level++) {
      const isRight = index & 1;
      const sibling = isRight
        ? this.layers[level][index - 1]
        : this.layers[level][index + 1] ?? this.zeros[level];
      node = isRight ? poseidon([sibling, node]) : poseidon([node, sibling]);
      index >>= 1;
      this.layers[level + 1][index] = node;
    }
    return this.length - 1;
  }

  bulkInsert(leaves) {
    for (const l of leaves) this.insert(l);
  }

  root() {
    return this.layers[this.levels][0] ?? this.zeros[this.levels];
  }

  indexOf(leaf) {
    const v = toField(leaf);
    return this.layers[0].findIndex((x) => x === v);
  }

  /** Authentication path for leaf `index`. pathIndices are the little-endian bits of index. */
  path(index) {
    if (index < 0 || index >= this.length) throw new Error(`index ${index} not in tree`);
    const pathElements = [];
    const pathIndices = [];
    let idx = index;
    for (let level = 0; level < this.levels; level++) {
      const isRight = idx & 1;
      const siblingIdx = isRight ? idx - 1 : idx + 1;
      pathElements.push(this.layers[level][siblingIdx] ?? this.zeros[level]);
      pathIndices.push(BigInt(isRight));
      idx >>= 1;
    }
    return { pathElements, pathIndices, root: this.root() };
  }

  /** Dummy path (all zeros) used for zero-amount inputs. */
  emptyPath() {
    return {
      pathElements: new Array(this.levels).fill(0n),
      pathIndices: new Array(this.levels).fill(0n),
    };
  }
}
