/**
 * demo: a single-pass run of the Auto-Invest Agent against real testnet contracts.
 *
 *   1. Show the agent's starting position.
 *   2. Sweep idle USDC (above the buffer) into the yield vault.
 *   3. A task arrives that costs USDC — the agent withdraws just enough, then pays.
 *   4. Show the final position.
 *
 * Everything is real on-chain: real deposit, real just-in-time withdrawal, real
 * payment (a USDC transfer standing in for a metered service call).
 */
import { createPublicClient, createWalletClient, http, formatUnits, parseUnits, getAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { chain } from '../chain'
import { config, explorerTx } from '../config'
import { MorphoVaultProvider } from '../earn/MorphoVaultProvider'
import { TransferPaymentLeg } from '../pay/TransferPaymentLeg'
import { AutoInvestAgent, type Snapshot } from '../agent/AutoInvestAgent'

const D = 6
const usdc = (n: bigint) => `${formatUnits(n, D)} USDC`

function showSnapshot(label: string, s: Snapshot) {
  console.log(`  ${label}`)
  console.log(`    liquid:   ${usdc(s.liquid)}`)
  console.log(`    invested: ${usdc(s.invested)}`)
}

async function main() {
  // --- preconditions ---
  if (!config.privateKey) {
    console.error('AGENT_PRIVATE_KEY is not set. The demo moves real testnet USDC — set a testnet key in .env.')
    process.exit(1)
  }
  if (!config.vaultAddress) {
    console.error('VAULT_ADDRESS is not set. Set an ERC-4626 USDC vault in .env (verify on https://testnet.arcscan.app).')
    process.exit(1)
  }
  if (!config.payeeAddress) {
    console.error('PAYEE_ADDRESS is not set. Set any testnet address to receive the demo "service payment".')
    process.exit(1)
  }

  const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) })
  const account = privateKeyToAccount(
    config.privateKey.startsWith('0x') ? (config.privateKey as `0x${string}`) : (`0x${config.privateKey}` as `0x${string}`),
  )
  const walletClient = createWalletClient({ account, chain, transport: http(config.rpcUrl) })

  const usdcAddr = getAddress(config.usdcAddress)
  const vaultAddr = getAddress(config.vaultAddress)
  const payee = getAddress(config.payeeAddress)
  const buffer = parseUnits(config.bufferUsdc, D)
  const taskCost = parseUnits(config.taskCostUsdc, D)
  const gasReserve = parseUnits(config.gasReserveUsdc, D)

  console.log('=== Auto-Invest Agent — demo ===')
  console.log(`Chain:  ${chain.name} (${chain.id})`)
  console.log(`Agent:  ${account.address}`)
  console.log(`Vault:  ${vaultAddr}`)
  console.log(`Payee:  ${payee}`)
  console.log(`Policy: keep ${usdc(buffer)} liquid; a task costs ${usdc(taskCost)}\n`)

  const earn = new MorphoVaultProvider({ publicClient, walletClient, account, vaultAddress: vaultAddr, usdcAddress: usdcAddr })
  const pay = new TransferPaymentLeg({ publicClient, walletClient, account, usdcAddress: usdcAddr, payee })
  const agent = new AutoInvestAgent({ publicClient, account, usdcAddress: usdcAddr, earn, pay, bufferUSDC: buffer, gasReserveUSDC: gasReserve })

  const nativeBal = await publicClient.getBalance({ address: account.address })
  if (nativeBal === 0n) {
    console.error('Native (gas) balance is 0 — fund from https://faucet.circle.com (gas is paid in USDC on Arc).')
    process.exit(1)
  }

  const start = await agent.snapshot()
  console.log('Step 0 — starting position')
  showSnapshot('now:', start)

  if (start.liquid < taskCost && start.liquid + start.invested < taskCost) {
    console.error(`\nNot enough USDC to run the demo (need ~${usdc(taskCost)}). Fund the agent at https://faucet.circle.com and re-run.`)
    process.exit(1)
  }

  // Step 1 — invest idle USDC
  console.log('\nStep 1 — sweep idle USDC into the vault')
  const swept = await agent.sweepIdle()
  if (swept.swept > 0n) {
    console.log(`  invested ${usdc(swept.swept)}  →  ${explorerTx(swept.txHash!)}`)
  } else {
    console.log('  nothing to sweep (liquid already at/below buffer)')
  }
  showSnapshot('after sweep:', await agent.snapshot())

  // Step 2 — a paid task arrives
  console.log(`\nStep 2 — task arrives: pay ${usdc(taskCost)} for "premium data API call"`)
  const result = await agent.payForTask(taskCost, 'premium data API call')
  if (result.withdrew > 0n) {
    console.log(`  liquid was short — withdrew ${usdc(result.withdrew)} from vault  →  ${explorerTx(result.withdrawTx!)}`)
  } else {
    console.log('  covered from liquid balance (no withdrawal needed)')
  }
  console.log(`  paid ${usdc(result.payment.paidUSDC)} to payee  →  ${explorerTx(result.payment.txHash)}`)

  // Step 3 — final position
  console.log('\nStep 3 — final position')
  showSnapshot('now:', await agent.snapshot())

  console.log('\n✓ Demo complete: idle USDC was invested, then partially redeemed just-in-time to pay for a service.')
}

main().catch((err) => {
  console.error('\ndemo failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
