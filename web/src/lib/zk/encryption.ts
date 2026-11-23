// Note encryption: AES-256-GCM (WebCrypto, Node + browser) under key = SHA-256("parlo-enc" || privKey32).
// Wire format: 0x | version(1 byte) | iv(12 bytes) | ciphertext+tag
import { bytesToHex, hexToBytes, type Hex } from 'viem'

export const ENC_VERSION = 1

export type NotePayload = { amount: bigint; blinding: bigint }
export type PositionPayload = {
  marketId: bigint
  isLong: boolean
  margin: bigint
  leverage: bigint
  entryEpoch: bigint
  blinding: bigint
}

const keyCache = new Map<bigint, Promise<CryptoKey>>()

function be32(x: bigint): Uint8Array {
  return hexToBytes(`0x${x.toString(16).padStart(64, '0')}`)
}

function encKey(privKey: bigint): Promise<CryptoKey> {
  let k = keyCache.get(privKey)
  if (!k) {
    k = (async () => {
      const prefix = new TextEncoder().encode('parlo-enc')
      const material = new Uint8Array(prefix.length + 32)
      material.set(prefix, 0)
      material.set(be32(privKey), prefix.length)
      const digest = await globalThis.crypto.subtle.digest('SHA-256', material)
      return globalThis.crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
    })()
    keyCache.set(privKey, k)
  }
  return k
}

async function encryptJson(privKey: bigint, obj: Record<string, string | number | boolean>): Promise<Hex> {
  const key = await encKey(privKey)
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const pt = new TextEncoder().encode(JSON.stringify(obj))
  const ct = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, pt))
  const out = new Uint8Array(1 + 12 + ct.length)
  out[0] = ENC_VERSION
  out.set(iv, 1)
  out.set(ct, 13)
  return bytesToHex(out)
}

async function decryptJson(privKey: bigint, data: Hex): Promise<Record<string, unknown> | null> {
  try {
    const bytes = hexToBytes(data)
    if (bytes.length < 1 + 12 + 16 || bytes[0] !== ENC_VERSION) return null
    const key = await encKey(privKey)
    const pt = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(1, 13) }, key, bytes.slice(13))
    return JSON.parse(new TextDecoder().decode(pt))
  } catch {
    return null
  }
}

export function encryptNote(privKey: bigint, n: NotePayload): Promise<Hex> {
  return encryptJson(privKey, { amount: n.amount.toString(), blinding: n.blinding.toString() })
}

export async function decryptNote(privKey: bigint, data: Hex): Promise<NotePayload | null> {
  const o = await decryptJson(privKey, data)
  if (!o || o.amount === undefined || o.blinding === undefined) return null
  try {
    return { amount: BigInt(o.amount as string), blinding: BigInt(o.blinding as string) }
  } catch {
    return null
  }
}

export function encryptPosition(privKey: bigint, p: PositionPayload): Promise<Hex> {
  return encryptJson(privKey, {
    marketId: p.marketId.toString(),
    isLong: p.isLong,
    margin: p.margin.toString(),
    leverage: p.leverage.toString(),
    entryEpoch: p.entryEpoch.toString(),
    blinding: p.blinding.toString(),
  })
}

export async function decryptPosition(privKey: bigint, data: Hex): Promise<PositionPayload | null> {
  const o = await decryptJson(privKey, data)
  if (!o || o.margin === undefined || o.marketId === undefined) return null
  try {
    return {
      marketId: BigInt(o.marketId as string),
      isLong: o.isLong === true,
      margin: BigInt(o.margin as string),
      leverage: BigInt(o.leverage as string),
      entryEpoch: BigInt(o.entryEpoch as string),
      blinding: BigInt(o.blinding as string),
    }
  } catch {
    return null
  }
}
