/**
 * Continuous agent. Unlike `demo` (a one-shot), this runs a loop:
 *
 *   every TICK_SECONDS:
 *     1. sweepIdle()  — invest any liquid above the buffer. This is what catches
 *        funds someone WIRES to the agent: they get invested on the next tick,
 *        not only when a task happens.
 *     2. every TASK_EVERY_TICKS ticks, pay a task (refilling from the vault if
 *        the buffer ran low).
 *
 * Ctrl-C to stop. Everything is real on-chain; emits events for the dashboard.
 */
import { formatUnits, getAddress } from 'viem'
import { config, explorerTx, validatePolicy } from '../config'
import { buildContext, buildAgent, policyAmounts } from '../agent/build'
import { runTick } from '../agent/runTick'
import { appendEvent, type AgentEvent } from '../events'

const D = 6
const usdc = (n: bigint) => `${formatUnits(n, D)} USDC`

// Interruptible sleep so Ctrl-C wakes us immediately.
let wake: () => void = () => {}
const sleep = (ms: number) => new Promise<void>((res) => { wake = res; setTimeout(res, ms) })

function logEvent(tick: number, e: AgentEvent) {
  if (e.type === 'sweep') console.log(`[tick ${tick}] invested idle ${e.amountUSDC} USDC  →  ${explorerTx(e.txHash)}`)
  else if (e.type === 'withdraw') console.log(`[tick ${tick}] buffer low → refilled ${e.amountUSDC} USDC  →  ${explorerTx(e.txHash)}`)
  else console.log(`[tick ${tick}] paid task ${e.amountUSDC} USDC  →  ${explorerTx(e.txHash)}`)
}

async function main() {
  const taskEveryTicks = config.taskEveryTicks
  if (taskEveryTicks > 0 && !config.payeeAddress) {
    console.error('PAYEE_ADDRESS is required when TASK_EVERY_TICKS > 0 (set it, or TASK_EVERY_TICKS=0 for sweep-only).')
    process.exit(1)
  }
  const policyErrors = validatePolicy(config)
  if (policyErrors.length) {
    console.error('Invalid policy config:\n - ' + policyErrors.join('\n - '))
    process.exit(1)
  }

  const ctx = buildContext()
  const payee = config.payeeAddress ? getAddress(config.payeeAddress) : ctx.account.address
  const agent = buildAgent(ctx, payee)
  const a = policyAmounts()

  let stop = false
  process.on('SIGINT', () => { console.log('\nstopping…'); stop = true; wake() })

  console.log('=== Auto-Invest Agent — continuous mode ===  (Ctrl-C to stop)')
  console.log(`Agent:  ${ctx.account.address}`)
  console.log(`Policy: ${config.bufferTasks}-task buffer (~${usdc(a.buffer)}); refill < ${config.lowWaterTasks} tasks (~${usdc(a.lowWater)})`)
  console.log(`Tick:   every ${config.tickSeconds}s · sweep idle each tick · task every ${taskEveryTicks || '∞'} ticks\n`)

  let tick = 0
  while (!stop) {
    tick++
    try {
      // A pending nonce ahead of latest means an earlier tx is still in flight
      // (or stuck) — don't act, or we'd queue behind it / double-submit.
      const [latest, pending] = await Promise.all([
        ctx.publicClient.getTransactionCount({ address: ctx.account.address, blockTag: 'latest' }),
        ctx.publicClient.getTransactionCount({ address: ctx.account.address, blockTag: 'pending' }),
      ])

      const r = await runTick({
        agent, tick, taskEveryTicks, taskCostUSDC: a.taskCost,
        pendingTxInFlight: pending > latest,
        now: Date.now(),
        emit: (e) => { appendEvent(e); logEvent(tick, e) },
      })

      if (r.skipped) {
        console.log(`[tick ${tick}] a transaction is still pending (nonce ${latest}); waiting`)
      } else {
        const snap = await agent.snapshot()
        console.log(`[tick ${tick}] liquid ${usdc(snap.liquid)} | invested ${usdc(snap.invested)}`)
      }
    } catch (e) {
      // A stuck tx (confirm timeout) or RPC hiccup — log and try again next tick.
      console.warn(`[tick ${tick}] error, will retry: ${e instanceof Error ? e.message : e}`)
    }
    if (!stop) await sleep(config.tickSeconds * 1000)
  }
  console.log('stopped.')
  process.exit(0)
}

main().catch((err) => {
  console.error('\nagent failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
