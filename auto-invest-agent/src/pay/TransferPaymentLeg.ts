import type { Account, Address, PublicClient, WalletClient } from 'viem'
import { erc20Abi } from '../abi/erc20'
import { confirm } from '../lib/tx'
import type { PaymentLeg, PaymentResult } from './types'

export interface TransferPaymentLegOpts {
  publicClient: PublicClient
  walletClient: WalletClient
  account: Account
  usdcAddress: Address
  payee: Address
}

/**
 * Pays for a "service" with a real USDC ERC-20 transfer to a fixed payee.
 * A stand-in for a metered API payment until the x402 leg is wired in.
 */
export class TransferPaymentLeg implements PaymentLeg {
  private readonly pub: PublicClient
  private readonly wallet: WalletClient
  private readonly account: Account
  private readonly usdc: Address
  private readonly payee: Address

  constructor(o: TransferPaymentLegOpts) {
    this.pub = o.publicClient
    this.wallet = o.walletClient
    this.account = o.account
    this.usdc = o.usdcAddress
    this.payee = o.payee
  }

  async pay(amountUSDC: bigint, _memo?: string): Promise<PaymentResult> {
    const txHash = await this.wallet.writeContract({
      address: this.usdc, abi: erc20Abi, functionName: 'transfer', args: [this.payee, amountUSDC],
      account: this.account, chain: this.wallet.chain,
    })
    await confirm(this.pub, txHash)
    return { txHash, paidUSDC: amountUSDC, to: this.payee }
  }
}
