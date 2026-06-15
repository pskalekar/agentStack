import type { Address, Hash } from 'viem'

export interface PaymentResult {
  txHash: Hash
  paidUSDC: bigint // base units (6 decimals)
  to: Address
}

/**
 * How the agent pays for a service. Swappable seam — same idea as EarnProvider.
 *
 * v1 (TransferPaymentLeg): a plain USDC transfer to a payee, standing in for
 * "paying for a service." A future X402PaymentLeg can implement the same
 * interface using Nanopayments / x402 via the Circle CLI without changing the
 * agent loop.
 */
export interface PaymentLeg {
  /** Pay `amountUSDC` (base units) for a service. */
  pay(amountUSDC: bigint, memo?: string): Promise<PaymentResult>
}
