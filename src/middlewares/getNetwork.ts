import { ethers } from 'ethers'
import { PublicKey } from '@solana/web3.js'
import CustomError from './error/customError.js'
import secp256k1 from 'secp256k1'

function hexToUint8Array(hexString: string): Uint8Array {
  return new Uint8Array(hexString.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)))
}

function checkEVM(value: string): boolean {
  return ethers.isAddress(value?.toLowerCase())
}

function checkSolana(value: string): boolean {
  try {
    const pub = new PublicKey(value)
    return PublicKey.isOnCurve(pub)
  } catch (error) {
    return false
  }
}

function checkCosmos(value: string): boolean {
  try {
    const formattedPubkey = hexToUint8Array(value)
    return secp256k1.publicKeyVerify(formattedPubkey)
  } catch (error) {
    return false
  }
}

function checkRadix(value: any): boolean {
  if (typeof value !== 'string') return false
  const prefixMainnet = 'account_rdx1'
  const prefixTestnet = 'account_tdx_2'
  return value.startsWith(prefixMainnet) || value.startsWith(prefixTestnet)
}

export default (value: string): string => {
  try {
    if (checkEVM(value)) {
      return 'evm'
    } else if (checkSolana(value)) {
      return 'solana'
    } else if (checkCosmos(value)) {
      return 'cosmos'
    } else if (checkRadix(value)) {
      return 'radix'
    }

    throw new CustomError(400, 'Invalid Address')
  } catch (error) {
    throw new CustomError(400, 'Invalid Address')
  }
}

