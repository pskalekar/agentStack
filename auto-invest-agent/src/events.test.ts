import { describe, it, expect } from 'vitest'
import { capEvents, type AgentEvent } from './events'

const ev = (i: number): AgentEvent => ({ type: 'pay', amountUSDC: '0.1', to: '0xp', txHash: `0x${i}`, at: i })

describe('capEvents', () => {
  it('keeps all when under the cap', () => {
    const list = [ev(1), ev(2), ev(3)]
    expect(capEvents(list, 5)).toHaveLength(3)
  })

  it('keeps only the most recent when over the cap', () => {
    const list = Array.from({ length: 10 }, (_, i) => ev(i))
    const capped = capEvents(list, 4)
    expect(capped).toHaveLength(4)
    expect(capped.map((e) => e.at)).toEqual([6, 7, 8, 9]) // newest 4
  })
})
