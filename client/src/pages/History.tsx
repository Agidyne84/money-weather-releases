import React, { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Account, Category, ForecastTransaction } from '../types'
import { accountsApi, categoriesApi, historyApi, transactionsApi, forecastApi, HistoryRow } from '../services/database'
import { formatDateForDisplay, formatDateForInput, formatDateForStorage } from '../utils/dateUtils'
import CategorySelector from '../components/CategorySelector'
import BankImportCard from '../components/BankImportCard'

interface EditBuffer {
  description: string
  amount: string
  date: string
  accountId: string
  categoryId: string
  type: 'income' | 'expense' | 'administrative' | ''
  isTransfer: boolean
  transferToAccountId: string
}

const emptyBuffer = (row?: HistoryRow): EditBuffer => ({
  description: row?.description ?? '',
  amount: row ? String(Math.abs(row.amount)) : '',
  date: row ? formatDateForInput(row.date) : formatDateForInput(new Date()),
  accountId: row?.accountId ?? '',
  categoryId: row?.categoryId ?? '',
  type: row?.type ?? '',
  isTransfer: row?.isTransfer ?? false,
  transferToAccountId: row?.transferToAccountId ?? '',
})

const History: React.FC = () => {
  const location = useLocation()
  const initState = (location.state as { categoryId?: string; startDate?: string; endDate?: string } | null) ?? {}

  const [rows, setRows] = useState<HistoryRow[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [filterStart, setFilterStart] = useState<string>(initState.startDate ?? '')
  const [filterEnd, setFilterEnd] = useState<string>(initState.endDate ?? '')
  const [filterAccount, setFilterAccount] = useState<string>('')
  const [filterCategory, setFilterCategory] = useState<string>(initState.categoryId ?? '')

  // Client-side filters (applied on top of server results)
  const [filterType, setFilterType] = useState<string>('')
  const [filterMinAmt, setFilterMinAmt] = useState<string>('')
  const [filterMaxAmt, setFilterMaxAmt] = useState<string>('')
  const [filterDescription, setFilterDescription] = useState<string>('')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [buffer, setBuffer] = useState<EditBuffer>(emptyBuffer())
  const [adding, setAdding] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Selection state for Return Selected functionality
  const [selectedRows, setSelectedRows] = useState<string[]>([])

  const [originalTransactions, setOriginalTransactions] = useState<any[]>([])
  const [forecastTransactions, setForecastTransactions] = useState<ForecastTransaction[]>([])
  const [fullHistoryData, setFullHistoryData] = useState<any[]>([])

  const loadAll = async (overrides?: { start?: string; end?: string; account?: string; category?: string }) => {
    const start = overrides && 'start' in overrides ? overrides.start : filterStart
    const end = overrides && 'end' in overrides ? overrides.end : filterEnd
    const account = overrides && 'account' in overrides ? overrides.account : filterAccount
    const category = overrides && 'category' in overrides ? overrides.category : filterCategory
    setLoading(true)
    setError(null)
    try {
      const [hist, accs, cats, txs, ftxs, fullHist] = await Promise.all([
        historyApi.getAll({
          startDate: start || undefined,
          endDate: end || undefined,
          accountId: account || undefined,
          categoryId: category || undefined,
          limit: 1000,
          includeUnposted: false,
        }),
        accountsApi.getAll(),
        categoriesApi.getAll(),
        transactionsApi.getAll(1000, 0),
        forecastApi.getForecastTransactions(),
        historyApi.getAll({
          limit: 1000,
          includeUnposted: true,
          includeSuppressed: true,
          includeExcluded: true,
        }),
      ])
      // Defensive filter: ensure unposted rows never appear on History
      const postedOnly = hist.filter(h => h.isPosted !== false)
      setRows(postedOnly)
      setAccounts(accs)
      setCategories(cats)
      setOriginalTransactions(txs)
      // Parse date strings from server into Date objects
      setForecastTransactions(ftxs.map((ftx: any) => ({
        ...ftx,
        date: new Date(ftx.date),
      })))
      setFullHistoryData(fullHist)
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load history')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const applyFilters = () => loadAll()

  const clearFilters = () => {
    setFilterStart('')
    setFilterEnd('')
    setFilterAccount('')
    setFilterCategory('')
    setFilterType('')
    setFilterMinAmt('')
    setFilterMaxAmt('')
    setFilterDescription('')
    loadAll({ start: '', end: '', account: '', category: '' })
  }

  // Client-side filtering applied on top of server results
  const filteredRows = rows.filter(row => {
    if (filterType && row.type !== filterType) return false
    const absAmt = Math.abs(row.amount)
    if (filterMinAmt !== '' && !isNaN(Number(filterMinAmt)) && absAmt < Number(filterMinAmt)) return false
    if (filterMaxAmt !== '' && !isNaN(Number(filterMaxAmt)) && absAmt > Number(filterMaxAmt)) return false
    if (filterDescription && !row.description.toLowerCase().includes(filterDescription.toLowerCase())) return false
    return true
  })

  const startEdit = (row: HistoryRow) => {
    setAdding(false)
    setExpandedId(null)
    setEditingId(row.id)
    setBuffer(emptyBuffer(row))
  }

  const toggleAdd = () => {
    if (adding) {
      setAdding(false)
      setBuffer(emptyBuffer())
    } else {
      setEditingId(null)
      setAdding(true)
      setBuffer(emptyBuffer())
    }
  }

  const cancel = () => {
    setEditingId(null)
    setAdding(false)
    setBuffer(emptyBuffer())
  }

  const save = async () => {
    if (!buffer.description.trim()) {
      alert('Description is required')
      return
    }
    const amt = Number(buffer.amount)
    if (Number.isNaN(amt) || amt === 0) {
      alert('Amount must be a non-zero number')
      return
    }
    if (!buffer.accountId || !buffer.categoryId || !buffer.type) {
      alert('Please fill in all required fields')
      return
    }
    const signed = buffer.type === 'expense' ? -Math.abs(amt) :
                   buffer.type === 'administrative' ? amt :
                   Math.abs(amt)
    try {
      if (adding) {
        await historyApi.create({
          accountId: buffer.accountId,
          categoryId: buffer.categoryId,
          date: buffer.date,
          description: buffer.description.trim(),
          amount: signed,
          type: buffer.type as 'income' | 'expense' | 'administrative',
          isTransfer: buffer.isTransfer,
          transferToAccountId: buffer.isTransfer ? buffer.transferToAccountId : undefined,
        })
      } else if (editingId) {
        await historyApi.update(editingId, {
          accountId: buffer.accountId,
          categoryId: buffer.categoryId,
          date: buffer.date,
          description: buffer.description.trim(),
          amount: signed,
          type: buffer.type as 'income' | 'expense' | 'administrative',
          isTransfer: buffer.isTransfer,
          transferToAccountId: buffer.isTransfer ? buffer.transferToAccountId : undefined,
        })
      }
      cancel()
      await loadAll()
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message || 'Failed to save history row')
    }
  }

  const remove = async (row: HistoryRow) => {
    const ok = window.confirm(`Delete history entry "${row.description}" on ${formatDateForDisplay(row.date)}?`)
    if (!ok) return
    try {
      await historyApi.delete(row.id)
      await loadAll()
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message || 'Failed to delete history row')
    }
  }

  const resetRow = async (row: HistoryRow) => {
    if (!row.transactionId) {
      alert('Cannot reset: this is a standalone history entry with no source transaction.')
      return
    }
    const baseTx = originalTransactions.find((tx: any) => tx.id === row.transactionId)
    if (!baseTx) {
      alert('Could not find the source transaction to reset values.')
      return
    }
    const ok = window.confirm(`Reset "${row.description}" back to the original (Budgeted) transaction values?`)
    if (!ok) return
    try {
      await historyApi.update(row.id, {
        description: baseTx.name,
        amount: baseTx.amount,
        type: baseTx.type,
        accountId: baseTx.accountId,
        categoryId: baseTx.categoryId,
        isManualEdit: false,
      })
      await loadAll()
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message || 'Failed to reset history row')
    }
  }

  // Selection helpers
  const toggleRowSelection = (rowId: string) => {
    setSelectedRows(prev =>
      prev.includes(rowId)
        ? prev.filter(id => id !== rowId)
        : [...prev, rowId]
    )
  }

  const selectAllRows = () => {
    setSelectedRows(filteredRows.map(r => r.id))
  }

  const clearSelection = () => {
    setSelectedRows([])
  }

  // Return Selected: move history rows back to forecast by deleting them from history
  const returnSelectedRows = async () => {
    const selectedCount = selectedRows.length
    if (selectedCount === 0) return

    const selectedData = rows.filter(r => selectedRows.includes(r.id))
    const suppressedCount = selectedData.filter(r => r.isSuppressed).length

    let warningMsg = ''
    if (suppressedCount > 0) {
      warningMsg = `\n\nWarning: ${suppressedCount} of these are deleted forecast occurrences. ` +
        `Returning them will make them reappear in the forecast. If their date is before the Forecast start date, they will disappear.`
    }

    const ok = window.confirm(
      `Return ${selectedCount} row${selectedCount === 1 ? '' : 's'} to the Forecast?\n\n` +
      `These rows will be removed from History and will reappear in the Forecast.` +
      warningMsg
    )
    if (!ok) return

    try {
      for (const rowId of selectedRows) {
        const row = rows.find(r => r.id === rowId)
        if (row && !row.transactionId) {
          // Manual transaction: flip to unposted so it reappears in Forecast
          await historyApi.update(rowId, { isPosted: false })
        } else if (row?.isManualEdit) {
          // Recurring occurrence with manual edits — unpost instead of deleting
          // so the override values survive the round-trip back to Forecast.
          await historyApi.update(rowId, { isPosted: false })
        } else {
          // Recurring occurrence without edits — delete the history row
          await historyApi.delete(rowId)
        }
      }
      setSelectedRows([])
      await loadAll()
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message || 'Failed to return rows to forecast')
    }
  }

  const accountName = (id: string) => accounts.find(a => a.id === id)?.name ?? '—'
  const categoryName = (id: string) => categories.find(c => c.id === id)?.name ?? '—'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">History</h1>
        <p className="text-sm text-gray-500">Posted &amp; archived transactions. Return Selected moves rows back to Forecast.</p>
      </div>

      {/* Import Bank Data */}
      <BankImportCard
        accounts={accounts}
        budgetTransactions={originalTransactions}
        forecastTransactions={forecastTransactions}
        historyData={fullHistoryData}
        onImportComplete={() => loadAll()}
        onHistoryChange={() => loadAll()}
        categories={categories}
      />

      {/* Filter bar */}
      <div className="card p-4 space-y-3">
        {/* Row 1: server-side filters + Apply/Clear */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs text-gray-600 mb-1">From</label>
            <input type="date" className="input w-full" value={filterStart} onChange={e => setFilterStart(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">To</label>
            <input type="date" className="input w-full" value={filterEnd} onChange={e => setFilterEnd(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Account</label>
            <select className="input w-full" value={filterAccount} onChange={e => setFilterAccount(e.target.value)}>
              <option value="">All</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Category</label>
            <select className="input w-full" value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
              <option value="">All</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="flex items-end gap-2">
            <button onClick={applyFilters} className="btn-primary text-xs flex-1">Apply</button>
            <button onClick={clearFilters} className="btn-secondary text-xs flex-1">Clear</button>
          </div>
        </div>
        {/* Row 2: client-side filters (instant, no Apply needed) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-gray-100">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Description</label>
            <input
              type="text"
              className="input w-full"
              placeholder="Search…"
              value={filterDescription}
              onChange={e => setFilterDescription(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Type</label>
            <select className="input w-full" value={filterType} onChange={e => setFilterType(e.target.value)}>
              <option value="">All</option>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
              <option value="administrative">Administrative</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Min Amount ($)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              className="input w-full"
              placeholder="0.00"
              value={filterMinAmt}
              onChange={e => setFilterMinAmt(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Max Amount ($)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              className="input w-full"
              placeholder="Any"
              value={filterMaxAmt}
              onChange={e => setFilterMaxAmt(e.target.value)}
            />
          </div>
        </div>
        {/* Row count */}
        <p className="text-xs text-gray-500 pt-1">
          Showing <span className="font-semibold text-gray-700">{filteredRows.length}</span> of <span className="font-semibold text-gray-700">{rows.length}</span> rows
        </p>
      </div>

      {/* Table */}
      <div className="card">
        <div className="flex flex-wrap gap-3 justify-between items-center mb-4 p-4 pb-0">
          <div>
            <h3 className="text-xl font-bold text-gray-900">History Transactions</h3>
            <p className="text-gray-600">Posted &amp; archived transactions</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={returnSelectedRows}
              disabled={selectedRows.length === 0}
              className="btn-primary text-sm min-w-[11rem] whitespace-nowrap disabled:opacity-50"
            >
              Return Selected ({selectedRows.length})
            </button>
            <button onClick={toggleAdd} className="btn-secondary text-sm">
              {adding ? 'Cancel' : '+ Add Manual'}
            </button>
          </div>
        </div>

        {adding && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 p-4 bg-gray-50 rounded-lg mb-4">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Date <span className="text-red-500">*</span></label>
              <input
                type="date"
                className="input w-full"
                value={buffer.date}
                onChange={e => setBuffer({ ...buffer, date: e.target.value || formatDateForStorage(new Date()) })}
              />
            </div>
            <div className="lg:col-span-2">
              <label className="block text-xs text-gray-600 mb-1">Description <span className="text-red-500">*</span></label>
              <input
                type="text"
                className="input w-full"
                value={buffer.description}
                onChange={e => setBuffer({ ...buffer, description: e.target.value })}
                placeholder="e.g., Grocery shopping"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Amount <span className="text-red-500">*</span></label>
              <input
                type="number"
                step="0.01"
                className="input w-full"
                value={buffer.amount}
                onChange={e => setBuffer({ ...buffer, amount: e.target.value })}
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Type</label>
              <select
                className="input w-full"
                value={buffer.type}
                onChange={e => setBuffer({ ...buffer, type: e.target.value as 'income' | 'expense' | 'administrative' | '' })}
              >
                <option value="">-- Select --</option>
                <option value="income">Income</option>
                <option value="expense">Expense</option>
                <option value="administrative">Administrative</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Account <span className="text-red-500">*</span></label>
              <select
                className="input w-full"
                value={buffer.accountId}
                onChange={e => setBuffer({ ...buffer, accountId: e.target.value })}
              >
                <option value="">— select —</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Category <span className="text-red-500">*</span></label>
              <CategorySelector
                categories={categories}
                selectedCategoryId={buffer.categoryId}
                onChange={(id: string) => setBuffer({ ...buffer, categoryId: id })}
                onCategoryAdded={(cat: Category) => {
                  setCategories(prev => [...prev, cat])
                  setBuffer(prev => ({ ...prev, categoryId: cat.id }))
                }}
                className="input w-full"
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-6 flex gap-2 justify-end">
              <button onClick={cancel} className="btn-secondary text-sm">Cancel</button>
              <button
                onClick={save}
                disabled={!buffer.description.trim() || !buffer.amount || Number(buffer.amount) === 0 || !buffer.accountId || !buffer.categoryId || !buffer.type}
                className="btn-primary text-sm disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="p-6 text-gray-500">Loading history…</div>
        ) : error ? (
          <div className="p-6 text-red-600">{error}</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-gray-500">
            No history entries yet. History shows transactions before the Forecast start date,
            accepted forecast occurrences, deleted forecast rows, and manual entries.
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="p-6 text-gray-500">
            No rows match the current filters. Try adjusting or clearing the filter criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse table-fixed" style={{ minWidth: '640px' }}>
              <colgroup>
                <col style={{ width: '4%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '50%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '26%' }} />
              </colgroup>
              <thead>
                <tr className="border-b-2 border-gray-200 bg-gray-50">
                  <th className="text-left py-3 px-3 text-sm font-medium text-gray-700">
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={filteredRows.length > 0 && filteredRows.every(r => selectedRows.includes(r.id))}
                      onChange={() => filteredRows.every(r => selectedRows.includes(r.id)) ? clearSelection() : selectAllRows()}
                    />
                  </th>
                  <th className="text-left py-3 px-3 text-sm font-medium text-gray-700">Date</th>
                  <th className="text-left py-3 px-3 text-sm font-medium text-gray-700">Description</th>
                  <th className="text-right py-3 px-3 text-sm font-medium text-gray-700">Amount</th>
                  <th className="text-right py-3 px-3 text-sm font-medium text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(row => {
                  const isEditing = editingId === row.id
                  const isSelected = selectedRows.includes(row.id)
                  const isExpanded = expandedId === row.id
                  const rowClass = `border-b ${
                    isEditing ? 'bg-blue-50' :
                    isSelected ? 'bg-blue-50/50' :
                    'hover:bg-gray-50'
                  }${row.bankDescription && !isEditing ? ' cursor-pointer' : ''}`
                  return (
                    <React.Fragment key={row.id}>
                      <tr
                        className={rowClass}
                        onClick={() => {
                          if (row.bankDescription && !isEditing) {
                            setExpandedId(prev => prev === row.id ? null : row.id)
                          }
                        }}
                      >
                        <td className="py-2 px-3 align-top" onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="rounded"
                            checked={isSelected}
                            onChange={() => toggleRowSelection(row.id)}
                          />
                        </td>
                        <td className="py-2 px-3 align-top">
                          {isEditing ? (
                            <input
                              type="date"
                              className="input-field text-sm w-full"
                              value={buffer.date}
                              onChange={e => setBuffer({ ...buffer, date: e.target.value })}
                            />
                          ) : (
                            <span className="text-sm text-gray-900 whitespace-nowrap">
                              {formatDateForDisplay(row.date)}
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 align-top">
                          {isEditing ? (
                            <input
                              type="text"
                              className="input-field text-sm w-full"
                              value={buffer.description}
                              onChange={e => setBuffer({ ...buffer, description: e.target.value })}
                            />
                          ) : (
                            <div className="flex items-center space-x-2 min-w-0">
                              {row.categoryColor && (
                                <div
                                  className="w-3 h-3 rounded-full flex-shrink-0"
                                  style={{ backgroundColor: row.categoryColor }}
                                />
                              )}
                              <div className="min-w-0">
                                <p className="font-medium text-gray-900 text-sm truncate">
                                  {row.description}
                                </p>
                                {isExpanded && row.bankDescription && (
                                  <p className="text-xs text-blue-700 font-mono mt-0.5 truncate" title={row.bankDescription}>
                                    {row.bankDescription}
                                  </p>
                                )}
                                <p className="text-xs text-gray-500 truncate">
                                  {row.type === 'income' ? 'Income' : row.type === 'expense' ? 'Expense' : 'Administrative'}
                                  {' · '}
                                  {row.accountName || accountName(row.accountId)}
                                  {row.isTransfer && row.transferToAccountId && (
                                    <span className="text-blue-500"> → {accountName(row.transferToAccountId)}</span>
                                  )}
                                  {' · '}
                                  {row.categoryName || categoryName(row.categoryId)}
                                  {' · '}
                                  <span className="text-gray-400">
                                    {row.sourceTransactionName || (row.transactionId ? '(deleted)' : 'Manual')}
                                  </span>
                                  {row.isSuppressed && (
                                    <span
                                      title="Deleted from Forecast"
                                      className="ml-1 inline-flex items-center text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-100 text-red-700 border border-red-200"
                                    >
                                      Deleted
                                    </span>
                                  )}
                                  {row.bankDescription ? (
                                    <span
                                      title="Imported from bank statement"
                                      className="ml-1 inline-flex items-center text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 border border-blue-200"
                                    >
                                      Bank
                                    </span>
                                  ) : row.isManualEdit && (
                                    <span
                                      title="Manually edited"
                                      className="ml-1 inline-flex items-center text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200"
                                    >
                                      Edited
                                    </span>
                                  )}
                                </p>
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-3 align-top text-right">
                          {isEditing ? (
                            <input
                              type="number"
                              step="0.01"
                              className="input-field text-sm w-full text-right"
                              value={buffer.amount}
                              onChange={e => setBuffer({ ...buffer, amount: e.target.value })}
                            />
                          ) : (
                            <span className={`text-sm font-medium ${
                              row.amount >= 0 ? 'text-green-600' : row.amount < 0 ? 'text-red-600' : 'text-gray-600'
                            }`}>
                              {row.amount >= 0 ? '+' : '-'}${Math.abs(row.amount).toFixed(2)}
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 align-top text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                          {isEditing ? (
                            <div className="flex gap-2 justify-end">
                              <button
                                onClick={() => remove(row)}
                                className="text-sm px-3 py-1.5 rounded border border-red-200 text-red-600 hover:bg-red-50"
                              >
                                Delete
                              </button>
                              <button
                                onClick={cancel}
                                className="btn-secondary text-sm"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={save}
                                disabled={!buffer.description.trim() || !buffer.amount || Number(buffer.amount) === 0 || !buffer.accountId || !buffer.categoryId || !buffer.type}
                                className="btn-primary text-sm disabled:opacity-50"
                              >
                                Save
                              </button>
                            </div>
                          ) : (
                            <>
                              <button onClick={() => startEdit(row)} className="btn-secondary text-xs mr-1">Edit</button>
                              {row.isManualEdit && row.transactionId && !row.bankDescription && (
                                <button
                                  onClick={() => resetRow(row)}
                                  className="text-xs px-2 py-1 rounded border border-amber-200 text-amber-700 hover:bg-amber-50 mr-1"
                                >
                                  Reset
                                </button>
                              )}
                              <button
                                onClick={() => remove(row)}
                                className="text-xs px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50"
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </td>
                      </tr>

                      {isEditing && (
                        <tr className="bg-blue-50 border-b">
                          <td colSpan={5} className="py-3 px-4">
                            <div className="flex flex-wrap items-end gap-3">
                              <div className="flex flex-col min-w-[160px]">
                                <label className="text-xs text-gray-600 mb-1">Account</label>
                                <select
                                  className="input-field text-sm"
                                  value={buffer.accountId}
                                  onChange={e => setBuffer({ ...buffer, accountId: e.target.value })}
                                >
                                  <option value="">Select Account</option>
                                  {accounts.map(a => (
                                    <option key={a.id} value={a.id}>{a.name}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="flex items-center">
                                <label className="flex items-center space-x-2 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    className="form-checkbox h-4 w-4 text-blue-600"
                                    checked={buffer.isTransfer}
                                    onChange={(e) => setBuffer({ ...buffer, isTransfer: e.target.checked, transferToAccountId: e.target.checked ? buffer.transferToAccountId : '' })}
                                  />
                                  <span className="text-sm font-medium text-gray-700">Transfer</span>
                                </label>
                              </div>
                              {buffer.isTransfer && (
                                <div className="flex flex-col min-w-[160px]">
                                  <label className="text-xs text-gray-600 mb-1">Transfer To Account</label>
                                  <select
                                    className="input-field text-sm"
                                    value={buffer.transferToAccountId}
                                    onChange={e => setBuffer({ ...buffer, transferToAccountId: e.target.value })}
                                  >
                                    <option value="">Select destination account</option>
                                    {accounts
                                      .filter(a => a.id !== buffer.accountId)
                                      .map(a => (
                                        <option key={a.id} value={a.id}>{a.name}</option>
                                      ))}
                                  </select>
                                </div>
                              )}
                              <div className="flex flex-col min-w-[160px]">
                                <label className="text-xs text-gray-600 mb-1">Category</label>
                                <select
                                  className="input-field text-sm"
                                  value={buffer.categoryId}
                                  onChange={e => setBuffer({ ...buffer, categoryId: e.target.value })}
                                >
                                  <option value="">Select Category</option>
                                  {categories.map(c => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="flex flex-col min-w-[120px]">
                                <label className="text-xs text-gray-600 mb-1">Type</label>
                                <select
                                  className="input-field text-sm"
                                  value={buffer.type}
                                  onChange={(e) => setBuffer({ ...buffer, type: e.target.value as 'income' | 'expense' | 'administrative' | '' })}
                                >
                                  <option value="">-- Select --</option>
                                  <option value="income">Income</option>
                                  <option value="expense">Expense</option>
                                  <option value="administrative">Administrative</option>
                                </select>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default History
