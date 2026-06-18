import { formatUnits, type Hash } from 'viem'
import type { PayForTaskResult } from './AutoInvestAgent'
import type { AgentEvent } from '../events'

/**
 * Minimal agent surface one tick needs. Lets us unit-test the loop's decision
 * logic (pending guard + task cadence) without a chain. AutoInvestAgent satisfies it.
 */
export interface TickAgent {
  sweepIdle(): Promise<{ swept: bigint; txHash?: Hash }>
  payForTask(costUSDC: bigint, memo?: string): Promise<PayForTaskResult>
}

export interface TickResult {
  skipped: boolean // a tx was still in flight; did nothing this tick
  swept: bigint // amount invested this tick (0 if none)
  sweepTx?: Hash
  task?: PayForTaskResult // present only on a task-cadence tick
}

export interface TickInput {
  agent: TickAgent
  tick: number
  taskEveryTicks: number
  taskCostUSDC: bigint
  pendingTxInFlight: boolean
  now: number // timestamp for emitted events (injected for determinism/tests)
  emit: (e: AgentEvent) => void // called as each on-chain action completes
}

const D = 6

/**
 * One iteration of the continuous loop's decision logic (pure orchestration):
 *  - if a tx is still in flight → skip (don't queue behind it or double-submit)
 *  - otherwise sweep idle funds into the vault
 *  - and, every `taskEveryTicks` ticks (0 = never), pay a task
 *
 * Events are emitted **as each action completes**, so a successful sweep is
 * recorded even if a later task in the same tick throws.
 */
export async function runTick(o: TickInput): Promise<TickResult> {
  if (o.pendingTxInFlight) return { skipped: true, swept: 0n }

  const sweep = await o.agent.sweepIdle()
  if (sweep.swept > 0n) {
    o.emit({ type: 'sweep', amountUSDC: formatUnits(sweep.swept, D), txHash: sweep.txHash!, at: o.now })
  }

  let task: PayForTaskResult | undefined
  if (o.taskEveryTicks > 0 && o.tick % o.taskEveryTicks === 0) {
    task = await o.agent.payForTask(o.taskCostUSDC, 'scheduled task')
    if (task.refilled > 0n) {
      o.emit({ type: 'withdraw', amountUSDC: formatUnits(task.refilled, D), txHash: task.refillTx!, at: o.now })
    }
    o.emit({ type: 'pay', amountUSDC: formatUnits(task.payment.paidUSDC, D), to: task.payment.to, memo: 'scheduled task', txHash: task.payment.txHash, at: o.now })
  }

  return { skipped: false, swept: sweep.swept, sweepTx: sweep.txHash, task }
}
