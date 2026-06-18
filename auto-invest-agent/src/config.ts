import 'dotenv/config'

function opt(name: string, fallback: string): string {
  const v = process.env[name]
  return v === undefined || v === '' ? fallback : v
}

// Policy knobs. The agent sizes its liquid float in TASKS, where each task's
// all-in cost is the payment PLUS gas (gas is paid in USDC on Arc, same balance).
//   per-task    = TASK_COST_USDC + GAS_PER_TASK_USDC
//   buffer      = BUFFER_TASKS    × per-task   (high-water target liquid)
//   low-water   = LOW_WATER_TASKS × per-task   (refill trigger)
const taskCostUsdc = opt('TASK_COST_USDC', '0.1')
const gasPerTaskUsdc = opt('GAS_PER_TASK_USDC', '0.01')
const bufferTasks = Number(opt('BUFFER_TASKS', '10'))
const lowWaterTasks = Number(opt('LOW_WATER_TASKS', '5'))

/** Derive absolute USDC amounts from the task-count knobs. Pure + testable. */
export function derivePolicy(taskCost: string, gasPerTask: string, bufTasks: number, lowTasks: number) {
  const perTask = Number(taskCost) + Number(gasPerTask)
  return {
    perTaskUsdc: perTask.toFixed(6),
    bufferUsdc: (perTask * bufTasks).toFixed(6),
    lowWaterUsdc: (perTask * lowTasks).toFixed(6),
  }
}

/** Validate the policy invariants the agent logic relies on. Returns problems. */
export function validatePolicy(p: {
  taskCostUsdc: string; gasReserveUsdc: string; bufferUsdc: string; lowWaterUsdc: string
}): string[] {
  const task = Number(p.taskCostUsdc)
  const gas = Number(p.gasReserveUsdc)
  const buffer = Number(p.bufferUsdc)
  const low = Number(p.lowWaterUsdc)
  const errs: string[] = []
  if (!(task > 0)) errs.push(`TASK_COST_USDC must be > 0 (got ${p.taskCostUsdc})`)
  if (gas < 0) errs.push(`GAS_PER_TASK_USDC must be >= 0 (got ${p.gasReserveUsdc})`)
  if (low > buffer) errs.push(`low-water (${p.lowWaterUsdc}) must be <= buffer (${p.bufferUsdc}); raise BUFFER_TASKS or lower LOW_WATER_TASKS`)
  if (low < task + gas) errs.push(`low-water (${p.lowWaterUsdc}) must cover one task + gas (${(task + gas).toFixed(6)}); raise LOW_WATER_TASKS`)
  return errs
}

const { perTaskUsdc, bufferUsdc, lowWaterUsdc } = derivePolicy(taskCostUsdc, gasPerTaskUsdc, bufferTasks, lowWaterTasks)

export const config = {
  rpcUrl: opt('RPC_URL', 'https://rpc.testnet.arc.network'),
  chainId: Number(opt('CHAIN_ID', '5042002')),
  explorerUrl: opt('EXPLORER_URL', 'https://testnet.arcscan.app'),
  usdcAddress: opt('USDC_ADDRESS', '0x3600000000000000000000000000000000000000') as `0x${string}`,
  vaultAddress: (process.env.VAULT_ADDRESS ?? '') as `0x${string}`,
  privateKey: process.env.AGENT_PRIVATE_KEY ?? '',

  // --- Agent policy ---
  taskCostUsdc, // approximate cost per task
  gasPerTaskUsdc, // gas headroom per task (gas is USDC on Arc)
  bufferTasks, // high-water float, in tasks
  lowWaterTasks, // refill trigger, in tasks
  perTaskUsdc, // derived: task + gas
  bufferUsdc, // derived: bufferTasks × per-task
  lowWaterUsdc, // derived: lowWaterTasks × per-task
  gasReserveUsdc: gasPerTaskUsdc, // pay-time gas floor (= one task's gas)
  // Don't sweep idle USDC smaller than this — avoids deposit txs whose gas
  // exceeds the amount invested. Defaults to one task's worth.
  minSweepUsdc: opt('MIN_SWEEP_USDC', taskCostUsdc),
  tickSeconds: Number(opt('TICK_SECONDS', '15')),
  taskEveryTicks: Number(opt('TASK_EVERY_TICKS', '3')), // continuous mode: a task every N ticks (0 = sweep only)

  // --- verify-earn ---
  verifyAmountUsdc: opt('VERIFY_AMOUNT_USDC', '0.1'),

  // --- demo ---
  payeeAddress: (process.env.PAYEE_ADDRESS ?? '') as `0x${string}`,
  demoTasks: Number(opt('DEMO_TASKS', '12')),

  // --- dashboard ---
  agentAddress: (process.env.AGENT_ADDRESS ?? '') as `0x${string}`,
}

export function explorerTx(hash: string): string {
  return `${config.explorerUrl}/tx/${hash}`
}
