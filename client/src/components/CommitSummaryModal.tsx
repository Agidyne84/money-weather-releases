import React from 'react'
import { formatDateForDisplay } from '../utils/dateUtils'

interface CommitRow {
  date: string
  description: string
  amount: number
  budgetItemName: string
  occurrenceDate: string
}

interface CommitSummaryModalProps {
  toCommit: CommitRow[]
  excludedCount: number
  skippedCount: number
  onConfirm: () => void
  onCancel: () => void
}

const CommitSummaryModal: React.FC<CommitSummaryModalProps> = ({
  toCommit,
  excludedCount,
  skippedCount,
  onConfirm,
  onCancel,
}) => {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col">
        <h3 className="text-lg font-semibold text-gray-900 mb-1">Confirm Import</h3>
        <p className="text-sm text-gray-500 mb-4">
          Review the transactions below before finalising the import.
        </p>

        {/* Summary counters */}
        <div className="flex gap-4 mb-4">
          <div className="flex-1 bg-green-50 border border-green-200 rounded p-3 text-center">
            <div className="text-2xl font-bold text-green-700">{toCommit.length}</div>
            <div className="text-xs text-green-600">to import</div>
          </div>
          <div className="flex-1 bg-gray-50 border border-gray-200 rounded p-3 text-center">
            <div className="text-2xl font-bold text-gray-500">{excludedCount}</div>
            <div className="text-xs text-gray-400">excluded</div>
          </div>
          <div className="flex-1 bg-yellow-50 border border-yellow-200 rounded p-3 text-center">
            <div className="text-2xl font-bold text-yellow-600">{skippedCount}</div>
            <div className="text-xs text-yellow-500">unassigned / skipped</div>
          </div>
        </div>

        {/* Row list */}
        {toCommit.length > 0 ? (
          <div className="overflow-y-auto flex-1 border border-gray-100 rounded">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Date</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Description</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Amount</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Budget Item</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Applies to</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {toCommit.map((row, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-3 py-2 whitespace-nowrap text-gray-600">{formatDateForDisplay(row.date)}</td>
                    <td className="px-3 py-2 text-gray-700 max-w-xs truncate">{row.description}</td>
                    <td className={`px-3 py-2 text-right font-mono ${row.amount < 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {row.amount < 0 ? '-' : '+'}${Math.abs(row.amount).toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-gray-700 font-medium">{row.budgetItemName}</td>
                    <td className="px-3 py-2 text-gray-500 text-xs">
                      {row.occurrenceDate ? formatDateForDisplay(row.occurrenceDate) : <span className="italic text-gray-400">unlinked</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
            No rows to import.
          </div>
        )}

        <div className="flex gap-3 mt-5 justify-end">
          <button
            type="button"
            className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm rounded hover:bg-gray-50"
            onClick={onCancel}
          >
            Go Back
          </button>
          <button
            type="button"
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
            onClick={onConfirm}
            disabled={toCommit.length === 0}
          >
            Confirm &amp; Import {toCommit.length > 0 ? `(${toCommit.length})` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}

export default CommitSummaryModal
