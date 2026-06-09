import React, { useState, useEffect, useCallback } from 'react'
import { rulesApi, ImportRule, transactionsApi, accountsApi, RuleExamplesResult } from '../services/database'
import RuleSuggestionModal from './RuleSuggestionModal'
import MultiSelectDropdown from './MultiSelectDropdown'

interface SuppressedItem {
  transactionId: string
  transactionName: string
}

interface Transaction {
  id: string
  name: string
  categoryId: string
  isActive: boolean
}

interface Account {
  id: string
  name: string
}

interface RulesManagerProps {
  inline?: boolean
  /** Bank descriptions currently being reconciled, keyed by budgetTransactionId */
  sessionDescriptions?: Record<string, string[]>
  /** Descriptions already rule-matched to OTHER budget items in the current session */
  sessionNegatives?: string[]
  /** The account currently being imported (used for Tier-2 discriminating fallback) */
  selectedAccountId?: string
  /** Called when the user clicks Apply Rules; receives all currently active rules */
  onApplyRules?: (activeRules: ImportRule[]) => void
  /** Increment to trigger a rules reload from outside (e.g. after quick-rule save) */
  refreshKey?: number
}

const CONFIDENCE_THRESHOLD = 0.3

const RulesManager: React.FC<RulesManagerProps> = ({
  inline = false,
  sessionDescriptions = {},
  sessionNegatives = [],
  selectedAccountId = '',
  onApplyRules,
  refreshKey = 0,
}) => {
  const [rules, setRules] = useState<ImportRule[]>([])
  const [suppressed, setSuppressed] = useState<SuppressedItem[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editPattern, setEditPattern] = useState('')
  const [editRestrictToAccount, setEditRestrictToAccount] = useState(false)
  const [editAccountIds, setEditAccountIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [showAllRules, setShowAllRules] = useState(false)

  // New rule form
  const [showNewForm, setShowNewForm] = useState(false)
  const [newTransactionId, setNewTransactionId] = useState('')
  const [newPattern, setNewPattern] = useState('')
  const [newRestrictToAccount, setNewRestrictToAccount] = useState(false)
  const [newAccountIds, setNewAccountIds] = useState<string[]>([])
  const [newSaving, setNewSaving] = useState(false)

  // Analyze-history modal state (reuses RuleSuggestionModal)
  const [analyzing, setAnalyzing] = useState<string | null>(null) // transactionId being analyzed
  const [analyzeResult, setAnalyzeResult] = useState<{
    transactionId: string
    transactionName: string
    categoryId: string
    examples: RuleExamplesResult['examples']
    suggestedPattern: string
  } | null>(null)

  useEffect(() => { if (refreshKey > 0) load() }, [refreshKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [rulesData, txData, acctData] = await Promise.all([
        rulesApi.getAll(),
        transactionsApi.getAll(),
        accountsApi.getAll(),
      ])
      setRules(rulesData)
      setTransactions((txData as any[]).filter((t: any) => t.isActive))
      setAccounts(acctData as any[])
      const suppressedRes = await fetch('/api/rules/suppressed').then(r => r.json()).catch(() => [])
      const items: SuppressedItem[] = (suppressedRes as string[]).map((tid: string) => ({
        transactionId: tid,
        transactionName: (txData as any[]).find((t: any) => t.id === tid)?.name ?? tid,
      }))
      setSuppressed(items)
    } catch {
      setError('Failed to load rules')
    } finally {
      setLoading(false)
    }
  }, [])

  const saveNewRule = async () => {
    if (!newTransactionId || !newPattern.trim()) return
    const tx = transactions.find(t => t.id === newTransactionId)
    if (!tx) return
    setNewSaving(true)
    try {
      const created = await rulesApi.create({
        transactionId: newTransactionId,
        accountIds: newRestrictToAccount ? newAccountIds : [],
        restrictToAccount: newRestrictToAccount,
        pattern: newPattern.trim(),
        categoryId: tx.categoryId,
      })
      setRules(prev => [created, ...prev])
      setShowNewForm(false)
      setNewTransactionId('')
      setNewPattern('')
      setNewRestrictToAccount(false)
      setNewAccountIds([])
    } catch {
      setError('Failed to create rule')
    } finally {
      setNewSaving(false)
    }
  }

  const analyzeHistory = async (transactionId: string) => {
    const tx = transactions.find(t => t.id === transactionId)
    if (!tx) return
    setAnalyzing(transactionId)
    try {
      // --- Tier 1: filtered LCS from server ---
      const result = await rulesApi.getExamples(transactionId)

      // Merge in-session descriptions, filtering out any already matched by existing rules
      const existingPatterns = result.existingRulePatterns ?? []
      const normalize = (s: string) =>
        s.toLowerCase().replace(/\d+/g, ' ').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()
      const matchesAnyRule = (desc: string) =>
        existingPatterns.some(p => normalize(desc).includes(normalize(p)))

      const rawSessionDescs = sessionDescriptions[transactionId] ?? []
      const sessionDescs = existingPatterns.length > 0
        ? rawSessionDescs.filter(d => !matchesAnyRule(d))
        : rawSessionDescs

      const today = new Date().toISOString().split('T')[0]
      const sessionExamples = sessionDescs.map(d => ({
        bankDescription: d,
        accountId: '',
        amount: 0,
        date: today,
      }))
      const allExamples = [...sessionExamples, ...result.examples]

      if (allExamples.length === 0) {
        setError(`No transactions found for "${tx.name}". Assign some rows to this item or commit history first.`)
        return
      }

      const allDescs = allExamples.map(e => e.bankDescription)

      // Recompute Tier-1 pattern when session descriptions were added
      let tier1Pattern = result.suggestedPattern
      let tier1Confidence = result.confidence ?? 0
      if (sessionDescs.length > 0 && allDescs.length >= 3) {
        const recomputed = await rulesApi.suggestPattern(allDescs)
        tier1Pattern = recomputed.pattern
        tier1Confidence = recomputed.confidence ?? 0
      }

      // --- Tier 2: discriminating fallback ---
      let pattern = tier1Pattern
      if ((!tier1Pattern || tier1Confidence < CONFIDENCE_THRESHOLD) && allDescs.length >= 3) {
        try {
          const disc = await rulesApi.suggestPatternDiscriminating({
            positives: allDescs,
            sessionNegatives,
            accountId: selectedAccountId,
            transactionId,
          })
          if (disc.pattern) pattern = disc.pattern
        } catch { /* non-critical: fall through to tier1 */ }
      }

      if (!pattern) {
        setError(`No common pattern found across ${allExamples.length} transactions for "${tx.name}". Try creating a custom rule manually.`)
        return
      }
      setAnalyzeResult({
        transactionId,
        transactionName: tx.name,
        categoryId: tx.categoryId,
        examples: allExamples,
        suggestedPattern: pattern,
      })
    } catch {
      setError('Failed to analyse history')
    } finally {
      setAnalyzing(null)
    }
  }

  const reenableSuggestions = async (transactionId: string) => {
    try {
      await fetch(`/api/rules/suppressed/${encodeURIComponent(transactionId)}`, { method: 'DELETE' })
      setSuppressed(prev => prev.filter(s => s.transactionId !== transactionId))
    } catch {
      setError('Failed to re-enable suggestions')
    }
  }

  useEffect(() => { load() }, [load])

  const startEdit = (rule: ImportRule) => {
    setEditingId(rule.id)
    setEditPattern(rule.pattern)
    setEditRestrictToAccount(rule.restrictToAccount)
    setEditAccountIds(rule.accountIds ?? [])
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditPattern('')
    setEditRestrictToAccount(false)
    setEditAccountIds([])
  }

  const saveEdit = async (rule: ImportRule) => {
    setSaving(true)
    try {
      const updated = await rulesApi.update(rule.id, {
        pattern: editPattern.trim(),
        restrictToAccount: editRestrictToAccount,
        accountIds: editRestrictToAccount ? editAccountIds : [],
      })
      setRules(prev => prev.map(r => r.id === updated.id ? updated : r))
      cancelEdit()
    } catch {
      setError('Failed to save rule')
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (rule: ImportRule) => {
    try {
      const updated = await rulesApi.update(rule.id, { isActive: !rule.isActive })
      setRules(prev => prev.map(r => r.id === updated.id ? updated : r))
    } catch {
      setError('Failed to update rule')
    }
  }

  const deleteRule = async (id: string) => {
    if (!window.confirm('Delete this rule? Future imports will no longer auto-assign based on it.')) return
    try {
      await rulesApi.delete(id)
      setRules(prev => prev.filter(r => r.id !== id))
    } catch {
      setError('Failed to delete rule')
    }
  }

  const inner = (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          {!inline && <h2 className="text-lg font-semibold text-gray-900">Auto-assign Rules</h2>}
          <p className="text-sm text-gray-500">
            Rules automatically assign budget items to matching bank rows during import.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setShowNewForm(f => !f); setError('') }}
            className="btn-primary text-sm py-1 px-3"
          >
            {showNewForm ? 'Cancel' : '+ New Rule'}
          </button>
          {inline && onApplyRules && (
            <button
              onClick={() => onApplyRules(rules.filter(r => r.isActive))}
              className="btn-secondary text-sm py-1 px-3"
              disabled={rules.filter(r => r.isActive).length === 0}
              title="Apply all active rules to the current unreconciled rows"
            >
              Apply Rules
            </button>
          )}
          <button onClick={load} className="btn-secondary text-sm py-1 px-3" disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between bg-red-50 border border-red-200 rounded px-3 py-2 mb-3">
          <p className="text-red-700 text-sm">{error}</p>
          <button className="text-red-400 hover:text-red-600 text-xs" onClick={() => setError('')}>✕</button>
        </div>
      )}

      {/* New Rule form */}
      {showNewForm && (
        <div className="bg-blue-50 border border-blue-200 rounded p-4 mb-4 space-y-3">
          <h3 className="text-sm font-semibold text-blue-800">Create custom rule</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Budget Item *</label>
              <select
                className="form-input text-sm py-1 w-full"
                value={newTransactionId}
                onChange={e => setNewTransactionId(e.target.value)}
              >
                <option value="">Select…</option>
                {transactions.slice().sort((a, b) => a.name.localeCompare(b.name)).map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Match pattern * <span className="text-gray-400">(case-insensitive substring)</span></label>
              <input
                type="text"
                className="form-input text-sm py-1 w-full font-mono"
                placeholder="e.g. mevan"
                value={newPattern}
                onChange={e => setNewPattern(e.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={newRestrictToAccount}
                onChange={e => setNewRestrictToAccount(e.target.checked)}
                className="rounded"
              />
              Restrict to
            </label>
            <MultiSelectDropdown
              options={accounts.map(a => ({ id: a.id, label: a.name }))}
              selected={newAccountIds}
              onChange={setNewAccountIds}
              placeholder="Select accounts…"
              disabled={!newRestrictToAccount}
              className="flex-1"
            />
          </div>
          <div className="flex gap-2">
            <button
              className="btn-primary text-sm py-1 px-4"
              onClick={saveNewRule}
              disabled={newSaving || !newTransactionId || !newPattern.trim()}
            >
              {newSaving ? 'Saving…' : 'Save Rule'}
            </button>
            <button
              className="btn-secondary text-sm py-1 px-3"
              onClick={() => setShowNewForm(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Analyze history section */}
      <div className="bg-gray-50 border border-gray-200 rounded p-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-700">Propose rule from history</p>
            <p className="text-xs text-gray-500">
              Analyses committed bank transactions for a budget item to find a common pattern.
            </p>
          </div>
          <select
            className="form-input text-sm py-1 w-48"
            defaultValue=""
            onChange={e => { if (e.target.value) analyzeHistory(e.target.value); e.target.value = '' }}
          >
            <option value="">Select budget item…</option>
            {transactions.slice().sort((a, b) => a.name.localeCompare(b.name)).map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          {analyzing && <span className="text-xs text-gray-400 animate-pulse">Analysing…</span>}
        </div>
      </div>

      {/* Rules table */}
      {loading ? (
        <p className="text-gray-400 text-sm">Loading rules…</p>
      ) : rules.length === 0 ? (
        <div className="text-center py-8 text-gray-400">
          <div className="text-3xl mb-2">⚡</div>
          <p className="text-sm font-medium">No rules yet</p>
          <p className="text-xs mt-1">
            Create one above, or rules appear automatically after confirming suggestions during import.
          </p>
        </div>
      ) : (
        <div className={inline ? 'max-h-[180px] overflow-auto' : 'overflow-x-auto'}>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Pattern</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Budget Item</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Account scope</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Matches</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Active</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rules
                .filter(rule => {
                  if (!selectedAccountId) return true
                  if (!rule.restrictToAccount) return true
                  return (rule.accountIds ?? []).includes(selectedAccountId)
                })
                .slice().sort((a, b) => (a.transactionName ?? '').localeCompare(b.transactionName ?? ''))
                .slice(0, showAllRules ? undefined : 5)
                .map(rule => (
                <tr key={rule.id} className={`${rule.isActive ? 'bg-white' : 'bg-gray-50 opacity-60'}`}>
                  <td className="px-3 py-2">
                    {editingId === rule.id ? (
                      <input
                        type="text"
                        className="form-input text-sm py-1 w-full font-mono"
                        value={editPattern}
                        onChange={e => setEditPattern(e.target.value)}
                        autoFocus
                      />
                    ) : (
                      <code className="text-xs bg-gray-100 rounded px-1.5 py-0.5 text-gray-800">
                        {rule.pattern}
                      </code>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {rule.transactionName ?? <span className="italic text-gray-400">(item deleted)</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-500 text-xs">
                    {editingId === rule.id ? (
                      <div className="space-y-2 min-w-[160px]">
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input type="checkbox" checked={editRestrictToAccount} onChange={e => setEditRestrictToAccount(e.target.checked)} className="rounded" />
                          <span className="text-xs">Restrict to</span>
                        </label>
                        <MultiSelectDropdown
                          options={accounts.map(a => ({ id: a.id, label: a.name }))}
                          selected={editAccountIds}
                          onChange={setEditAccountIds}
                          placeholder="Select accounts…"
                          disabled={!editRestrictToAccount}
                        />
                      </div>
                    ) : (
                      rule.restrictToAccount
                        ? <span className="text-blue-600">{(rule.accountIds ?? []).length > 0 ? (rule.accountIds ?? []).map(aid => accounts.find((a: Account) => a.id === aid)?.name ?? aid).join(', ') : 'specific account'}</span>
                        : <span className="text-gray-400">All accounts</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-500 text-xs">{rule.matchCount ?? 0}</td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={rule.isActive}
                      onChange={() => toggleActive(rule)}
                      className="rounded"
                      title={rule.isActive ? 'Disable rule' : 'Enable rule'}
                    />
                  </td>
                  <td className="px-3 py-2">
                    {editingId === rule.id ? (
                      <div className="flex gap-2">
                        <button
                          className="text-xs text-blue-600 hover:text-blue-800 underline"
                          onClick={() => saveEdit(rule)}
                          disabled={saving || !editPattern.trim()}
                        >
                          {saving ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          className="text-xs text-gray-500 hover:text-gray-700 underline"
                          onClick={cancelEdit}
                          disabled={saving}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          className="text-xs text-blue-600 hover:text-blue-800 underline"
                          onClick={() => startEdit(rule)}
                        >
                          Edit
                        </button>
                        <button
                          className="text-xs text-red-600 hover:text-red-800 underline"
                          onClick={() => deleteRule(rule.id)}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rules.filter(rule => {
            if (!selectedAccountId) return true
            if (!rule.restrictToAccount) return true
            return (rule.accountIds ?? []).includes(selectedAccountId)
          }).length > 5 && (
            <button
              onClick={() => setShowAllRules(v => !v)}
              className="mt-2 text-sm text-blue-600 hover:text-blue-800 underline"
            >
              {showAllRules ? 'Show less' : `Show all (${rules.filter(rule => {
                if (!selectedAccountId) return true
                if (!rule.restrictToAccount) return true
                return (rule.accountIds ?? []).includes(selectedAccountId)
              }).length})`}
            </button>
          )}
        </div>
      )}

      {/* Suppressed items */}
      {suppressed.length > 0 && (
        <div className="mt-6 border-t pt-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Rule suggestions disabled</h3>
          <p className="text-xs text-gray-500 mb-3">
            These budget items will never prompt for a new rule. Click Re-enable to allow suggestions again.
          </p>
          <div className="space-y-1">
            {suppressed.map(s => (
              <div key={s.transactionId} className="flex items-center justify-between py-1.5 px-3 bg-gray-50 rounded text-sm">
                <span className="text-gray-700">{s.transactionName}</span>
                <button
                  className="text-xs text-blue-600 hover:text-blue-800 underline"
                  onClick={() => reenableSuggestions(s.transactionId)}
                >
                  Re-enable
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Analyse-history result modal */}
      {analyzeResult && (
        <RuleSuggestionModal
          transactionName={analyzeResult.transactionName}
          suggestedPattern={analyzeResult.suggestedPattern}
          examples={analyzeResult.examples}
          currentAccountId=""
          allAccounts={accounts}
          existingRuleId={null}
          onConfirm={async ({ pattern, restrictToAccount, accountIds: ruleAccountIds, ruleId }) => {
            try {
              if (ruleId) {
                const updated = await rulesApi.update(ruleId, { pattern, restrictToAccount, accountIds: ruleAccountIds })
                setRules(prev => prev.map(r => r.id === updated.id ? updated : r))
              } else {
                const created = await rulesApi.create({
                  transactionId: analyzeResult.transactionId,
                  accountIds: ruleAccountIds,
                  restrictToAccount,
                  pattern,
                  categoryId: analyzeResult.categoryId,
                })
                setRules(prev => [created, ...prev])
              }
            } catch { setError('Failed to save rule') }
            setAnalyzeResult(null)
          }}
          onDismiss={() => setAnalyzeResult(null)}
          onDisable={async () => {
            try {
              await rulesApi.disableSuggestions(analyzeResult.transactionId)
              setSuppressed(prev => [...prev, { transactionId: analyzeResult.transactionId, transactionName: analyzeResult.transactionName }])
            } catch { /* ignore */ }
            setAnalyzeResult(null)
          }}
        />
      )}
    </>
  )

  return inline ? inner : <div className="card">{inner}</div>
}

export default RulesManager
