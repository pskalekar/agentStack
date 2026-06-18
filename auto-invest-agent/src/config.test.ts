import { describe, it, expect } from 'vitest'
import { derivePolicy } from './config'

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
