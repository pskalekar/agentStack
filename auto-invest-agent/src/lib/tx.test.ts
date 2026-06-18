import { describe, it, expect } from 'vitest'
import type { PublicClient } from 'viem'
import { confirm } from './tx'

function pubWith(status: 'success' | 'reverted') {
  return { waitForTransactionReceipt: async () => ({ status }) } as unknown as PublicClient
}

describe('confirm', () => {
  it('resolves when the receipt status is success', async () => {
    await expect(confirm(pubWith('success'), '0xabc')).resolves.toBeUndefined()
  })

  // Regression guard for the false-success bug: waitForTransactionReceipt
  // resolves for reverted txs too, so confirm() must throw on non-success.
  it('throws when the transaction reverted', async () => {
    await expect(confirm(pubWith('reverted'), '0xabc')).rejects.toThrow(/reverted/i)
  })
})
