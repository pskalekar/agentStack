import type { Hash } from 'viem'

/**
 * A point-in-time view of the on-chain earn position.
 * All USDC amounts are in base units (6 decimals). `shares` is in the vault's
 * own share decimals (often 18 — never assume parity with the asset).
 *
 * Note: `principal` and `realized yield` are intentionally NOT here — they are
 * app-level concepts derived from the agent's own deposit/withdraw history, not
 * something the vault knows. This provider only reports on-chain truth.
 */
export interface VaultPosition {
  shares: bigint
  currentValue: bigint // convertToAssets(shares), in USDC base units
}

/**
 * The single seam that keeps the yield source swappable. Default implementation
 * is MorphoVaultProvider (direct ERC-4626 calls). A different backend can be
 * dropped in without touching the agent loop.
 */
export interface EarnProvider {
  /** Deposit USDC (6-decimal base units) into the yield source. */
  deposit(amountUSDC: bigint): Promise<{ txHash: Hash }>
  /** Withdraw USDC (6-decimal base units) back to the wallet. */
  withdraw(amountUSDC: bigint): Promise<{ txHash: Hash }>
  /** Max USDC currently withdrawable for this account, in base units. */
  maxWithdraw(): Promise<bigint>
  /** Current on-chain position. */
  position(): Promise<VaultPosition>
}
