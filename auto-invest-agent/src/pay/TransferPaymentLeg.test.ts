import { describe, it, expect } from 'vitest'
import type { Account, Address, Hash, PublicClient, WalletClient } from 'viem'
import { TransferPaymentLeg } from './TransferPaymentLeg'

const USDC = '0x00000000000000000000000000000000000000Dc' as Address
const PAYEE = '0x0000000000000000000000000000000000Payee' as Address
const ACCOUNT = { address: '0x00000000000000000000000000000000000Agent' } as unknown as Account

function clients(receiptStatus: 'success' | 'reverted' = 'success') {
  const writes: { address: Address; functionName: string; args: readonly unknown[] }[] = []
  const pub = { waitForTransactionReceipt: async () => ({ status: receiptStatus }) } as unknown as PublicClient
  const wallet = {
    chain: { id: 1 },
    writeContract: async (req: { address: Address; functionName: string; args: readonly unknown[] }) => {
      writes.push({ address: req.address, functionName: req.functionName, args: req.args })
      return '0xpay' as Hash
    },
  } as unknown as WalletClient
  return { pub, wallet, writes }
}

function leg(c: ReturnType<typeof clients>) {
  return new TransferPaymentLeg({ publicClient: c.pub, walletClient: c.wallet, account: ACCOUNT, usdcAddress: USDC, payee: PAYEE })
}

describe('TransferPaymentLeg', () => {
  it('transfers the exact amount to the payee and returns the result', async () => {
    const c = clients()
    const r = await leg(c).pay(250000n)
    expect(c.writes[0]).toMatchObject({ address: USDC, functionName: 'transfer', args: [PAYEE, 250000n] })
    expect(r).toMatchObject({ txHash: '0xpay', paidUSDC: 250000n, to: PAYEE })
  })

  it('throws if the transfer reverts (no false success)', async () => {
    await expect(leg(clients('reverted')).pay(250000n)).rejects.toThrow(/reverted/i)
  })
})
