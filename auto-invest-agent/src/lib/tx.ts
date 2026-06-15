import type { Hash, PublicClient } from 'viem'

/**
 * Wait for a transaction and THROW if it reverted. `waitForTransactionReceipt`
 * resolves for reverted txs too (status: 'reverted'), so callers must check —
 * otherwise a failed transaction is silently treated as success.
 */
export async function confirm(pub: PublicClient, hash: Hash): Promise<void> {
  const receipt = await pub.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') {
    throw new Error(`Transaction reverted on-chain: ${hash}`)
  }
}
