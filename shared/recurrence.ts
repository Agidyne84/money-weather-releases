/**
 * Shared recurrence engine — single source of truth for when a recurring
 * transaction fires on a given calendar date.
 *
 * Used by:
 *   - server/src/forecast.ts     (balance forecast + forecast transactions)
 *   - client/src/... (optional)  (any client-side preview of recurrences)
 *
 * Supports:
 *   - Simple units: days / weeks / months / years  (with frequency_value=N)
 *   - Custom patterns:
 *       days:X[,Y,...]                — day-of-week (values 0-6) OR day-of-month
 *                                       (values 1-31). Disambiguated by max value:
 *                                       if any value > 6 → day-of-month,
 *                                       else day-of-week.
 *       week:N,day:D                  — Nth occurrence of weekday D every N months
 *                                       (N controlled by frequency_value)
 *       months:M1,M2,...,day:D        — specific day in specific months every N years
 *                                       (N controlled by frequency_value)
 *       months:M1,...,week:N,day:D    — Nth weekday of specific months every N years
 *
 * Conventions:
 *   - Weekday indices: 0 = Sunday ... 6 = Saturday (JavaScript Date.getDay())
 *   - Month indices: 0 = January ... 11 = December (JavaScript Date.getMonth())
 *   - Day value 31 in day-of-month context means "last day of month"
 */

/** Accept snake_case (server/DB), flat camelCase, OR nested `frequency` object (client). */
export interface RecurrenceTransactionLike {
  start_date?: string | Date | null
  startDate?: string | Date | null
  end_date?: string | Date | null
  endDate?: string | Date | null
  pause_start_date?: string | Date | null
  pauseStartDate?: string | Date | null
  pause_end_date?: string | Date | null
  pauseEndDate?: string | Date | null
  frequency_value?: number | null
  frequencyValue?: number | null
  frequency_unit?: string | null
  frequencyUnit?: string | null
  custom_frequency_pattern?: string | null
  customFrequencyPattern?: string | null
  frequency?: {
    value?: number | null
    unit?: string | null
    customPattern?: string | null
  } | null
  is_active?: boolean | number | null
  isActive?: boolean | number | null
}

/** Parse YYYY-MM-DD (or Date) into a local-noon Date, avoiding UTC midnight drift. */
export function createSafeDate(input: string | Date | null | undefined): Date {
  if (input instanceof Date) return input
  if (!input) return new Date()
  const iso = String(input).split('T')[0]
  const parts = iso.split('-')
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10)
    const m = parseInt(parts[1], 10) - 1
    const d = parseInt(parts[2], 10)
    if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
      return new Date(y, m, d, 12, 0, 0)
    }
  }
  const fallback = new Date(String(input))
  return isNaN(fallback.getTime()) ? new Date() : fallback
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function daysBetween(a: Date, b: Date): number {
  const ad = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
  const bd = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
  return Math.round((bd - ad) / (24 * 60 * 60 * 1000))
}

function monthsBetween(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
}

function lastDayOfMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
}

/** 1-based occurrence of the weekday within the month for date d. */
function nthWeekdayOccurrence(d: Date): number {
  return Math.ceil(d.getDate() / 7)
}

function pick<T>(tx: any, snake: string, camel: string): T | undefined {
  const v = tx?.[snake]
  if (v !== undefined && v !== null) return v as T
  const w = tx?.[camel]
  if (w !== undefined && w !== null) return w as T
  return undefined
}

/**
 * Returns true iff the given transaction's recurrence rule fires on checkDate.
 */
export function isTransactionOnDate(
  tx: RecurrenceTransactionLike,
  checkDate: Date
): boolean {
  const startRaw = pick<string | Date>(tx, 'start_date', 'startDate')
  if (!startRaw) return false
  const startDate = createSafeDate(startRaw)
  const cd = createSafeDate(checkDate)

  // Disabled?
  const isActive = pick<boolean | number>(tx, 'is_active', 'isActive')
  if (isActive === false || isActive === 0) return false

  // Before start date → never
  if (cd < startDate && !sameDay(cd, startDate)) return false

  const endRaw = pick<string | Date>(tx, 'end_date', 'endDate')

  // Manual adjustment: start === end → one-shot, only on that date
  if (
    endRaw &&
    typeof endRaw === 'string' &&
    typeof startRaw === 'string' &&
    String(startRaw).split('T')[0] === String(endRaw).split('T')[0]
  ) {
    return sameDay(cd, startDate)
  }

  // Past end date → stop
  if (endRaw) {
    const endDate = createSafeDate(endRaw)
    if (cd > endDate && !sameDay(cd, endDate)) return false
  }

  // Inside pause window → skip
  const pauseStartRaw = pick<string | Date>(tx, 'pause_start_date', 'pauseStartDate')
  const pauseEndRaw = pick<string | Date>(tx, 'pause_end_date', 'pauseEndDate')
  if (pauseStartRaw && pauseEndRaw) {
    const ps = createSafeDate(pauseStartRaw)
    const pe = createSafeDate(pauseEndRaw)
    if ((cd > ps || sameDay(cd, ps)) && (cd < pe || sameDay(cd, pe))) {
      return false
    }
  }

  const nested = (tx as any)?.frequency
  const unitRaw =
    pick<string>(tx, 'frequency_unit', 'frequencyUnit') ??
    (nested && typeof nested === 'object' ? nested.unit : undefined)
  const valueRaw =
    pick<number>(tx, 'frequency_value', 'frequencyValue') ??
    (nested && typeof nested === 'object' ? nested.value : undefined)
  const customPatternRaw =
    pick<string>(tx, 'custom_frequency_pattern', 'customFrequencyPattern') ??
    (nested && typeof nested === 'object' ? nested.customPattern : undefined)

  const unit = String(unitRaw ?? '').toLowerCase()
  const value = Math.max(1, Number(valueRaw ?? 1) || 1)
  const customPattern = customPatternRaw || undefined

  if (unit === 'custom' && customPattern) {
    return matchCustomPattern(customPattern, startDate, cd, value)
  }

  if (unit === 'days') {
    const diff = daysBetween(startDate, cd)
    return diff >= 0 && diff % value === 0
  }

  if (unit === 'weeks') {
    if (cd.getDay() !== startDate.getDay()) return false
    const diff = daysBetween(startDate, cd)
    return diff >= 0 && diff % (value * 7) === 0
  }

  if (unit === 'months') {
    const sd = startDate.getDate()
    const cdDay = cd.getDate()
    const lastDay = lastDayOfMonth(cd)
    // Match same day OR (start exceeds this month's last day → clamp to last)
    const dayMatches = sd === cdDay || (sd > lastDay && cdDay === lastDay)
    if (!dayMatches) return false
    const diff = monthsBetween(startDate, cd)
    return diff >= 0 && diff % value === 0
  }

  if (unit === 'years') {
    if (cd.getMonth() !== startDate.getMonth()) return false
    const sd = startDate.getDate()
    const cdDay = cd.getDate()
    const lastDay = lastDayOfMonth(cd)
    const dayMatches = sd === cdDay || (sd > lastDay && cdDay === lastDay)
    if (!dayMatches) return false
    const diff = cd.getFullYear() - startDate.getFullYear()
    return diff >= 0 && diff % value === 0
  }

  return false
}

function matchCustomPattern(
  pattern: string,
  startDate: Date,
  checkDate: Date,
  freqValue: number
): boolean {
  // days:X[,Y,...]  (day-of-week if all ≤ 6, else day-of-month)
  const daysMatch = /^days:([\d,]+)$/.exec(pattern)
  if (daysMatch) {
    const nums = daysMatch[1]
      .split(',')
      .map(n => parseInt(n, 10))
      .filter(n => !isNaN(n))
    if (nums.length === 0) return false
    const maxN = Math.max(...nums)
    if (maxN > 6) {
      // Day-of-month
      const cdDay = checkDate.getDate()
      const lastDay = lastDayOfMonth(checkDate)
      return nums.some(d => d === cdDay || (d >= 31 && cdDay === lastDay))
    } else {
      // Day-of-week
      return nums.includes(checkDate.getDay())
    }
  }

  // week:N,day:D — Nth weekday of every N months
  const wdMatch = /^week:(\d+),day:(\d+)$/.exec(pattern)
  if (wdMatch) {
    const weekNum = parseInt(wdMatch[1], 10)
    const dayOfWeek = parseInt(wdMatch[2], 10)
    if (checkDate.getDay() !== dayOfWeek) return false
    if (nthWeekdayOccurrence(checkDate) !== weekNum) return false
    const diff = monthsBetween(startDate, checkDate)
    return diff >= 0 && diff % freqValue === 0
  }

  // months:M1,M2,...,day:D — specific day in specific months every N years
  const monthsDayMatch = /^months:([\d,]+),day:(\d+)$/.exec(pattern)
  if (monthsDayMatch) {
    const months = monthsDayMatch[1]
      .split(',')
      .map(n => parseInt(n, 10))
      .filter(n => !isNaN(n))
    const day = parseInt(monthsDayMatch[2], 10)
    if (!months.includes(checkDate.getMonth())) return false
    const cdDay = checkDate.getDate()
    const lastDay = lastDayOfMonth(checkDate)
    const dayMatches =
      cdDay === day || (day >= 31 && cdDay === lastDay) || (day > lastDay && cdDay === lastDay)
    if (!dayMatches) return false
    const diff = checkDate.getFullYear() - startDate.getFullYear()
    return diff >= 0 && diff % freqValue === 0
  }

  // months:M1,...,week:N,day:D — Nth weekday of specific months every N years
  const monthsWeekMatch = /^months:([\d,]+),week:(\d+),day:(\d+)$/.exec(pattern)
  if (monthsWeekMatch) {
    const months = monthsWeekMatch[1]
      .split(',')
      .map(n => parseInt(n, 10))
      .filter(n => !isNaN(n))
    const weekNum = parseInt(monthsWeekMatch[2], 10)
    const dayOfWeek = parseInt(monthsWeekMatch[3], 10)
    if (!months.includes(checkDate.getMonth())) return false
    if (checkDate.getDay() !== dayOfWeek) return false
    if (nthWeekdayOccurrence(checkDate) !== weekNum) return false
    const diff = checkDate.getFullYear() - startDate.getFullYear()
    return diff >= 0 && diff % freqValue === 0
  }

  return false
}
