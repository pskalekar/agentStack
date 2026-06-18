import type { Hash, PublicClient } from 'viem'

/**
 * Wait for a transaction and THROW if it reverted. `waitForTransactionReceipt`
 * resolves for reverted txs too (status: 'reverted'), so callers must check —
 * otherwise a failed transaction is silently treated as success.
 */
export async function confirm(pub: PublicClient, hash: Hash, timeoutMs = 120_000): Promise<void> {
  // `timeout` prevents an indefinite hang if a tx gets stuck pending (e.g.
  // underpriced / not mined). viem throws on timeout; callers handle it.
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: timeoutMs })
  if (receipt.status !== 'success') {
    throw new Error(`Transaction reverted on-chain: ${hash}`)
  }
}
