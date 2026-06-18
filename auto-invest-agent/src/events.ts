import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type AgentEvent =
  | { type: 'sweep'; amountUSDC: string; txHash: string; at: number }
  | { type: 'withdraw'; amountUSDC: string; txHash: string; at: number }
  | { type: 'pay'; amountUSDC: string; to: string; memo?: string; txHash: string; at: number }

// Activity log the agent appends to and the dashboard reads. Resolved from the
// process working directory so the CLI scripts and the Next.js app agree.
const dir = join(process.cwd(), '.data')
const file = join(dir, 'events.json')

export function readEvents(): AgentEvent[] {
  if (!existsSync(file)) return []
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as AgentEvent[]
  } catch {
    return []
  }
}

export function appendEvent(event: AgentEvent): void {
  mkdirSync(dir, { recursive: true })
  const all = readEvents()
  all.push(event)
  writeFileSync(file, JSON.stringify(all, null, 2))
}
