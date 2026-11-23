// Human-readable subsets of contracts/abi/*.json (names/types match the compiled ABIs exactly).
import { parseAbi } from 'viem'

export const poolAbi = parseAbi([
  'struct Proof { uint256[2] a; uint256[2][2] b; uint256[2] c; }',
  'struct TransactArgs { uint256 root; uint256 publicAmount; uint256 extDataHash; uint256[2] inputNullifiers; uint256[2] outputCommitments; }',
  'struct ExtData { address recipient; int256 extAmount; address relayer; uint256 fee; bytes encryptedOutput0; bytes encryptedOutput1; }',
  'struct OpenArgs { uint256 root; uint256 inNullifier; uint256 changeCommitment; uint256 positionCommitment; uint256 marketId; uint256 margin; uint256 epoch; }',
  'struct CloseArgs { uint256 positionRoot; uint256 positionNullifier; uint256 outCommitment; uint256 marketId; uint256 margin; uint256 entryEpoch; uint256 closeOffset; uint256 payout; }',
  'function transact(Proof proof, TransactArgs args, ExtData ext)',
  'function openPosition(Proof proof, OpenArgs args, bytes encryptedChange, bytes encryptedPosition)',
  'function closePosition(Proof proof, CloseArgs args, bytes encryptedOutput)',
  'function noteRoot() view returns (uint256)',
  'function positionRoot() view returns (uint256)',
  'function isKnownNoteRoot(uint256 root) view returns (bool)',
  'function isKnownPositionRoot(uint256 root) view returns (bool)',
  'function nextNoteIndex() view returns (uint256)',
  'function nextPositionIndex() view returns (uint256)',
  'function nullifierSpent(uint256) view returns (bool)',
  'function positionNullifierSpent(uint256) view returns (bool)',
  'function latestCloseOffset(uint256 entryEpoch) view returns (uint256)',
  'function minMargin() view returns (uint256)',
  'function maxDepositPerTx() view returns (uint256)',
  'function paused() view returns (bool)',
  'event NewNote(uint256 commitment, uint256 index, bytes encryptedOutput)',
  'event NewPosition(uint256 commitment, uint256 index, bytes encryptedOutput)',
  'event NullifierSpent(uint256 nullifier)',
  'event PositionOpened(uint256 indexed marketId, uint256 indexed epoch, uint256 margin, uint256 positionIndex)',
  'event PositionClosed(uint256 indexed marketId, uint256 indexed entryEpoch, uint256 margin, uint256 closeOffset, uint256 payout)',
])

export const oracleAbi = parseAbi([
  'function currentEpoch() view returns (uint256)',
  'function epochLength() view returns (uint256)',
  'function getEpoch(uint256 marketId, uint256 epoch) view returns (uint256 close, uint256 low, uint256 high, bool finalized)',
  'function getWindow(uint256 marketId, uint256 entryEpoch) view returns (uint256[16] closes, uint256[16] lows, uint256[16] highs)',
  'function latest(uint256 marketId) view returns (uint256 value, uint256 epoch)',
  'function marketExists(uint256 marketId) view returns (bool)',
])

export const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'function mint(address to, uint256 amount)',
])
