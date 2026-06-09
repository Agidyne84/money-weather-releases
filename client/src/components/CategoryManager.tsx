import React, { useEffect, useState } from 'react'
import { Category } from '../types'
import { categoriesApi, transactionsApi, historyApi } from '../services/database'
import CategorySelector from './CategorySelector'

const PRESET_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16']

interface ReassignState {
  categoryToDelete: Category
  affectedTransactions: number
  affectedHistory: number
  selectedCategoryId: string
}

const CategoryManager: React.FC = () => {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Add / Edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState(PRESET_COLORS[0])
  const [editParentId, setEditParentId] = useState('')

  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(PRESET_COLORS[0])
  const [newParentId, setNewParentId] = useState('')
  const [newParentName, setNewParentName] = useState('')

  // Delete / Reassign state
  const [reassign, setReassign] = useState<ReassignState | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  // View mode
  const [condensed, setCondensed] = useState(true)

  const loadCategories = async () => {
    setLoading(true)
    try {
      const data = await categoriesApi.getAll()
      setCategories(data)
      setError(null)
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load categories')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadCategories()
  }, [])

  const parentCategories = categories.filter(c => !c.parentId)
  const childCategories = categories.filter(c => c.parentId)

  const startEdit = (cat: Category) => {
    setEditingId(cat.id)
    setEditName(cat.name)
    setEditColor(cat.color || PRESET_COLORS[0])
    setEditParentId(cat.parentId || '')
    setAdding(false)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditName('')
    setEditColor(PRESET_COLORS[0])
    setEditParentId('')
  }

  const saveEdit = async () => {
    if (!editName.trim()) {
      console.log('[saveEdit] blocked: empty name')
      return
    }
    console.log('[saveEdit] starting for id:', editingId)
    setActionLoading(true)
    setError(null)
    try {
      await categoriesApi.update(editingId!, {
        name: editName.trim(),
        color: editColor,
        parentId: editParentId || undefined,
      })
      await loadCategories()
      cancelEdit()
      console.log('[saveEdit] success')
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to update category'
      console.error('[saveEdit] error:', msg, err)
      setError(msg)
    } finally {
      setActionLoading(false)
    }
  }

  const startAdd = () => {
    setAdding(true)
    setEditingId(null)
    setNewName('')
    setNewColor(PRESET_COLORS[0])
    setNewParentId('')
    setNewParentName('')
  }

  const cancelAdd = () => {
    setAdding(false)
    setNewName('')
    setNewColor(PRESET_COLORS[0])
    setNewParentId('')
    setNewParentName('')
  }

  const saveAdd = async () => {
    if (!newName.trim()) return
    setActionLoading(true)
    setError(null)
    try {
      const maxSort = categories.length > 0
        ? Math.max(...categories.map(c => c.sortOrder || 0))
        : 0

      let parentId = newParentId || undefined

      // If user chose to create a new parent, create it first
      if (newParentId === '__new_parent__') {
        if (!newParentName.trim()) {
          setError('New parent category name is required')
          setActionLoading(false)
          return
        }
        const createdParent = await categoriesApi.create({
          name: newParentName.trim(),
          color: newColor,
          sortOrder: maxSort + 1,
        })
        setCategories(prev => [...prev, createdParent])
        parentId = createdParent.id
      }

      await categoriesApi.create({
        name: newName.trim(),
        color: newColor,
        parentId,
        sortOrder: maxSort + 2,
      })
      await loadCategories()
      cancelAdd()
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to create category')
    } finally {
      setActionLoading(false)
    }
  }

  const promptDelete = async (cat: Category) => {
    setActionLoading(true)
    try {
      // Count affected transactions and history rows
      const [allTransactions, allHistory] = await Promise.all([
        transactionsApi.getAll(10000, 0),
        historyApi.getAll({ limit: 10000, offset: 0 }),
      ])
      const txCount = allTransactions.filter(t => t.categoryId === cat.id).length
      const histCount = allHistory.filter(h => h.categoryId === cat.id).length

      if (txCount > 0 || histCount > 0) {
        setError(null)
        setReassign({
          categoryToDelete: cat,
          affectedTransactions: txCount,
          affectedHistory: histCount,
          selectedCategoryId: '',
        })
      } else {
        // No dependents — delete immediately
        await categoriesApi.delete(cat.id)
        await loadCategories()
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to delete category')
    } finally {
      setActionLoading(false)
    }
  }

  const executeReassignAndDelete = async () => {
    if (!reassign || !reassign.selectedCategoryId) return
    setActionLoading(true)
    setError(null)
    try {
      const catId = reassign.categoryToDelete.id
      const newCatId = reassign.selectedCategoryId

      // Fetch and update transactions — must preserve ALL fields because
      // the backend PUT /api/transactions/:id does not use COALESCE.
      const allTransactions = await transactionsApi.getAll(10000, 0)
      const txToUpdate = allTransactions.filter(t => t.categoryId === catId)
      const validTx = txToUpdate.filter(t => t.id)
      const nullTx = txToUpdate.filter(t => !t.id)
      if (nullTx.length > 0) {
        console.warn(`Skipping ${nullTx.length} transaction(s) with null id — restart the backend server to auto-fix`)
      }
      for (const t of validTx) {
        await transactionsApi.update(t.id, { ...t, categoryId: newCatId })
      }

      // Fetch and update history rows — COALESCE on the backend means we
      // can safely send only the changed field here.
      const allHistory = await historyApi.getAll({ limit: 10000, offset: 0 })
      const histToUpdate = allHistory.filter(h => h.categoryId === catId)
      await Promise.all(histToUpdate.map(h =>
        historyApi.update(h.id, { categoryId: newCatId })
      ))

      // Delete the category
      await categoriesApi.delete(catId)
      await loadCategories()
      setReassign(null)
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to reassign and delete category'
      console.error('Reassign & Delete error:', err)
      setError(msg)
    } finally {
      setActionLoading(false)
    }
  }

  const handleCategoryAdded = (cat: Category) => {
    setCategories(prev => [...prev, cat])
    if (reassign) {
      setReassign(prev => prev ? { ...prev, selectedCategoryId: cat.id } : null)
    }
  }

  if (loading && categories.length === 0) {
    return <div className="text-sm text-gray-500">Loading categories…</div>
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Categories</h2>
        <button
          onClick={() => {
            if (condensed) { setCondensed(false); setEditingId(null); setAdding(false) }
            else { setCondensed(true); cancelEdit(); cancelAdd() }
          }}
          className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
          disabled={actionLoading}
        >
          {condensed ? 'Edit' : 'Done'}
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}

      {condensed ? (
        /* Mini card grid — one card per parent + its children */
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {parentCategories.map(parent => {
            const children = childCategories.filter(c => c.parentId === parent.id)
            return (
              <div
                key={parent.id}
                className="bg-gray-50 rounded-lg border border-gray-200 p-3 flex flex-col"
              >
                <div className="flex items-center gap-2 mb-2 pb-1 border-b border-gray-200">
                  <span
                    className="w-3 h-3 rounded-full inline-block"
                    style={{ backgroundColor: parent.color || '#ccc' }}
                  />
                  <span className="text-sm font-bold text-gray-900">{parent.name}</span>
                </div>
                {children.length > 0 ? (
                  <div className="flex flex-wrap gap-x-2 gap-y-1">
                    {children.map(child => (
                      <span key={child.id} className="text-xs text-gray-700">
                        {child.name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-xs text-gray-400 italic">No sub-categories</span>
                )}
              </div>
            )
          })}
          {/* Orphan children — display as a standalone card */}
          {(() => {
            const orphans = childCategories.filter(c => !parentCategories.find(p => p.id === c.parentId))
            if (orphans.length === 0) return null
            return (
              <div className="bg-red-50 rounded-lg border border-red-200 p-3 flex flex-col">
                <div className="flex items-center gap-2 mb-2 pb-1 border-b border-red-200">
                  <span className="w-3 h-3 rounded-full bg-red-400 inline-block" />
                  <span className="text-sm font-bold text-red-700">Unassigned</span>
                </div>
                <div className="flex flex-wrap gap-x-2 gap-y-1">
                  {orphans.map(child => (
                    <span key={child.id} className="text-xs text-gray-700">{child.name}</span>
                  ))}
                </div>
              </div>
            )
          })()}
        </div>
      ) : (
        <>
          <button
            onClick={startAdd}
            className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 self-start"
            disabled={adding || !!editingId}
          >
            + Add Category
          </button>

          {/* Add new row */}
          {adding && (
        <div className="p-4 bg-gray-50 rounded border border-gray-200 space-y-3">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[160px]">
              <label className="block text-xs font-medium text-gray-600 mb-1">Name <span className="text-red-500">*</span></label>
              <input
                type="text"
                className="form-input w-full text-sm"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="Category name"
                autoFocus
              />
            </div>
            <div className="w-48">
              <label className="block text-xs font-medium text-gray-600 mb-1">Parent</label>
              <select
                className="form-input w-full text-sm"
                value={newParentId}
                onChange={e => setNewParentId(e.target.value)}
              >
                <option value="">— top-level —</option>
                {parentCategories.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
                <option value="__new_parent__">+ Create new parent…</option>
              </select>
              {newParentId === '__new_parent__' && (
                <>
                  <label className="block text-xs font-medium text-gray-600 mt-1">New Parent Name <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    className="form-input w-full text-sm mt-1"
                    value={newParentName}
                    onChange={e => setNewParentName(e.target.value)}
                    placeholder="New parent name"
                    autoFocus
                  />
                </>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Color</label>
              <div className="flex gap-1">
                {PRESET_COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    className={`w-6 h-6 rounded-full border-2 ${newColor === c ? 'border-gray-900 scale-110' : 'border-transparent'}`}
                    style={{ backgroundColor: c }}
                    onClick={() => setNewColor(c)}
                  />
                ))}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={saveAdd}
              disabled={actionLoading || !newName.trim() || (newParentId === '__new_parent__' && !newParentName.trim())}
              className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {actionLoading ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={cancelAdd}
              className="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 text-xs rounded hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Category list */}
      <div className="space-y-1">
        {parentCategories.map(parent => (
          <div key={parent.id}>
            {editingId === parent.id ? (
              <div className="flex flex-wrap gap-2 items-center p-2 bg-yellow-50 rounded border border-yellow-200">
                <input
                  type="text"
                  className="form-input text-sm flex-1 min-w-[120px]"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                />
                <div className="flex gap-1">
                  {PRESET_COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      className={`w-5 h-5 rounded-full border-2 ${editColor === c ? 'border-gray-900' : 'border-transparent'}`}
                      style={{ backgroundColor: c }}
                      onClick={() => setEditColor(c)}
                    />
                  ))}
                </div>
                <span className="text-xs text-gray-500 whitespace-nowrap">Parent category</span>
                {error && editingId && (
                  <span className="text-xs text-red-600 w-full">{error}</span>
                )}
                <button
                  type="button"
                  onClick={saveEdit}
                  disabled={actionLoading || !editName.trim()}
                  className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  {actionLoading ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="px-2 py-1 bg-white border border-gray-300 text-gray-700 text-xs rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between p-2 hover:bg-gray-50 rounded group">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: parent.color || '#ccc' }} />
                  <span className="text-sm font-medium text-gray-900">{parent.name}</span>
                  <span className="text-xs text-gray-400">(parent)</span>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => startEdit(parent)}
                    className="px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => promptDelete(parent)}
                    className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}

            {/* Children */}
            {childCategories.filter(c => c.parentId === parent.id).map(child => (
              <div key={child.id} className="ml-6">
                {editingId === child.id ? (
                  <div className="flex flex-wrap gap-2 items-center p-2 bg-yellow-50 rounded border border-yellow-200">
                    <input
                      type="text"
                      className="form-input text-sm flex-1 min-w-[120px]"
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                    />
                    <div className="flex gap-1">
                      {PRESET_COLORS.map(c => (
                        <button
                          key={c}
                          type="button"
                          className={`w-5 h-5 rounded-full border-2 ${editColor === c ? 'border-gray-900' : 'border-transparent'}`}
                          style={{ backgroundColor: c }}
                          onClick={() => setEditColor(c)}
                        />
                      ))}
                    </div>
                    <select
                      className="form-input text-sm w-36"
                      value={editParentId}
                      onChange={e => setEditParentId(e.target.value)}
                    >
                      <option value="">— top-level —</option>
                      {parentCategories.filter(p => p.id !== child.id).map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    {error && editingId && (
                      <span className="text-xs text-red-600 w-full">{error}</span>
                    )}
                    <button
                      type="button"
                      onClick={saveEdit}
                      disabled={actionLoading || !editName.trim()}
                      className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                      {actionLoading ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="px-2 py-1 bg-white border border-gray-300 text-gray-700 text-xs rounded hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between p-2 hover:bg-gray-50 rounded group">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: child.color || '#ccc' }} />
                      <span className="text-sm text-gray-700">{child.name}</span>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => startEdit(child)}
                        className="px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => promptDelete(child)}
                        className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}

        {/* Orphan child categories (parent was deleted) */}
        {childCategories.filter(c => !parentCategories.find(p => p.id === c.parentId)).map(child => (
          <div key={child.id} className="ml-2">
            {editingId === child.id ? (
              <div className="flex flex-wrap gap-2 items-center p-2 bg-yellow-50 rounded border border-yellow-200">
                <input
                  type="text"
                  className="form-input text-sm flex-1 min-w-[120px]"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                />
                <div className="flex gap-1">
                  {PRESET_COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      className={`w-5 h-5 rounded-full border-2 ${editColor === c ? 'border-gray-900' : 'border-transparent'}`}
                      style={{ backgroundColor: c }}
                      onClick={() => setEditColor(c)}
                    />
                  ))}
                </div>
                <select
                  className="form-input text-sm w-36"
                  value={editParentId}
                  onChange={e => setEditParentId(e.target.value)}
                >
                  <option value="">— top-level —</option>
                  {parentCategories.filter(p => p.id !== child.id).map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                {error && editingId && (
                  <span className="text-xs text-red-600 w-full">{error}</span>
                )}
                <button
                  type="button"
                  onClick={saveEdit}
                  disabled={actionLoading || !editName.trim()}
                  className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  {actionLoading ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="px-2 py-1 bg-white border border-gray-300 text-gray-700 text-xs rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between p-2 hover:bg-gray-50 rounded group bg-red-50 border border-red-100">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: child.color || '#ccc' }} />
                  <span className="text-sm text-gray-700">{child.name}</span>
                  <span className="text-xs text-red-500">(orphaned)</span>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => startEdit(child)}
                    className="px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => promptDelete(child)}
                    className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Reassignment modal */}
      {reassign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">Reassign Transactions</h3>
            <p className="text-sm text-gray-600">
              <strong>{reassign.categoryToDelete.name}</strong> is used by:
            </p>
            <ul className="text-sm text-gray-700 list-disc list-inside">
              {reassign.affectedTransactions > 0 && (
                <li>{reassign.affectedTransactions} budget/forecast transaction{reassign.affectedTransactions !== 1 ? 's' : ''}</li>
              )}
              {reassign.affectedHistory > 0 && (
                <li>{reassign.affectedHistory} history row{reassign.affectedHistory !== 1 ? 's' : ''}</li>
              )}
            </ul>
            <p className="text-sm text-gray-600">Select or create a new category to assign them to:</p>

            {error && (
              <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                {error}
              </div>
            )}

            <CategorySelector
              categories={categories}
              selectedCategoryId={reassign.selectedCategoryId}
              onChange={(id: string) => setReassign(prev => prev ? { ...prev, selectedCategoryId: id } : null)}
              onCategoryAdded={handleCategoryAdded}
              className="form-input w-full"
            />

            {reassign.selectedCategoryId === reassign.categoryToDelete.id && (
              <p className="text-xs text-red-600">Cannot reassign to the same category being deleted.</p>
            )}

            <div className="flex gap-2 justify-end pt-2">
              <button
                onClick={() => { setReassign(null); setError(null) }}
                className="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 text-sm rounded hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={executeReassignAndDelete}
                disabled={actionLoading || !reassign.selectedCategoryId || reassign.selectedCategoryId === reassign.categoryToDelete.id}
                className="px-3 py-1.5 bg-red-600 text-white text-sm rounded hover:bg-red-700 disabled:opacity-50"
              >
                {actionLoading ? 'Processing…' : 'Reassign & Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  )
}

export default CategoryManager
