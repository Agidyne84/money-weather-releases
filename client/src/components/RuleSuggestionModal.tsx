import React, { useState } from 'react'
import MultiSelectDropdown from './MultiSelectDropdown'

interface RuleSuggestionModalProps {
  transactionName: string
  suggestedPattern: string
  examples: { bankDescription: string; accountId: string; amount: number; date: string }[]
  currentAccountId: string
  allAccounts: { id: string; name: string }[]
  existingRuleId: string | null
  onConfirm: (params: {
    pattern: string
    restrictToAccount: boolean
    accountIds: string[]
    ruleId: string | null
  }) => void
  onDismiss: () => void
  onDisable: () => void
}

const RuleSuggestionModal: React.FC<RuleSuggestionModalProps> = ({
  transactionName,
  suggestedPattern,
  examples,
  currentAccountId,
  allAccounts,
  existingRuleId,
  onConfirm,
  onDismiss,
  onDisable,
}) => {
  const [pattern, setPattern] = useState(suggestedPattern)
  const [restrictToAccount, setRestrictToAccount] = useState(false)
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>(
    currentAccountId ? [currentAccountId] : []
  )
  const [saving, setSaving] = useState(false)

  const handleConfirm = async () => {
    if (!pattern.trim()) return
    setSaving(true)
    try {
      await onConfirm({
        pattern: pattern.trim(),
        restrictToAccount,
        accountIds: restrictToAccount ? selectedAccountIds : [],
        ruleId: existingRuleId,
      })
    } finally {
      setSaving(false)
    }
  }

  const normalizeWithMap = (s: string): { text: string; map: number[] } => {
    const map: number[] = []
    let result = ''
    for (let i = 0; i < s.length; i++) {
      const ch = s[i].toLowerCase()
      if (/[a-z]/.test(ch)) {
        result += ch
        map.push(i)
      } else {
        if (result.length === 0 || result[result.length - 1] !== ' ') {
          result += ' '
          map.push(i)
        }
      }
    }
    if (result.startsWith(' ')) {
      result = result.slice(1)
      map.shift()
    }
    if (result.endsWith(' ')) {
      result = result.slice(0, -1)
      map.pop()
    }
    return { text: result, map }
  }

  const highlightMatch = (desc: string) => {
    if (!pattern.trim()) return <span>{desc}</span>

    // Fast path: direct case-insensitive substring match
    const lowerDesc = desc.toLowerCase()
    const lowerPat = pattern.toLowerCase()
    const directIdx = lowerDesc.indexOf(lowerPat)
    if (directIdx !== -1) {
      return (
        <span>
          {desc.slice(0, directIdx)}
          <mark className="bg-yellow-200 px-0.5 rounded">{desc.slice(directIdx, directIdx + pattern.length)}</mark>
          {desc.slice(directIdx + pattern.length)}
        </span>
      )
    }

    // Fallback: map through the same normalization used for rule matching
    const { text: norm, map } = normalizeWithMap(desc)
    const normPat = normalizeWithMap(pattern).text
    const idx = norm.indexOf(normPat)
    if (idx === -1) return <span className="text-red-600">{desc}</span>

    const startChar = map[idx]
    const lastIdx = Math.min(idx + normPat.length - 1, map.length - 1)
    const endChar = map[lastIdx] + 1

    return (
      <span>
        {desc.slice(0, startChar)}
        <mark className="bg-yellow-200 px-0.5 rounded">{desc.slice(startChar, endChar)}</mark>
        {desc.slice(endChar)}
      </span>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
      onClick={(e) => { if (e.target === e.currentTarget) onDismiss() }}
    >
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              {existingRuleId ? 'Update Auto-assign Rule' : 'Create Auto-assign Rule'}
            </h3>
            <p className="text-sm text-gray-500 mt-0.5">
              Budget item: <span className="font-medium text-gray-700">{transactionName}</span>
            </p>
          </div>
          <span className="text-2xl leading-none" title="Rule suggestion">⚡</span>
        </div>

        <p className="text-sm text-gray-600 mb-4">
          {existingRuleId
            ? 'A new example was found that differs from the current rule. Review and update the pattern.'
            : `The app has seen ${examples.length} transactions assigned to this budget item. A rule can auto-assign future matches.`}
        </p>

        {/* Pattern editor */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Match pattern <span className="text-gray-400 font-normal">(description must contain this text)</span>
          </label>
          <input
            type="text"
            className="form-input w-full font-mono text-sm"
            value={pattern}
            onChange={e => setPattern(e.target.value)}
            placeholder="e.g. netflix"
          />
        </div>

        {/* Examples preview */}
        <div className="mb-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
            Example descriptions ({examples.length})
          </p>
          <ul className="space-y-1 max-h-40 overflow-y-auto border border-gray-100 rounded p-2 bg-gray-50">
            {examples.map((ex, i) => (
              <li key={i} className="text-xs text-gray-700 font-mono truncate">
                {highlightMatch(ex.bankDescription)}
              </li>
            ))}
          </ul>
        </div>

        {/* Account scope */}
        <div className="mb-5">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={restrictToAccount}
                onChange={e => {
                  setRestrictToAccount(e.target.checked)
                  if (e.target.checked && selectedAccountIds.length === 0 && currentAccountId) {
                    setSelectedAccountIds([currentAccountId])
                  }
                }}
                className="rounded"
              />
              Restrict to
            </label>
            <MultiSelectDropdown
              options={allAccounts.map(a => ({
                id: a.id,
                label: a.name,
                note: a.id === currentAccountId ? 'current' : undefined,
              }))}
              selected={selectedAccountIds}
              onChange={setSelectedAccountIds}
              placeholder="Select accounts…"
              disabled={!restrictToAccount}
              className="flex-1"
            />
          </div>
          {restrictToAccount && selectedAccountIds.length === 0 && (
            <p className="text-xs text-amber-600 mt-1 ml-5">Select at least one account, or uncheck to match all.</p>
          )}
          {!restrictToAccount && (
            <p className="text-xs text-gray-400 mt-1 ml-5">Matches this pattern across all accounts.</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2">
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm rounded hover:bg-gray-50"
              onClick={onDismiss}
            >
              Not now
            </button>
            <button
              type="button"
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
              onClick={handleConfirm}
              disabled={saving || !pattern.trim()}
            >
              {saving ? 'Saving…' : existingRuleId ? 'Update Rule' : 'Create Rule'}
            </button>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              className="text-xs text-gray-400 hover:text-gray-600 underline"
              onClick={onDisable}
            >
              Never suggest rules for "{transactionName}"
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default RuleSuggestionModal
