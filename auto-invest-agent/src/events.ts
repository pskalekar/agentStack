import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type AgentEvent =
  | { type: 'sweep'; amountUSDC: string; txHash: string; at: number }
  | { type: 'withdraw'; amountUSDC: string; txHash: string; at: number }
  | { type: 'pay'; amountUSDC: string; to: string; memo?: string; txHash: string; at: number }

// Activity log the agent appends to and the dashboard reads. Resolved from the
// process working directory so the CLI scripts and the Next.js app agree.
const dir = join(process.cwd(), '.data')
const file = join(dir, 'events.json')

const MAX_EVENTS = 500

/** Keep only the most recent `max` events (bounds unbounded growth). Pure. */
export function capEvents(events: AgentEvent[], max = MAX_EVENTS): AgentEvent[] {
  return events.length > max ? events.slice(-max) : events
}

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
  const all = capEvents([...readEvents(), event])
  // Write to a temp file then atomically rename, so a concurrent reader (the
  // dashboard) never sees a half-written file.
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(all, null, 2))
  renameSync(tmp, file)
}
