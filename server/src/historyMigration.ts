/**
 * Bi-directional history migration on transaction.start_date changes.
 *
 *  Advancing (newStart > oldStart):
 *    For each date in [oldStart, newStart) where the OLD recurrence rule
 *    fires, insert a `historical_transactions` row if one doesn't already
 *    exist for (transaction_id, date). Existing rows — whether previously
 *    auto-archived OR manually edited (is_manual_edit = 1) — are preserved.
 *
 *  Rewinding (newStart < oldStart):
 *    Delete auto-archived rows in [newStart, oldStart) so the forecast
 *    re-emits them. Rows with is_manual_edit = 1 are preserved.
 *
 * Extracted out of the PUT /api/transactions/:id handler so it can be
 * unit-tested against an in-memory SQLite database.
 */

import { isTransactionOnDate } from '../../shared/recurrence'

export interface MigrationDb {
  get(sql: string, params?: any[]): Promise<any>
  run(sql: string, params?: any[]): Promise<any>
}

/** Minimal transaction row shape needed by the migration. */
export interface TransactionSnapshot {
  id: string
  account_id: string
  category_id: string
  name: string
  amount: number
  type: 'income' | 'expense'
  start_date: string
  end_date?: string | null
  pause_start_date?: string | null
  pause_end_date?: string | null
  frequency_value: number
  frequency_unit: string
  custom_frequency_pattern?: string | null
  is_active?: number | boolean | null
}

/** Parse YYYY-MM-DD into a local-noon Date (avoids UTC midnight drift). */
function parseLocalNoon(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0)
}

function formatYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export interface MigrationResult {
  direction: 'noop' | 'advance' | 'rewind'
  inserted: number
  deleted: number
}

export async function migrateHistoryOnStartDateChange(
  db: MigrationDb,
  existing: TransactionSnapshot,
  oldStart: string,
  newStart: string
): Promise<MigrationResult> {
  if (!oldStart || !newStart || oldStart === newStart) {
    return { direction: 'noop', inserted: 0, deleted: 0 }
  }

  const oldDate = parseLocalNoon(oldStart)
  const newDate = parseLocalNoon(newStart)

  if (newDate.getTime() > oldDate.getTime()) {
    // Advance: walk [oldStart, newStart) and archive fires of the OLD rule.
    // If a history row already exists for (transaction_id, date) — whether
    // auto-archived earlier or manually edited — leave it alone.
    const iter = new Date(oldDate)
    let seq = 0
    while (iter.getTime() < newDate.getTime()) {
      if (isTransactionOnDate(existing as any, iter)) {
        const dateStr = formatYmd(iter)
        const existingHist = await db.get(
          `SELECT id FROM historical_transactions
           WHERE transaction_id = ? AND date = ?
           LIMIT 1`,
          [existing.id, dateStr]
        )
        if (!existingHist) {
          const histId = `hist_${Date.now()}_${seq}_${Math.random().toString(36).substr(2, 6)}`
          await db.run(
            `INSERT INTO historical_transactions (
               id, transaction_id, account_id, category_id, date,
               description, amount, type, is_manual_edit
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
            [
              histId, existing.id, existing.account_id, existing.category_id,
              dateStr, existing.name, existing.amount, existing.type,
            ]
          )
          seq++
        }
      }
      iter.setDate(iter.getDate() + 1)
    }
    return { direction: 'advance', inserted: seq, deleted: 0 }
  }

  // Rewind: drop only auto-archived rows, keep manual edits.
  const result = await db.run(
    `DELETE FROM historical_transactions
     WHERE transaction_id = ? AND date >= ? AND date < ?
       AND is_manual_edit = 0`,
    [existing.id, newStart, oldStart]
  )
  return { direction: 'rewind', inserted: 0, deleted: result?.changes ?? 0 }
}
