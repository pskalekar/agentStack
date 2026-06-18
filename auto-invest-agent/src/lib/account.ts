import { privateKeyToAccount } from 'viem/accounts'

/** Accept a key with or without the 0x prefix. */
export function normalizeKey(key: string): `0x${string}` {
  return (key.startsWith('0x') ? key : `0x${key}`) as `0x${string}`
}

/** Load a viem account from a (possibly unprefixed) private key. */
export function loadAccount(privateKey: string) {
  return privateKeyToAccount(normalizeKey(privateKey))
}
