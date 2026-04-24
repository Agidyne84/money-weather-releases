import React, { useState } from 'react'
import { Category } from '../types'
import { categoriesApi } from '../services/api'

interface Props {
  categories: Category[]
  selectedCategoryId: string
  onChange: (categoryId: string) => void
  onCategoryAdded: (category: Category) => void
  className?: string
  id?: string
  required?: boolean
}

const PRESET_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16']

const CategorySelector: React.FC<Props> = ({
  categories,
  selectedCategoryId,
  onChange,
  onCategoryAdded,
  className = 'form-input',
  id,
  required = false
}) => {
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newParentId, setNewParentId] = useState('')
  const [newColor, setNewColor] = useState(PRESET_COLORS[0])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const parentCategories = categories.filter(c => !c.parentId)

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value
    if (val === '__new__') {
      setAdding(true)
      setNewName('')
      setNewParentId('')
      setNewColor(PRESET_COLORS[0])
      setError('')
    } else {
      onChange(val)
    }
  }

  const handleCancel = () => {
    setAdding(false)
    setNewName('')
    setNewParentId('')
    setError('')
  }

  const handleSave = async () => {
    if (!newName.trim()) {
      setError('Category name is required')
      return
    }
    setSaving(true)
    setError('')
    try {
      const maxSort = categories.length > 0
        ? Math.max(...categories.map(c => c.sortOrder || 0))
        : 0
      const payload: Omit<Category, 'id' | 'createdAt'> = {
        name: newName.trim(),
        parentId: newParentId || undefined,
        color: newColor,
        sortOrder: maxSort + 1
      }
      const created = await categoriesApi.create(payload)
      onCategoryAdded(created)
      setAdding(false)
      setNewName('')
      setNewParentId('')
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to create category')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <select
        id={id}
        className={className}
        value={selectedCategoryId}
        onChange={handleSelectChange}
        required={required}
      >
        <option value="">{required ? '— select —' : '— select —'}</option>
        {/* Parent groups with children */}
        {parentCategories.map(parent => {
          const children = categories.filter(c => c.parentId === parent.id)
          if (children.length === 0) return null
          return (
            <optgroup label={parent.name} key={parent.id}>
              {children.map(child => (
                <option key={child.id} value={child.id}>{child.name}</option>
              ))}
            </optgroup>
          )
        })}
        {/* Childless categories shown at top level */}
        {categories
          .filter(c => !c.parentId && categories.filter(child => child.parentId === c.id).length === 0)
          .map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        <option value="__new__">+ Add new category…</option>
      </select>

      {adding && (
        <div className="mt-3 p-3 bg-gray-50 rounded border border-gray-200">
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-[140px]">
              <label className="block text-xs font-medium text-gray-600 mb-1">Category name</label>
              <input
                type="text"
                className="form-input w-full text-sm"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="e.g. Dining Out"
                autoFocus
              />
            </div>
            <div className="w-40">
              <label className="block text-xs font-medium text-gray-600 mb-1">Parent (optional)</label>
              <select
                className="form-input w-full text-sm"
                value={newParentId}
                onChange={e => setNewParentId(e.target.value)}
              >
                <option value="">— none —</option>
                {parentCategories.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
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
                    title={c}
                  />
                ))}
              </div>
            </div>
          </div>
          {error && <p className="text-red-600 text-xs mt-2">{error}</p>}
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-50"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save Category'}
            </button>
            <button
              type="button"
              className="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 text-xs rounded hover:bg-gray-50"
              onClick={handleCancel}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default CategorySelector
