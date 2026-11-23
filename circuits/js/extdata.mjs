// extDataHash = uint256(keccak256(abi.encode(recipient, extAmount(int256), relayer, fee, encOut0, encOut1))) % p
// Uses ethers v5 (dependency of circomlibjs). In the frontend, viem's encodeAbiParameters + keccak256 is equivalent.
import { ethers } from "ethers";
import { FIELD_SIZE } from "./field.mjs";

export function extDataHash({ recipient, extAmount, relayer, fee, encryptedOutput0 = "0x", encryptedOutput1 = "0x" }) {
  const encoded = ethers.utils.defaultAbiCoder.encode(
    ["address", "int256", "address", "uint256", "bytes", "bytes"],
    [recipient, BigInt(extAmount).toString(), relayer, BigInt(fee).toString(), encryptedOutput0, encryptedOutput1],
  );
  return BigInt(ethers.utils.keccak256(encoded)) % FIELD_SIZE;
}

/** privKey = keccak256(signature) mod p */
export function privKeyFromSignature(signatureHex) {
  return BigInt(ethers.utils.keccak256(signatureHex)) % FIELD_SIZE;
}
