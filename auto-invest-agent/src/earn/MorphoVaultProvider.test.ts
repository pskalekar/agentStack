import { describe, it, expect } from 'vitest'
import { maxUint256, type Account, type Address, type Hash, type PublicClient, type WalletClient } from 'viem'
import { MorphoVaultProvider } from './MorphoVaultProvider'

const VAULT = '0x00000000000000000000000000000000000000Va' as Address
const USDC = '0x00000000000000000000000000000000000000Dc' as Address
const ACCOUNT = { address: '0x00000000000000000000000000000000000Agent' } as unknown as Account

function makeClients(opts: {
  reads?: Record<string, (args: readonly unknown[]) => unknown>
  receiptStatus?: 'success' | 'reverted'
}) {
  const writes: { address: Address; functionName: string; args: readonly unknown[] }[] = []
  const pub = {
    readContract: async ({ functionName, args }: { functionName: string; args?: readonly unknown[] }) => {
      const fn = opts.reads?.[functionName]
      if (!fn) throw new Error(`unmocked read: ${functionName}`)
      return fn(args ?? [])
    },
    waitForTransactionReceipt: async () => ({ status: opts.receiptStatus ?? 'success' }),
  } as unknown as PublicClient
  const wallet = {
    chain: { id: 1 },
    writeContract: async (req: { address: Address; functionName: string; args: readonly unknown[] }) => {
      writes.push({ address: req.address, functionName: req.functionName, args: req.args })
      return `0x${req.functionName}` as Hash
    },
  } as unknown as WalletClient
  return { pub, wallet, writes }
}

function provider(c: ReturnType<typeof makeClients>) {
  return new MorphoVaultProvider({ publicClient: c.pub, walletClient: c.wallet, account: ACCOUNT, vaultAddress: VAULT, usdcAddress: USDC })
}

describe('MorphoVaultProvider.position (18-dec shares vs 6-dec USDC)', () => {
  it('reports currentValue in 6-dec USDC even when shares are 18-dec', async () => {
    const shares = 5_000000n * 10n ** 12n // 5 USDC worth, as 18-dec shares
    const c = makeClients({
      reads: {
        balanceOf: () => shares,
        convertToAssets: (args) => (args[0] as bigint) / 10n ** 12n, // 18-dec → 6-dec
      },
    })
    const pos = await provider(c).position()
    expect(pos.shares).toBe(shares)
    expect(pos.currentValue).toBe(5_000000n) // 5 USDC — not the raw 18-dec number
  })

  it('returns zero for an empty position without calling convertToAssets', async () => {
    const c = makeClients({
      reads: {
        balanceOf: () => 0n,
        convertToAssets: () => { throw new Error('should not be called for zero shares') },
      },
    })
    expect((await provider(c).position()).currentValue).toBe(0n)
  })
})

describe('MorphoVaultProvider.deposit', () => {
  it('approves (when allowance insufficient) then deposits assets to the vault', async () => {
    const c = makeClients({ reads: { allowance: () => 0n } })
    const { txHash } = await provider(c).deposit(1_000000n)
    expect(c.writes.map((w) => w.functionName)).toEqual(['approve', 'deposit'])
    expect(c.writes[0]).toMatchObject({ address: USDC, args: [VAULT, maxUint256] })
    expect(c.writes[1]).toMatchObject({ address: VAULT, args: [1_000000n, ACCOUNT.address] })
    expect(txHash).toBe('0xdeposit')
  })

  it('skips approve when allowance is already sufficient', async () => {
    const c = makeClients({ reads: { allowance: () => maxUint256 } })
    await provider(c).deposit(1_000000n)
    expect(c.writes.map((w) => w.functionName)).toEqual(['deposit'])
  })

  it('throws if the deposit reverts (no false success)', async () => {
    const c = makeClients({ reads: { allowance: () => maxUint256 }, receiptStatus: 'reverted' })
    await expect(provider(c).deposit(1_000000n)).rejects.toThrow(/reverted/i)
  })
})

describe('MorphoVaultProvider.withdraw', () => {
  it('calls withdraw(assets, receiver, owner)', async () => {
    const c = makeClients({})
    await provider(c).withdraw(2_000000n)
    expect(c.writes).toHaveLength(1)
    expect(c.writes[0]).toMatchObject({
      address: VAULT,
      functionName: 'withdraw',
      args: [2_000000n, ACCOUNT.address, ACCOUNT.address],
    })
  })

  it('throws if the withdraw reverts', async () => {
    const c = makeClients({ receiptStatus: 'reverted' })
    await expect(provider(c).withdraw(2_000000n)).rejects.toThrow(/reverted/i)
  })
})

describe('MorphoVaultProvider.maxWithdraw', () => {
  it('passes through the vault maxWithdraw', async () => {
    const c = makeClients({ reads: { maxWithdraw: () => 7_000000n } })
    expect(await provider(c).maxWithdraw()).toBe(7_000000n)
  })
})
