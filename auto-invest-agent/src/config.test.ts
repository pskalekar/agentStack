import { describe, it, expect } from 'vitest'
import { derivePolicy, validatePolicy } from './config'

describe('derivePolicy', () => {
  it('sizes buffer and low-water as task-counts of (task + gas)', () => {
    const p = derivePolicy('0.1', '0.01', 10, 5)
    expect(p.perTaskUsdc).toBe('0.110000') // task + gas
    expect(p.bufferUsdc).toBe('1.100000') // 0.11 × 10
    expect(p.lowWaterUsdc).toBe('0.550000') // 0.11 × 5
  })

  it('scales with the task cost', () => {
    const p = derivePolicy('0.5', '0', 4, 2)
    expect(p.bufferUsdc).toBe('2.000000')
    expect(p.lowWaterUsdc).toBe('1.000000')
  })

  it('renders cleanly despite float drift (0.3 × 3 = 0.8999… in float)', () => {
    const p = derivePolicy('0.3', '0', 3, 1)
    expect(p.bufferUsdc).toBe('0.900000')
  })
})

describe('validatePolicy', () => {
  const ok = { taskCostUsdc: '0.1', gasReserveUsdc: '0.01', bufferUsdc: '1.1', lowWaterUsdc: '0.55' }

  it('accepts a sane policy', () => {
    expect(validatePolicy(ok)).toEqual([])
  })

  it('rejects low-water above buffer', () => {
    const errs = validatePolicy({ ...ok, bufferUsdc: '0.4', lowWaterUsdc: '0.55' })
    expect(errs.join(' ')).toMatch(/low-water.*<= buffer/i)
  })

  it('rejects low-water that cannot cover one task + gas', () => {
    const errs = validatePolicy({ ...ok, lowWaterUsdc: '0.05' }) // < 0.1 + 0.01
    expect(errs.join(' ')).toMatch(/cover one task \+ gas/i)
  })

  it('rejects a zero task cost', () => {
    const errs = validatePolicy({ ...ok, taskCostUsdc: '0' })
    expect(errs.join(' ')).toMatch(/TASK_COST_USDC must be > 0/i)
  })
})
