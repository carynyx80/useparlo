// Port of circuits/js/extdata.mjs#extDataHash using viem (no ethers in the browser).
// extDataHash = uint256(keccak256(abi.encode(recipient, extAmount(int256), relayer, fee, encOut0, encOut1))) % p
import { encodeAbiParameters, keccak256, type Address, type Hex } from 'viem'
import { FIELD_SIZE } from './field.ts'

export type ExtData = {
  recipient: Address
  extAmount: bigint
  relayer: Address
  fee: bigint
  encryptedOutput0: Hex
  encryptedOutput1: Hex
}

export function extDataHash(e: ExtData): bigint {
  const encoded = encodeAbiParameters(
    [{ type: 'address' }, { type: 'int256' }, { type: 'address' }, { type: 'uint256' }, { type: 'bytes' }, { type: 'bytes' }],
    [e.recipient, BigInt(e.extAmount), e.relayer, BigInt(e.fee), e.encryptedOutput0, e.encryptedOutput1],
  )
  return BigInt(keccak256(encoded)) % FIELD_SIZE
}
