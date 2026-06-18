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
import { appendEvent } from '../events'

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
  const lowWater = parseUnits(config.lowWaterUsdc, D)
  const taskCost = parseUnits(config.taskCostUsdc, D)
  const gasReserve = parseUnits(config.gasReserveUsdc, D)
  const tasks = config.demoTasks

  console.log('=== Auto-Invest Agent — demo ===')
  console.log(`Chain:  ${chain.name} (${chain.id})`)
  console.log(`Agent:  ${account.address}`)
  console.log(`Vault:  ${vaultAddr}`)
  console.log(`Payee:  ${payee}`)
  console.log(`Policy: ${config.bufferTasks}-task buffer (~${usdc(buffer)}); each task ~${usdc(taskCost)} + ~${usdc(gasReserve)} gas; refill from vault when liquid < ${config.lowWaterTasks} tasks (~${usdc(lowWater)})\n`)

  const earn = new MorphoVaultProvider({ publicClient, walletClient, account, vaultAddress: vaultAddr, usdcAddress: usdcAddr })
  const pay = new TransferPaymentLeg({ publicClient, walletClient, account, usdcAddress: usdcAddr, payee })
  const agent = new AutoInvestAgent({ publicClient, account, usdcAddress: usdcAddr, earn, pay, bufferUSDC: buffer, lowWaterUSDC: lowWater, gasReserveUSDC: gasReserve })

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
    appendEvent({ type: 'sweep', amountUSDC: formatUnits(swept.swept, D), txHash: swept.txHash!, at: Date.now() })
  } else {
    console.log('  nothing to sweep (liquid already at/below buffer)')
  }
  showSnapshot('after sweep:', await agent.snapshot())

  // Step 2 — a stream of paid tasks. Pay from the buffer; refill only when low.
  console.log(`\nStep 2 — run ${tasks} paid tasks (each ${usdc(taskCost)}); refill from the vault only when the buffer runs low`)
  let refills = 0
  for (let i = 1; i <= tasks; i++) {
    const result = await agent.payForTask(taskCost, 'premium data API call')
    if (result.refilled > 0n) {
      refills++
      console.log(`  • buffer low → refilled ${usdc(result.refilled)} from vault  →  ${explorerTx(result.refillTx!)}`)
      appendEvent({ type: 'withdraw', amountUSDC: formatUnits(result.refilled, D), txHash: result.refillTx!, at: Date.now() })
    }
    console.log(`  task ${i}/${tasks}: paid ${usdc(result.payment.paidUSDC)}  →  ${explorerTx(result.payment.txHash)}`)
    appendEvent({ type: 'pay', amountUSDC: formatUnits(result.payment.paidUSDC, D), to: result.payment.to, memo: 'premium data API call', txHash: result.payment.txHash, at: Date.now() })
  }

  // Step 3 — final position
  console.log('\nStep 3 — final position')
  showSnapshot('now:', await agent.snapshot())
  console.log(`\n✓ Demo complete: invested idle USDC, paid ${tasks} tasks from the buffer with only ${refills} refill${refills === 1 ? '' : 's'} from the vault.`)
}

main().catch((err) => {
  console.error('\ndemo failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
