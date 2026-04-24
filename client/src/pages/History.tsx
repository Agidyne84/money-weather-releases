import React, { useEffect, useState } from 'react'
import { Account, Category } from '../types'
import { accountsApi, categoriesApi, historyApi, transactionsApi, HistoryRow } from '../services/api'
import { formatDateForDisplay, formatDateForInput, formatDateForStorage } from '../utils/dateUtils'
import CategorySelector from '../components/CategorySelector'

interface EditBuffer {
  description: string
  amount: string
  date: string
  accountId: string
  categoryId: string
  type: 'income' | 'expense' | 'administrative'
}

const emptyBuffer = (row?: HistoryRow): EditBuffer => ({
  description: row?.description ?? '',
  amount: row ? String(Math.abs(row.amount)) : '',
  date: row ? formatDateForInput(row.date) : formatDateForInput(new Date()),
  accountId: row?.accountId ?? '',
  categoryId: row?.categoryId ?? '',
  type: row?.type ?? 'expense',
})

const History: React.FC = () => {
  const [rows, setRows] = useState<HistoryRow[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [filterStart, setFilterStart] = useState<string>('')
  const [filterEnd, setFilterEnd] = useState<string>('')
  const [filterAccount, setFilterAccount] = useState<string>('')
  const [filterCategory, setFilterCategory] = useState<string>('')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [buffer, setBuffer] = useState<EditBuffer>(emptyBuffer())
  const [adding, setAdding] = useState(false)

  // Selection state for Return Selected functionality
  const [selectedRows, setSelectedRows] = useState<string[]>([])

  const [originalTransactions, setOriginalTransactions] = useState<any[]>([])

  const loadAll = async () => {
    setLoading(true)
    setError(null)
    try {
      const [hist, accs, cats, txs] = await Promise.all([
        historyApi.getAll({
          startDate: filterStart || undefined,
          endDate: filterEnd || undefined,
          accountId: filterAccount || undefined,
          categoryId: filterCategory || undefined,
          limit: 1000,
        }),
        accountsApi.getAll(),
        categoriesApi.getAll(),
        transactionsApi.getAll(1000, 0),
      ])
      setRows(hist)
      setAccounts(accs)
      setCategories(cats)
      setOriginalTransactions(txs)
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
    // Load after state flush
    setTimeout(() => loadAll(), 0)
  }

  const startEdit = (row: HistoryRow) => {
    setAdding(false)
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
      const defaultAccount = accounts[0]?.id ?? ''
      const defaultCategory = categories[0]?.id ?? ''
      setBuffer({
        ...emptyBuffer(),
        accountId: defaultAccount,
        categoryId: defaultCategory,
      })
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
    if (!buffer.accountId || !buffer.categoryId) {
      alert('Account and category are required')
      return
    }
    const signed = buffer.type === 'expense' ? -Math.abs(amt) : Math.abs(amt)
    try {
      if (adding) {
        await historyApi.create({
          accountId: buffer.accountId,
          categoryId: buffer.categoryId,
          date: buffer.date,
          description: buffer.description.trim(),
          amount: signed,
          type: buffer.type,
        })
      } else if (editingId) {
        await historyApi.update(editingId, {
          accountId: buffer.accountId,
          categoryId: buffer.categoryId,
          date: buffer.date,
          description: buffer.description.trim(),
          amount: signed,
          type: buffer.type,
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
    const ok = window.confirm(`Reset "${row.description}" back to the original transaction values?`)
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
    setSelectedRows(rows.map(r => r.id))
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

      {/* Filter bar */}
      <div className="card p-4">
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
              <label className="block text-xs text-gray-600 mb-1">Date</label>
              <input
                type="date"
                className="input w-full"
                value={buffer.date}
                onChange={e => setBuffer({ ...buffer, date: e.target.value || formatDateForStorage(new Date()) })}
              />
            </div>
            <div className="lg:col-span-2">
              <label className="block text-xs text-gray-600 mb-1">Description</label>
              <input
                type="text"
                className="input w-full"
                value={buffer.description}
                onChange={e => setBuffer({ ...buffer, description: e.target.value })}
                placeholder="e.g., Grocery shopping"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Amount</label>
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
                onChange={e => setBuffer({ ...buffer, type: e.target.value as 'income' | 'expense' | 'administrative' })}
              >
                <option value="income">Income</option>
                <option value="expense">Expense</option>
                <option value="administrative">Administrative</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Account</label>
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
              <label className="block text-xs text-gray-600 mb-1">Category</label>
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
              <button onClick={save} className="btn-primary text-sm">Save</button>
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
            Use "Return Selected" to move rows back to Forecast.
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
                      checked={rows.length > 0 && selectedRows.length === rows.length}
                      onChange={() => selectedRows.length === rows.length ? clearSelection() : selectAllRows()}
                    />
                  </th>
                  <th className="text-left py-3 px-3 text-sm font-medium text-gray-700">Date</th>
                  <th className="text-left py-3 px-3 text-sm font-medium text-gray-700">Description</th>
                  <th className="text-right py-3 px-3 text-sm font-medium text-gray-700">Amount</th>
                  <th className="text-right py-3 px-3 text-sm font-medium text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => {
                  const isEditing = editingId === row.id
                  const isSelected = selectedRows.includes(row.id)
                  const rowClass = `border-b ${
                    isEditing ? 'bg-blue-50' :
                    isSelected ? 'bg-blue-50/50' :
                    'hover:bg-gray-50'
                  }`
                  return (
                    <React.Fragment key={row.id}>
                      <tr className={rowClass}>
                        <td className="py-2 px-3 align-top">
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
                                <p className="text-xs text-gray-500 truncate">
                                  {row.type === 'income' ? 'Income' : row.type === 'expense' ? 'Expense' : 'Administrative'}
                                  {' · '}
                                  {row.accountName || accountName(row.accountId)}
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
                                  {row.isManualEdit && (
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
                        <td className="py-2 px-3 align-top text-right whitespace-nowrap">
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
                                className="btn-primary text-sm"
                              >
                                Save
                              </button>
                            </div>
                          ) : (
                            <>
                              <button onClick={() => startEdit(row)} className="btn-secondary text-xs mr-1">Edit</button>
                              {row.isManualEdit && row.transactionId && (
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
                                  onChange={(e) => setBuffer({ ...buffer, type: e.target.value as 'income' | 'expense' | 'administrative' })}
                                >
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

interface EditFormProps {
  buffer: EditBuffer
  setBuffer: (b: EditBuffer) => void
  accounts: Account[]
  categories: Category[]
  setCategories: React.Dispatch<React.SetStateAction<Category[]>>
  onSave: () => void
  onCancel: () => void
}

const EditForm: React.FC<EditFormProps> = ({ buffer, setBuffer, accounts, categories, setCategories, onSave, onCancel }) => {
  const update = <K extends keyof EditBuffer>(k: K, v: EditBuffer[K]) => setBuffer({ ...buffer, [k]: v })
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2 items-end">
      <div>
        <label className="block text-xs text-gray-600 mb-1">Date</label>
        <input type="date" className="input w-full" value={buffer.date}
               onChange={e => update('date', e.target.value || formatDateForStorage(new Date()))} />
      </div>
      <div className="lg:col-span-2">
        <label className="block text-xs text-gray-600 mb-1">Description</label>
        <input type="text" className="input w-full" value={buffer.description}
               onChange={e => update('description', e.target.value)} />
      </div>
      <div>
        <label className="block text-xs text-gray-600 mb-1">Amount</label>
        <input type="number" step="0.01" className="input w-full" value={buffer.amount}
               onChange={e => update('amount', e.target.value)} />
      </div>
      <div>
        <label className="block text-xs text-gray-600 mb-1">Type</label>
        <select className="input w-full" value={buffer.type}
                onChange={e => update('type', e.target.value as 'income' | 'expense')}>
          <option value="income">Income</option>
          <option value="expense">Expense</option>
        </select>
      </div>
      <div>
        <label className="block text-xs text-gray-600 mb-1">Account</label>
        <select className="input w-full" value={buffer.accountId}
                onChange={e => update('accountId', e.target.value)}>
          <option value="">— select —</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs text-gray-600 mb-1">Category</label>
        <select className="input w-full" value={buffer.categoryId}
                onChange={e => update('categoryId', e.target.value)}>
          <option value="">— select —</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="sm:col-span-2 lg:col-span-6 flex gap-2 justify-end">
        <button onClick={onCancel} className="btn-secondary text-sm">Cancel</button>
        <button onClick={onSave} className="btn-primary text-sm">Save</button>
      </div>
    </div>
  )
}

export default History
