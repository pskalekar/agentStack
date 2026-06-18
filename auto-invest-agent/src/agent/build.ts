import { createPublicClient, createWalletClient, http, parseUnits, getAddress, type Address } from 'viem'
import { chain } from '../chain'
import { config } from '../config'
import { loadAccount } from '../lib/account'
import { MorphoVaultProvider } from '../earn/MorphoVaultProvider'
import { TransferPaymentLeg } from '../pay/TransferPaymentLeg'
import { AutoInvestAgent } from './AutoInvestAgent'

const D = 6

/** Policy amounts parsed from config strings into base units. */
export function policyAmounts() {
  return {
    buffer: parseUnits(config.bufferUsdc, D),
    lowWater: parseUnits(config.lowWaterUsdc, D),
    gasReserve: parseUnits(config.gasReserveUsdc, D),
    taskCost: parseUnits(config.taskCostUsdc, D),
    minSweep: parseUnits(config.minSweepUsdc, D),
  }
}

export type Context = ReturnType<typeof buildContext>

/** Shared wiring: clients, account, addresses, and the earn provider. */
export function buildContext() {
  if (!config.privateKey) throw new Error('AGENT_PRIVATE_KEY is not set.')
  if (!config.vaultAddress) throw new Error('VAULT_ADDRESS is not set — set an ERC-4626 USDC vault (verify on the explorer).')

  const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) })
  const account = loadAccount(config.privateKey)
  const walletClient = createWalletClient({ account, chain, transport: http(config.rpcUrl) })
  const usdc = getAddress(config.usdcAddress)
  const vault = getAddress(config.vaultAddress)
  const earn = new MorphoVaultProvider({ publicClient, walletClient, account, vaultAddress: vault, usdcAddress: usdc })

  return { publicClient, walletClient, account, usdc, vault, earn }
}

/** Assemble the AutoInvestAgent (payment leg + policy) on top of a context. */
export function buildAgent(ctx: Context, payee: Address): AutoInvestAgent {
  const a = policyAmounts()
  const pay = new TransferPaymentLeg({
    publicClient: ctx.publicClient, walletClient: ctx.walletClient, account: ctx.account, usdcAddress: ctx.usdc, payee,
  })
  return new AutoInvestAgent({
    publicClient: ctx.publicClient, account: ctx.account, usdcAddress: ctx.usdc, earn: ctx.earn, pay,
    bufferUSDC: a.buffer, lowWaterUSDC: a.lowWater, gasReserveUSDC: a.gasReserve, minSweepUSDC: a.minSweep,
  })
}
