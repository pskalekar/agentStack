import { maxUint256, type Account, type Address, type Hash, type PublicClient, type WalletClient } from 'viem'
import { erc20Abi } from '../abi/erc20'
import { erc4626Abi } from '../abi/erc4626'
import { confirm } from '../lib/tx'
import type { EarnProvider, VaultPosition } from './types'

export interface MorphoVaultProviderOpts {
  publicClient: PublicClient
  walletClient: WalletClient
  account: Account
  vaultAddress: Address
  usdcAddress: Address
}

/**
 * Talks to an ERC-4626 USDC vault directly via viem. All decimal handling
 * (vault shares vs. 6-decimal USDC) is isolated here: callers work purely in
 * USDC base units, the vault's share math stays behind convertToAssets/Shares.
 */
export class MorphoVaultProvider implements EarnProvider {
  private readonly pub: PublicClient
  private readonly wallet: WalletClient
  private readonly account: Account
  private readonly vault: Address
  private readonly usdc: Address

  constructor(o: MorphoVaultProviderOpts) {
    this.pub = o.publicClient
    this.wallet = o.walletClient
    this.account = o.account
    this.vault = o.vaultAddress
    this.usdc = o.usdcAddress
  }

  async position(): Promise<VaultPosition> {
    const shares = await this.pub.readContract({
      address: this.vault, abi: erc4626Abi, functionName: 'balanceOf', args: [this.account.address],
    })
    const currentValue = shares === 0n ? 0n : await this.pub.readContract({
      address: this.vault, abi: erc4626Abi, functionName: 'convertToAssets', args: [shares],
    })
    return { shares, currentValue }
  }

  async maxWithdraw(): Promise<bigint> {
    return this.pub.readContract({
      address: this.vault, abi: erc4626Abi, functionName: 'maxWithdraw', args: [this.account.address],
    })
  }

  /** Ensure the vault is approved to pull at least `amount` USDC. Approves max once. */
  private async ensureAllowance(amount: bigint): Promise<void> {
    const allowance = await this.pub.readContract({
      address: this.usdc, abi: erc20Abi, functionName: 'allowance', args: [this.account.address, this.vault],
    })
    if (allowance >= amount) return
    const hash = await this.wallet.writeContract({
      address: this.usdc, abi: erc20Abi, functionName: 'approve', args: [this.vault, maxUint256],
      account: this.account, chain: this.wallet.chain,
    })
    await confirm(this.pub, hash)
  }

  async deposit(amountUSDC: bigint): Promise<{ txHash: Hash }> {
    await this.ensureAllowance(amountUSDC)
    const hash = await this.wallet.writeContract({
      address: this.vault, abi: erc4626Abi, functionName: 'deposit', args: [amountUSDC, this.account.address],
      account: this.account, chain: this.wallet.chain,
    })
    await confirm(this.pub, hash)
    return { txHash: hash }
  }

  async withdraw(amountUSDC: bigint): Promise<{ txHash: Hash }> {
    const hash = await this.wallet.writeContract({
      address: this.vault, abi: erc4626Abi, functionName: 'withdraw',
      args: [amountUSDC, this.account.address, this.account.address],
      account: this.account, chain: this.wallet.chain,
    })
    await confirm(this.pub, hash)
    return { txHash: hash }
  }
}
