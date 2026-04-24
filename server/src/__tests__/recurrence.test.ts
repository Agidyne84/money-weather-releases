import { describe, it, expect } from 'vitest'
import { isTransactionOnDate } from '../../../shared/recurrence'

// Helpers to build test inputs concisely.
const tx = (partial: any) => ({
  is_active: 1,
  ...partial,
})
const d = (ymd: string) => {
  const [y, m, day] = ymd.split('-').map(Number)
  return new Date(y, m - 1, day, 12, 0, 0)
}

describe('isTransactionOnDate — simple units', () => {
  it('fires on the start date itself', () => {
    const t = tx({ start_date: '2026-01-01', frequency_value: 1, frequency_unit: 'months' })
    expect(isTransactionOnDate(t, d('2026-01-01'))).toBe(true)
  })

  it('never fires before the start date', () => {
    const t = tx({ start_date: '2026-01-15', frequency_value: 1, frequency_unit: 'months' })
    expect(isTransactionOnDate(t, d('2026-01-14'))).toBe(false)
  })

  it('every 3 days: hits multiples of 3, misses the in-between days', () => {
    const t = tx({ start_date: '2026-03-01', frequency_value: 3, frequency_unit: 'days' })
    expect(isTransactionOnDate(t, d('2026-03-01'))).toBe(true)
    expect(isTransactionOnDate(t, d('2026-03-02'))).toBe(false)
    expect(isTransactionOnDate(t, d('2026-03-03'))).toBe(false)
    expect(isTransactionOnDate(t, d('2026-03-04'))).toBe(true)
    expect(isTransactionOnDate(t, d('2026-03-07'))).toBe(true)
  })

  it('weekly (every 2 weeks): same weekday on the 14-day cadence', () => {
    const t = tx({ start_date: '2026-03-02', frequency_value: 2, frequency_unit: 'weeks' }) // Monday
    expect(isTransactionOnDate(t, d('2026-03-02'))).toBe(true)
    expect(isTransactionOnDate(t, d('2026-03-09'))).toBe(false) // next Monday is only 1 week
    expect(isTransactionOnDate(t, d('2026-03-16'))).toBe(true)
    expect(isTransactionOnDate(t, d('2026-03-17'))).toBe(false)
  })

  it('monthly on the 15th: hits the 15th each month, not other days', () => {
    const t = tx({ start_date: '2026-01-15', frequency_value: 1, frequency_unit: 'months' })
    expect(isTransactionOnDate(t, d('2026-01-15'))).toBe(true)
    expect(isTransactionOnDate(t, d('2026-02-15'))).toBe(true)
    expect(isTransactionOnDate(t, d('2026-03-15'))).toBe(true)
    expect(isTransactionOnDate(t, d('2026-02-14'))).toBe(false)
    expect(isTransactionOnDate(t, d('2026-02-16'))).toBe(false)
  })

  it('monthly on the 31st clamps to the last day of shorter months', () => {
    const t = tx({ start_date: '2026-01-31', frequency_value: 1, frequency_unit: 'months' })
    expect(isTransactionOnDate(t, d('2026-01-31'))).toBe(true)
    expect(isTransactionOnDate(t, d('2026-02-28'))).toBe(true) // 2026 is not a leap year
    expect(isTransactionOnDate(t, d('2026-03-31'))).toBe(true)
    expect(isTransactionOnDate(t, d('2026-04-30'))).toBe(true)
  })

  it('yearly: same month + day each year', () => {
    const t = tx({ start_date: '2025-04-20', frequency_value: 1, frequency_unit: 'years' })
    expect(isTransactionOnDate(t, d('2025-04-20'))).toBe(true)
    expect(isTransactionOnDate(t, d('2026-04-20'))).toBe(true)
    expect(isTransactionOnDate(t, d('2026-04-19'))).toBe(false)
    expect(isTransactionOnDate(t, d('2026-05-20'))).toBe(false)
  })

  it('honors end_date: nothing fires past the end', () => {
    const t = tx({
      start_date: '2026-01-01',
      end_date: '2026-03-01',
      frequency_value: 1,
      frequency_unit: 'months',
    })
    expect(isTransactionOnDate(t, d('2026-02-01'))).toBe(true)
    expect(isTransactionOnDate(t, d('2026-03-01'))).toBe(true)
    expect(isTransactionOnDate(t, d('2026-04-01'))).toBe(false)
  })

  it('skips inside a pause window', () => {
    const t = tx({
      start_date: '2026-01-01',
      pause_start_date: '2026-03-01',
      pause_end_date: '2026-05-01',
      frequency_value: 1,
      frequency_unit: 'months',
    })
    expect(isTransactionOnDate(t, d('2026-02-01'))).toBe(true)
    expect(isTransactionOnDate(t, d('2026-03-01'))).toBe(false)
    expect(isTransactionOnDate(t, d('2026-04-01'))).toBe(false)
    expect(isTransactionOnDate(t, d('2026-05-01'))).toBe(false)
    expect(isTransactionOnDate(t, d('2026-06-01'))).toBe(true)
  })

  it('respects is_active = false', () => {
    const t = tx({
      is_active: 0,
      start_date: '2026-01-01',
      frequency_value: 1,
      frequency_unit: 'months',
    })
    expect(isTransactionOnDate(t, d('2026-01-01'))).toBe(false)
  })
})

describe('isTransactionOnDate — custom patterns', () => {
  it('day-of-month list: "1st and 15th"', () => {
    const t = tx({
      start_date: '2026-01-01',
      frequency_value: 1,
      frequency_unit: 'custom',
      custom_frequency_pattern: 'days:1,15',
    })
    expect(isTransactionOnDate(t, d('2026-01-01'))).toBe(true)
    expect(isTransactionOnDate(t, d('2026-01-15'))).toBe(true)
    expect(isTransactionOnDate(t, d('2026-02-01'))).toBe(true)
    expect(isTransactionOnDate(t, d('2026-02-15'))).toBe(true)
    expect(isTransactionOnDate(t, d('2026-02-14'))).toBe(false)
  })

  it('day-of-week list (all ≤ 6): weekdays', () => {
    // Mon..Fri → 1,2,3,4,5
    const t = tx({
      start_date: '2026-03-02', // Monday
      frequency_value: 1,
      frequency_unit: 'custom',
      custom_frequency_pattern: 'days:1,2,3,4,5',
    })
    expect(isTransactionOnDate(t, d('2026-03-02'))).toBe(true) // Mon
    expect(isTransactionOnDate(t, d('2026-03-06'))).toBe(true) // Fri
    expect(isTransactionOnDate(t, d('2026-03-07'))).toBe(false) // Sat
    expect(isTransactionOnDate(t, d('2026-03-08'))).toBe(false) // Sun
  })

  it('day 31 in day-of-month list means "last day of month"', () => {
    const t = tx({
      start_date: '2026-01-01',
      frequency_value: 1,
      frequency_unit: 'custom',
      custom_frequency_pattern: 'days:31',
    })
    expect(isTransactionOnDate(t, d('2026-01-31'))).toBe(true)
    expect(isTransactionOnDate(t, d('2026-02-28'))).toBe(true) // last day of Feb 2026
    expect(isTransactionOnDate(t, d('2026-04-30'))).toBe(true) // last day of Apr
  })

  it('accepts nested `frequency` object shape (client-side format)', () => {
    const t = {
      startDate: '2026-01-15',
      frequency: { value: 1, unit: 'months' },
      isActive: true,
    } as any
    expect(isTransactionOnDate(t, d('2026-02-15'))).toBe(true)
    expect(isTransactionOnDate(t, d('2026-02-14'))).toBe(false)
  })
})
