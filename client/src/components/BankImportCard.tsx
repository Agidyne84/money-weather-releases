import React, { useState, useRef, useCallback, useLayoutEffect, useMemo, useEffect } from 'react'
import { Account, Transaction, ForecastTransaction, Category } from '../types'
import { importApi, accountsApi, historyApi, transactionsApi, rulesApi, RuleExamplesResult, ImportRule } from '../services/database'
import { formatDateForDisplay, createSafeDate } from '../utils/dateUtils'
import CategorySelector from './CategorySelector'
import RuleSuggestionModal from './RuleSuggestionModal'
import CommitSummaryModal from './CommitSummaryModal'
import RulesManager from './RulesManager'
import MultiSelectDropdown from './MultiSelectDropdown'

interface RuleMatchInfo {
  ruleId: string
  transactionId: string | null
  categoryId: string
  pattern: string
  transactionName: string | null
}

interface BankRow {
  id: string
  date: string
  amount: number
  description: string
  isDuplicate: boolean
  ruleMatch?: RuleMatchInfo | null
}

interface RowAssignment {
  budgetTransactionId: string
  occurrenceDate: string
  excluded: boolean
  ruleMatched?: boolean
}

interface BankImportCardProps {
  accounts: Account[]
  budgetTransactions: Transaction[]
  forecastTransactions: ForecastTransaction[]
  historyData: any[]
  onImportComplete: () => void
  onHistoryChange?: () => void
  categories?: Category[]
}

const BankImportCard: React.FC<BankImportCardProps> = ({
  accounts,
  budgetTransactions,
  forecastTransactions,
  historyData,
  onImportComplete,
  onHistoryChange,
  categories = [],
}) => {
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [fileName, setFileName] = useState('')
  const [columnMapping, setColumnMapping] = useState<{ date: string; amount: string; description: string }>({ date: '', amount: '', description: '' })
  const [parsedRows, setParsedRows] = useState<BankRow[]>([])
  const [assignments, setAssignments] = useState<Record<string, RowAssignment>>({})

  // Bank descriptions currently assigned in this session, keyed by budgetTransactionId
  const sessionDescriptions = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const row of parsedRows) {
      const assign = assignments[row.id]
      if (assign?.budgetTransactionId && !assign.excluded) {
        if (!map[assign.budgetTransactionId]) map[assign.budgetTransactionId] = []
        map[assign.budgetTransactionId].push(row.description)
      }
    }
    return map
  }, [parsedRows, assignments])

  // Descriptions already rule-matched to OTHER budget items — the negative corpus for Tier-2
  const sessionNegatives = useMemo(() => {
    const negs: string[] = []
    for (const row of parsedRows) {
      const assign = assignments[row.id]
      if (assign?.ruleMatched && assign.budgetTransactionId) {
        negs.push(row.description)
      }
    }
    return negs
  }, [parsedRows, assignments])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [committed, setCommitted] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [editingGroupedRowId, setEditingGroupedRowId] = useState<string | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)
  const dragCounter = useRef(0)
  const rowIdCounter = useRef(0)
  const lastTouchedRef = useRef<Record<string, number>>({})
  // Full-table FLIP: snapshot of every data-row-id row's top before a commit.
  const flipFirstRef = useRef<Map<string, number> | null>(null)
  // Group whose newly-inserted content should fade in after the shift settles.
  const fadeInGroupKeyRef = useRef<string | null>(null)
  // During a hand-off, the leaving group fades out before unmount, and the
  // incoming owner stays a plain row until the fade completes.
  const [fadingGroupKey, setFadingGroupKey] = useState<string | null>(null)
  const [incomingOwnerRowId, setIncomingOwnerRowId] = useState<string | null>(null)
  // Inline form for creating a new budget item from a bank row
  const [newBudgetForm, setNewBudgetForm] = useState<{
    rowId: string
    name: string
    categoryId: string
    error: string
    saving: boolean
  } | null>(null)
  // Rule auto-assignment: 'auto' = pre-fill assignments, 'suggest' = show badge only
  const [ruleMode, setRuleMode] = useState<'auto' | 'suggest'>('auto')
  // Pending rule suggestion modal
  const [ruleSuggestion, setRuleSuggestion] = useState<{
    transactionId: string
    transactionName: string
    categoryId: string
    accountId: string
    accountName: string
    examples: RuleExamplesResult['examples']
    suggestedPattern: string
    existingRuleId: string | null
  } | null>(null)
  // Pre-commit summary modal
  const [showCommitSummary, setShowCommitSummary] = useState(false)
  // Track rows where user explicitly rejected the rule suggestion
  const [rejectedSuggestionRows, setRejectedSuggestionRows] = useState<Set<string>>(new Set())
  // Cache examples API responses per transactionId to avoid duplicate requests
  const examplesCache = useRef<Record<string, RuleExamplesResult>>({})
  // Track which transactionIds have already triggered a suggestion this session
  const shownSuggestions = useRef<Set<string>>(new Set())
  // Accumulate bank descriptions assigned to each budget item this session (ref = no stale closure)
  const sessionDescriptionMap = useRef<Record<string, string[]>>({})
  // Keep the last parsed file so changing account can trigger a re-parse
  const lastFileRef = useRef<File | null>(null)
  // Incremented to force RulesManager to reload after a quick-rule save
  const [rulesRefreshKey, setRulesRefreshKey] = useState(0)
  // Track whether the inline Auto-assign Rules section is visible on-screen
  const [rulesVisible, setRulesVisible] = useState(true)
  const rulesSectionRef = useRef<HTMLDivElement>(null)
  // Floating quick-rule panel state
  const [showQuickRule, setShowQuickRule] = useState(false)
  const [qrTransactionId, setQrTransactionId] = useState('')
  const [qrPattern, setQrPattern] = useState('')
  const [qrRestrictToAccount, setQrRestrictToAccount] = useState(false)
  const [qrAccountIds, setQrAccountIds] = useState<string[]>([])
  const [qrSaving, setQrSaving] = useState(false)
  const [qrError, setQrError] = useState('')

  useEffect(() => {
    const el = rulesSectionRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => setRulesVisible(entry.isIntersecting),
      { threshold: 0 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [parsedRows.length]) // re-attach when section mounts/unmounts

  const saveQuickRule = async () => {
    if (!qrTransactionId || !qrPattern.trim()) return
    const tx = budgetTransactions.find(t => t.id === qrTransactionId)
    if (!tx) return
    setQrSaving(true)
    setQrError('')
    try {
      const newRule = await rulesApi.create({
        transactionId: qrTransactionId,
        pattern: qrPattern.trim(),
        categoryId: tx.categoryId,
        restrictToAccount: qrRestrictToAccount,
        accountIds: qrRestrictToAccount ? qrAccountIds : [],
      })
      setQrTransactionId('')
      setQrPattern('')
      setQrRestrictToAccount(false)
      setQrAccountIds([])
      setShowQuickRule(false)
      setRulesRefreshKey(k => k + 1)
      handleApplyAllRules([newRule])
    } catch (e: any) {
      setQrError(e?.response?.data?.error ?? 'Failed to save rule')
    } finally {
      setQrSaving(false)
    }
  }

  const nextRowId = useCallback(() => {
    rowIdCounter.current += 1
    return `row_${Date.now()}_${rowIdCounter.current}`
  }, [])

  const handleFile = async (file: File, accountId?: string) => {
    const effectiveAccountId = accountId || selectedAccountId
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Please upload a CSV file')
      return
    }
    setError('')
    setFileName(file.name)
    setCommitted(false)
    setParsedRows([])
    setAssignments({})
    lastFileRef.current = file

    if (!effectiveAccountId) {
      setPendingFile(file)
      setError('Please select an account first')
      return
    }
    setPendingFile(null)

    const text = await file.text()

    setLoading(true)
    try {
      const result = await importApi.preview(text, effectiveAccountId)
      setColumnMapping({
        date: result.savedMapping?.dateColumn || result.detectedColumns.date || '',
        amount: result.savedMapping?.amountColumn || result.detectedColumns.amount || '',
        description: result.savedMapping?.descriptionColumn || result.detectedColumns.description || '',
      })
      rowIdCounter.current = 0
      examplesCache.current = {}
      shownSuggestions.current = new Set()
      sessionDescriptionMap.current = {}
      setRejectedSuggestionRows(new Set())

      const newRows: BankRow[] = result.rows.map((r: any) => ({
        id: nextRowId(),
        date: r.date,
        amount: r.amount,
        description: r.description,
        isDuplicate: r.isDuplicate,
        ruleMatch: r.ruleMatch ?? null,
      }))
      setParsedRows(newRows)

      // Apply rule-based auto-assignments when in 'auto' mode
      const initialAssignments = newRows.reduce((acc: Record<string, RowAssignment>, r: BankRow) => {
        const match = r.ruleMatch
        let budgetTxId = ''
        let ruleMatched = false
        if (match?.transactionId && ruleMode === 'auto' && !r.isDuplicate) {
          budgetTxId = match.transactionId
          ruleMatched = true
        }
        acc[r.id] = { budgetTransactionId: budgetTxId, occurrenceDate: '', excluded: r.isDuplicate, ruleMatched }
        return acc
      }, {})

      // For rule-matched rows, resolve the closest occurrence date up-front
      // (forecastTransactions may not yet reflect newly created budget items, so we do
      //  a best-effort pass here; the user can always adjust via the date dropdown)
      setParsedRows(newRows)
      setAssignments(initialAssignments)
      lastTouchedRef.current = {}

      // Resolve occurrence dates for rule-auto-assigned rows after state settles
      // (uses a micro-task so that parsedRows / assignments are available in the
      //  next render before we attempt a second pass)
      const autoRows = newRows.filter(r => initialAssignments[r.id]?.ruleMatched && !r.isDuplicate)
      if (autoRows.length > 0) {
        setTimeout(() => {
          setAssignments(prev => {
            const next = { ...prev }
            for (const r of autoRows) {
              const budgetTxId = next[r.id]?.budgetTransactionId
              if (!budgetTxId) continue
              const occs = getOccurrenceDates(budgetTxId)
              if (occs.length === 0) continue
              const closest = occs.reduce((best, occ) => {
                const diff = Math.abs(new Date(occ.date).getTime() - new Date(r.date).getTime())
                const bestDiff = Math.abs(new Date(best.date).getTime() - new Date(r.date).getTime())
                return diff < bestDiff ? occ : best
              })
              next[r.id] = { ...next[r.id], occurrenceDate: closest.date }
            }
            return next
          })
        }, 0)
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to preview CSV')
    } finally {
      setLoading(false)
    }
  }

  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current += 1
    setIsDragOver(true)
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current -= 1
    if (dragCounter.current <= 0) {
      dragCounter.current = 0
      setIsDragOver(false)
    }
  }, [])

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current = 0
    setIsDragOver(false)
    if (e.dataTransfer.files?.[0]) {
      handleFile(e.dataTransfer.files[0])
    }
  }, [selectedAccountId])

  const getOccurrenceDates = (budgetTxId: string): { date: string; filled: boolean; label: string }[] => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayStr = today.toISOString().split('T')[0]

    const forecastStartDate = forecastTransactions.length > 0
      ? forecastTransactions.reduce((min, ftx) => ftx.date < min ? ftx.date : min, forecastTransactions[0].date)
      : today
    const forecastStartStr = forecastStartDate.toISOString().split('T')[0]

    const results: { date: string; filled: boolean; label: string }[] = []
    const seen = new Set<string>()

    // Forecast occurrences
    const forecastDates = forecastTransactions
      .filter(ftx => ftx.transactionId === budgetTxId)
      .map(ftx => ftx.date.toISOString().split('T')[0])
      .filter((d, i, arr) => arr.indexOf(d) === i)
      .sort()

    const forecastBeforeToday = forecastDates.filter(d => d <= todayStr)
    const forecastAfterToday = forecastDates.filter(d => d > todayStr)
    // Cap future forecast dates at 2 closest to today
    const forecastAfterTodayCapped = forecastAfterToday.slice(0, 2)

    ;[...forecastBeforeToday, ...forecastAfterTodayCapped].forEach(d => {
      if (!seen.has(d)) {
        seen.add(d)
        const hasHistory = historyData.some(
          (h: any) => h.transactionId === budgetTxId && new Date(h.date).toISOString().split('T')[0] === d && !h.isExcluded
        )
        results.push({ date: d, filled: hasHistory, label: `${formatDateForDisplay(d)} (forecast)` })
      }
    })

    // Historical occurrences
    const historyDates = historyData
      .filter((h: any) => h.transactionId === budgetTxId && !h.isExcluded)
      .map((h: any) => new Date(h.date).toISOString().split('T')[0])
      .filter((d, i, arr) => arr.indexOf(d) === i)
      .sort()

    const historyBeforeForecastStart = historyDates.filter(d => d < forecastStartStr)
    const historyAfterForecastStart = historyDates.filter(d => d >= forecastStartStr)
    // Cap pre-forecast history dates at 2 most recent before forecast start
    const historyBeforeForecastStartCapped = historyBeforeForecastStart.slice(-2)

    ;[...historyBeforeForecastStartCapped, ...historyAfterForecastStart].forEach(d => {
      if (!seen.has(d)) {
        seen.add(d)
        results.push({ date: d, filled: true, label: `${formatDateForDisplay(d)} (history)` })
      }
    })

    return results.sort((a, b) => a.date.localeCompare(b.date))
  }

  const getClosestUnfilledDate = (bankRowDate: string, budgetTxId: string): string | null => {
    const occs = getOccurrenceDates(budgetTxId)
    if (occs.length === 0) return null

    const bankTime = new Date(bankRowDate).getTime()
    let closest = occs[0]
    let closestDiff = Math.abs(new Date(closest.date).getTime() - bankTime)
    for (const occ of occs.slice(1)) {
      const diff = Math.abs(new Date(occ.date).getTime() - bankTime)
      if (diff < closestDiff) {
        closest = occ
        closestDiff = diff
      }
    }
    return closest.date
  }

  // Snapshot the top of every persistent (data-row-id) row so the layout effect
  // can run a full-table FLIP after React commits the next render.
  const snapshotRowPositions = (): Map<string, number> => {
    const map = new Map<string, number>()
    document.querySelectorAll('tr[data-row-id]').forEach(el => {
      const id = (el as HTMLElement).dataset.rowId
      if (id) map.set(id, el.getBoundingClientRect().top)
    })
    return map
  }

  // Arm a FLIP: cancel in-flight animations, snapshot current positions, and note
  // which group's freshly-inserted content should fade in once the shift settles.
  const beginFlip = (fadeInGroupKey?: string) => {
    document.querySelectorAll('tbody tr').forEach(tr => {
      ;(tr as HTMLElement).getAnimations().forEach(a => a.cancel())
    })
    flipFirstRef.current = snapshotRowPositions()
    fadeInGroupKeyRef.current = fadeInGroupKey ?? null
  }

  const FADE_MS = 525

  // Fade-out applied to every row of the group that is leaving during a hand-off.
  const groupFadeStyle = (gk: string): React.CSSProperties | undefined =>
    fadingGroupKey === gk ? { transition: `opacity ${FADE_MS}ms ease-out`, opacity: 0 } : undefined

  const handleCreateNewBudgetItem = (rowId: string) => {
    const bankRow = parsedRows.find(r => r.id === rowId)
    if (!bankRow) return
    setNewBudgetForm({
      rowId,
      name: bankRow.description,
      categoryId: '',
      error: '',
      saving: false,
    })
  }

  const handleSaveNewBudgetItem = async () => {
    if (!newBudgetForm) return
    if (!newBudgetForm.name.trim()) {
      setNewBudgetForm(prev => prev ? { ...prev, error: 'Name is required' } : null)
      return
    }
    if (!newBudgetForm.categoryId) {
      setNewBudgetForm(prev => prev ? { ...prev, error: 'Category is required' } : null)
      return
    }
    setNewBudgetForm(prev => prev ? { ...prev, saving: true, error: '' } : null)

    const bankRow = parsedRows.find(r => r.id === newBudgetForm.rowId)
    if (!bankRow) return

    try {
      const newTx = await transactionsApi.create({
        name: newBudgetForm.name.trim(),
        amount: 0,
        type: 'expense',
        frequency: { value: 1, unit: 'months' },
        startDate: createSafeDate(bankRow.date),
        categoryId: newBudgetForm.categoryId,
        accountId: selectedAccountId,
        isTransfer: false,
        isActive: true,
      })

      setAssignments(prev => ({
        ...prev,
        [newBudgetForm.rowId]: {
          budgetTransactionId: newTx.id,
          occurrenceDate: bankRow.date,
          excluded: prev[newBudgetForm.rowId]?.excluded ?? false,
        },
      }))

      setNewBudgetForm(null)
      onHistoryChange?.()
    } catch (err: any) {
      console.error('Failed to create budget item:', err)
      setNewBudgetForm(prev => prev ? {
        ...prev,
        saving: false,
        error: err?.response?.data?.error || err?.message || 'Failed to create budget item',
      } : null)
    }
  }

  const handleBudgetItemSelect = (rowId: string, value: string) => {
    if (value === '__new__') {
      handleCreateNewBudgetItem(rowId)
      return
    }
    handleAssignBudgetItem(rowId, value)
  }

  const handleAssignBudgetItem = (rowId: string, budgetTxId: string) => {
    const bankRow = parsedRows.find(r => r.id === rowId)!
    const closestDate = budgetTxId ? getClosestUnfilledDate(bankRow.date, budgetTxId) : null
    const groupKey = `${budgetTxId}::${closestDate || ''}`

    // Accumulate the description into the session map NOW (before any early return)
    // so the rule check always sees fresh data regardless of React state timing.
    if (budgetTxId && bankRow.description) {
      if (!sessionDescriptionMap.current[budgetTxId]) {
        sessionDescriptionMap.current[budgetTxId] = []
      }
      const existing = sessionDescriptionMap.current[budgetTxId]
      if (!existing.includes(bankRow.description)) {
        existing.push(bankRow.description)
      }
    }

    const commit = () => {
      setAssignments(prev => ({
        ...prev,
        [rowId]: {
          budgetTransactionId: budgetTxId,
          occurrenceDate: closestDate || '',
          excluded: prev[rowId]?.excluded ?? false,
        },
      }))
      lastTouchedRef.current[rowId] = Date.now()
    }

    // Hand-off: another row currently owns (displays) this exact group. Fade its
    // group out first so the user sees the data leave the old row before it
    // re-appears under the newly assigned row.
    const losingRowId = budgetTxId && closestDate
      ? parsedRows.find(r => r.id !== rowId && isLatestAssignedRow(r.id, budgetTxId, closestDate))?.id
      : undefined

    if (losingRowId) {
      // Keep the incoming row a plain row (assignment recorded so its select
      // shows the choice) until the old group has faded out. Pin its lastTouched
      // to 0 so the leaving row stays the group owner during the fade even if the
      // incoming row was assigned (touched) more recently elsewhere.
      lastTouchedRef.current[rowId] = 0
      setIncomingOwnerRowId(rowId)
      setFadingGroupKey(groupKey)
      setAssignments(prev => ({
        ...prev,
        [rowId]: {
          budgetTransactionId: budgetTxId,
          occurrenceDate: closestDate || '',
          excluded: prev[rowId]?.excluded ?? false,
        },
      }))
      window.setTimeout(() => {
        beginFlip(groupKey)
        setFadingGroupKey(null)
        setIncomingOwnerRowId(null)
        lastTouchedRef.current[rowId] = Date.now()
        setAssignments(prev => ({ ...prev }))
      }, FADE_MS)
      // Still check for a rule suggestion even in the hand-off case
      if (budgetTxId) checkRuleSuggestion(budgetTxId)
      return
    }

    beginFlip(groupKey)
    commit()

    if (budgetTxId) checkRuleSuggestion(budgetTxId)
  }

  const applyRuleToCurrentBatch = (
    transactionId: string,
    pattern: string,
    restrictToAccount: boolean,
    ruleAccountIds: string[],
  ) => {
    const normalize = (s: string) =>
      s.toLowerCase().replace(/\d+/g, ' ').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()
    const normPattern = normalize(pattern)
    if (!normPattern) return

    const matchingUnassigned = parsedRows.filter(r => {
      const assign = assignments[r.id]
      if (assign?.excluded || assign?.budgetTransactionId) return false
      if (restrictToAccount && ruleAccountIds.length > 0 && !ruleAccountIds.includes(selectedAccountId)) return false
      return normalize(r.description).includes(normPattern)
    })

    if (matchingUnassigned.length === 0) return

    // Update assignments for matched rows
    setAssignments(prev => {
      const next = { ...prev }
      for (const r of matchingUnassigned) {
        const closestDate = getClosestUnfilledDate(r.date, transactionId) || ''
        next[r.id] = {
          budgetTransactionId: transactionId,
          occurrenceDate: closestDate,
          excluded: false,
          ruleMatched: true,
        }
      }
      return next
    })

    // Update parsedRows so the ⚡ badge tooltip shows the correct pattern
    setParsedRows(prev =>
      prev.map(r => {
        if (matchingUnassigned.some(m => m.id === r.id)) {
          return {
            ...r,
            ruleMatch: {
              ruleId: 'pending',
              transactionId,
              categoryId: '',
              pattern,
              transactionName: null,
            },
          }
        }
        return r
      })
    )
  }

  const handleRuleConfirm = async (params: {
    pattern: string
    restrictToAccount: boolean
    accountIds: string[]
    ruleId: string | null
  }) => {
    if (!ruleSuggestion) return
    const { pattern, restrictToAccount, accountIds: ruleAccountIds, ruleId } = params
    try {
      if (ruleId) {
        await rulesApi.update(ruleId, { pattern, restrictToAccount, accountIds: ruleAccountIds })
      } else {
        await rulesApi.create({
          transactionId: ruleSuggestion.transactionId,
          accountIds: ruleAccountIds,
          restrictToAccount,
          pattern,
          categoryId: ruleSuggestion.categoryId,
        })
      }
      // Apply the confirmed rule to any currently unassigned rows in this batch
      applyRuleToCurrentBatch(ruleSuggestion.transactionId, pattern, restrictToAccount, ruleAccountIds)
    } catch { /* non-critical */ }
    setRuleSuggestion(null)
  }

  const checkRuleSuggestion = async (transactionId: string) => {
    if (shownSuggestions.current.has(transactionId)) return

    const budgetTx = budgetTransactions.find(t => t.id === transactionId)
    if (!budgetTx) return

    // Read committed examples from server (cached per session file load)
    let serverResult = examplesCache.current[transactionId]
    if (!serverResult) {
      try {
        serverResult = await rulesApi.getExamples(transactionId)
        examplesCache.current[transactionId] = serverResult
      } catch {
        return // non-critical
      }
    }

    if (serverResult.suggestionsSuppressed) return
    if (serverResult.existingRule) return // don't re-suggest when a rule already exists

    // Descriptions assigned this session (from the ref — never stale)
    const sessionDescriptions = sessionDescriptionMap.current[transactionId] ?? []

    const allDescriptions = [
      ...serverResult.examples.map(e => e.bankDescription),
      ...sessionDescriptions,
    ]

    if (allDescriptions.length < 3) return

    // Compute LCS from the combined description list via the server
    let pattern: string | null = null
    try {
      const suggestion = await rulesApi.suggestPattern(allDescriptions)
      pattern = suggestion.pattern
    } catch {
      return // non-critical
    }

    if (!pattern) return // no common substring found — no rule to suggest

    shownSuggestions.current.add(transactionId)

    const account = accounts.find(a => a.id === selectedAccountId)
    const today = new Date().toISOString().split('T')[0]
    setRuleSuggestion({
      transactionId,
      transactionName: budgetTx.name,
      categoryId: budgetTx.categoryId,
      accountId: selectedAccountId,
      accountName: account?.name ?? selectedAccountId,
      examples: [
        ...serverResult.examples,
        ...sessionDescriptions.map(d => ({
          bankDescription: d,
          accountId: selectedAccountId,
          amount: 0,
          date: today,
        })),
      ],
      suggestedPattern: pattern,
      existingRuleId: null,
    })
  }

  // Run a full-table FLIP synchronously after React commits the next render but
  // before the browser paints, so rows glide to their new positions (down when a
  // group expands, up when one collapses) instead of snapping.
  useLayoutEffect(() => {
    const first = flipFirstRef.current
    if (!first) return
    flipFirstRef.current = null
    const fadeInGroupKey = fadeInGroupKeyRef.current
    fadeInGroupKeyRef.current = null

    const SHIFT_MS = 525

    // Canonical FLIP via inline transform + forced reflow + CSS transition.
    // Firefox skips WAAPI keyframe animations created in a layout effect unless
    // the inverted start state is committed (with a reflow) before transitioning.
    const flipRow = (el: HTMLElement, fromOffset: number) => {
      el.style.transition = 'none'
      el.style.transform = `translateY(${fromOffset}px)`
      // Force reflow so the inverted position is committed before transitioning.
      void el.offsetHeight
      el.style.transition = `transform ${SHIFT_MS}ms ease-out`
      el.style.transform = 'translateY(0px)'
      const cleanup = () => {
        el.style.transition = ''
        el.style.transform = ''
        el.removeEventListener('transitionend', cleanup)
      }
      el.addEventListener('transitionend', cleanup)
    }

    // Pin to the bottom: hold the lowest pre-existing row at its on-screen
    // position so the table grows upward (rows below stay fixed) rather than
    // pushing content down. The scroll shift is compensated by the FLIP
    // transforms applied in this same frame, so there is no visible jump.
    let anchorId: string | undefined
    let anchorEl: HTMLElement | undefined
    document.querySelectorAll('tr[data-row-id]').forEach(el => {
      const node = el as HTMLElement
      const id = node.dataset.rowId
      if (id && first.has(id)) {
        anchorId = id
        anchorEl = node
      }
    })
    if (anchorEl && anchorId) {
      const anchorDelta = (anchorEl as HTMLElement).getBoundingClientRect().top - (first.get(anchorId) as number)
      if (Math.abs(anchorDelta) > 1) window.scrollBy(0, anchorDelta)
    }

    // Every row that existed before and after the commit glides from its old top
    // to its new top. New rows (no prior position) are left to the fade-in below.
    document.querySelectorAll('tr[data-row-id]').forEach(el => {
      const node = el as HTMLElement
      const id = node.dataset.rowId
      if (!id) return
      const oldTop = first.get(id)
      if (oldTop === undefined) return
      const delta = oldTop - node.getBoundingClientRect().top
      if (Math.abs(delta) > 1) flipRow(node, delta)
    })

    // Fade in grouped content AFTER the row-shift completes. fill:'both' keeps
    // opacity 0 applied during the delay so it stays hidden (no blink).
    if (fadeInGroupKey) {
      document.querySelectorAll(`tr[data-group-key="${fadeInGroupKey}"]:not([data-row-id])`).forEach(el => {
        ;(el as HTMLElement).animate(
          [
            { opacity: 0 },
            { opacity: 1 },
          ],
          { duration: 350, delay: SHIFT_MS, easing: 'ease-out', fill: 'both' }
        )
      })
    }
  })

  const handleAssignDate = (rowId: string, date: string) => {
    const budgetTxId = assignments[rowId]?.budgetTransactionId || ''
    beginFlip(`${budgetTxId}::${date}`)

    setAssignments(prev => ({
      ...prev,
      [rowId]: {
        ...prev[rowId],
        occurrenceDate: date,
      },
    }))
    lastTouchedRef.current[rowId] = Date.now()
  }

  const toggleExcluded = (rowId: string) => {
    const row = parsedRows.find(r => r.id === rowId)
    const isCurrentlyExcluded = assignments[rowId]?.excluded ?? false
    // If this is a duplicate row and the user is trying to INCLUDE it, warn first.
    if (row?.isDuplicate && isCurrentlyExcluded) {
      const ok = window.confirm(
        'This transaction appears to have already been imported.\n\n' +
        'Are you sure you want to import it again?'
      )
      if (!ok) return
    }
    setAssignments(prev => ({
      ...prev,
      [rowId]: {
        ...prev[rowId],
        excluded: !isCurrentlyExcluded,
      },
    }))
  }

  const handleSelectAll = () => {
    const allIncluded = parsedRows.length > 0 && parsedRows.every(r => !assignments[r.id]?.excluded)
    setAssignments(prev => {
      const next: Record<string, RowAssignment> = { ...prev }
      parsedRows.forEach(r => {
        const existing = next[r.id]
        next[r.id] = {
          budgetTransactionId: existing?.budgetTransactionId || '',
          occurrenceDate: existing?.occurrenceDate || '',
          excluded: allIncluded,
        }
      })
      return next
    })
  }

  const getGroupedHistoryRows = (budgetTxId: string, occDate: string, currentRowId: string): any[] => {
    const existing = historyData.filter((h: any) => {
      const hDate = new Date(h.date).toISOString().split('T')[0]
      return h.transactionId === budgetTxId && hDate === occDate && !h.isExcluded
    }).map((h: any) => ({
      ...h,
      sourceType: h.bankDescription ? 'bank' : h.isManualEdit ? 'manual' : 'history',
    }))
    // Synthetic entries for other parsed rows assigned to the same pair
    const siblingRows = parsedRows.filter(r => {
      if (r.id === currentRowId) return false
      if (r.id === incomingOwnerRowId) return false
      const a = assignments[r.id]
      return a?.budgetTransactionId === budgetTxId && a?.occurrenceDate === occDate && !a?.excluded
    })
    const synthetic = siblingRows.map(r => ({
      id: `pending-${r.id}`,
      transactionId: budgetTxId,
      date: occDate,
      description: r.description,
      amount: r.amount,
      sourceType: 'bank',
    }))
    const all = [...existing, ...synthetic]
    // The current row (the bank row displaying this group) is itself a bank source,
    // so grouped history rows should be superseded even when no siblings exist yet.
    const currentRowIsBankSource = parsedRows.some(r => r.id === currentRowId)
    const hasBankOrManual = currentRowIsBankSource || all.some((h: any) => h.sourceType === 'bank' || h.sourceType === 'manual')
    return all.map((h: any) => ({
      ...h,
      superseded: (h.sourceType === 'history' || h.sourceType === 'forecast') && hasBankOrManual,
    }))
  }

  const isLatestAssignedRow = (rowId: string, budgetTxId: string, occDate: string): boolean => {
    if (!budgetTxId || !occDate) return false
    const candidates = parsedRows.filter(r => {
      const a = assignments[r.id]
      return a?.budgetTransactionId === budgetTxId && a?.occurrenceDate === occDate && !a?.excluded
    })
    if (candidates.length === 0) return false
    let latestRow = candidates[0]
    let latestTime = lastTouchedRef.current[latestRow.id] || 0
    for (let i = 1; i < candidates.length; i++) {
      const t = lastTouchedRef.current[candidates[i].id] || 0
      if (t > latestTime) {
        latestTime = t
        latestRow = candidates[i]
      }
    }
    return latestRow.id === rowId
  }

  const buildRowsToCommit = () =>
    parsedRows
      .map((bankRow) => {
        const assign = assignments[bankRow.id]
        if (!assign) return null
        if (assign.excluded) return null
        if (!assign.budgetTransactionId) return null
        return {
          bankRow,
          budgetTransactionId: assign.budgetTransactionId,
          occurrenceDate: assign.occurrenceDate,
          excluded: false,
          subRowEdits: [],
        }
      })
      .filter(Boolean) as any[]

  const handleCommit = () => {
    if (!selectedAccountId || parsedRows.length === 0) return
    const rowsToCommit = buildRowsToCommit()
    if (rowsToCommit.length === 0) {
      setError('No rows to commit')
      return
    }
    setShowCommitSummary(true)
  }

  const doCommit = async () => {
    setShowCommitSummary(false)
    if (!selectedAccountId || parsedRows.length === 0) return

    const rowsToCommit = buildRowsToCommit()

    if (rowsToCommit.length === 0) {
      setError('No rows to commit')
      return
    }

    const committedRowIds = new Set(rowsToCommit.map((r: any) => r.bankRow.id))
    const allRowsCommitted = committedRowIds.size === parsedRows.length

    // Only send forecast occurrences referenced by committed rows to keep payload small
    const neededKeys = new Set(
      rowsToCommit
        .filter((r: any) => r.budgetTransactionId && r.occurrenceDate)
        .map((r: any) => `${r.budgetTransactionId}|${r.occurrenceDate}`)
    )
    const forecastOccurrences = forecastTransactions
      .map(ftx => ({
        transactionId: ftx.transactionId,
        date: ftx.date.toISOString().split('T')[0],
      }))
      .filter((o: any) => neededKeys.has(`${o.transactionId}|${o.date}`))

    setLoading(true)
    try {
      await importApi.commit({
        accountId: selectedAccountId,
        rows: rowsToCommit,
        forecastOccurrences,
      })
    } catch (err: any) {
      console.error('Commit API error:', err)
      const status = err?.response?.status
      const serverError = err?.response?.data?.error
      const responseText = typeof err?.response?.data === 'string' ? err.response.data : null
      const detail = serverError || responseText || `HTTP ${status || 'unknown'}`
      setError(`Import commit failed: ${detail}`)
      setLoading(false)
      return
    }

    try {
      // Account memory: save mapping to account (stored as JSON string on server)
      await accountsApi.update(selectedAccountId, {
        importSettings: {
          dateFormat: 'auto',
          hasHeaders: true,
          columnMapping: {
            date: 0, amount: 1, description: 2,
          },
        } as any,
      })
    } catch (err: any) {
      console.error('Account settings update error:', err)
      // Non-fatal: import succeeded even if settings save failed
    }

    // Remove the accepted rows from the import list so they appear in History.
    setParsedRows(prev => prev.filter(r => !committedRowIds.has(r.id)))
    setAssignments(prev => {
      const next = { ...prev }
      committedRowIds.forEach(id => delete next[id])
      return next
    })
    committedRowIds.forEach(id => delete lastTouchedRef.current[id])

    onHistoryChange?.()

    if (allRowsCommitted) {
      setCommitted(true)
      setFileName('')
      onImportComplete()
    }

    setLoading(false)
  }

  const handleSplitRow = (rowId: string) => {
    const idx = parsedRows.findIndex(r => r.id === rowId)
    if (idx === -1) return
    const original = parsedRows[idx]

    let firstAmount: number | null = null
    let attempt = 0
    while (firstAmount === null) {
      const defaultValue = attempt === 0 ? (original.amount / 2).toFixed(2) : ''
      const input = window.prompt(
        `Split transaction: ${original.description}\nOriginal amount: ${original.amount.toFixed(2)}\n\nEnter amount for the first new transaction:`,
        defaultValue
      )
      if (input === null) return // user cancelled

      const parsed = parseFloat(input)
      if (isNaN(parsed)) {
        window.alert('Invalid amount entered for split')
      } else if (parsed === 0) {
        window.alert('Split amount cannot be zero')
      } else if (Math.sign(parsed) !== Math.sign(original.amount)) {
        window.alert(`Split amount must have the same sign as the original (${original.amount < 0 ? 'negative' : 'positive'})`)
      } else if (Math.abs(parsed) >= Math.abs(original.amount)) {
        window.alert('Split amount must be smaller than the original amount')
      } else {
        firstAmount = parsed
        break
      }
      attempt++
    }
    if (firstAmount === null) return

    const secondAmount = Math.round((original.amount - firstAmount) * 100) / 100

    const newId1 = nextRowId()
    const newId2 = nextRowId()

    const left = parsedRows.slice(0, idx)
    const right = parsedRows.slice(idx + 1)

    const row1: BankRow = { ...original, id: newId1, amount: firstAmount }
    const row2: BankRow = { ...original, id: newId2, amount: secondAmount }

    setParsedRows([...left, row1, row2, ...right])

    setAssignments(prev => {
      const next: Record<string, RowAssignment> = {}
      left.forEach(r => { if (prev[r.id]) next[r.id] = prev[r.id] })
      next[row1.id] = { budgetTransactionId: '', occurrenceDate: '', excluded: false }
      next[row2.id] = { budgetTransactionId: '', occurrenceDate: '', excluded: false }
      right.forEach(r => { if (prev[r.id]) next[r.id] = prev[r.id] })
      return next
    })
  }

  const handleUpdateRowField = (rowId: string, field: 'amount' | 'description', value: string) => {
    setParsedRows(prev => prev.map(r => {
      if (r.id !== rowId) return r
      if (field === 'amount') {
        const num = parseFloat(value)
        return { ...r, amount: isNaN(num) ? r.amount : num }
      }
      return { ...r, description: value }
    }))
  }

  const getBudgetTransactionName = (id: string) => {
    const tx = budgetTransactions.find(t => t.id === id)
    return tx?.name || 'Unknown'
  }

  const isSyntheticGroupedRow = (h: any): boolean =>
    typeof h.id === 'string' && h.id.startsWith('pending-')

  const getSyntheticRowId = (h: any): string =>
    h.id.replace('pending-', '')

  const handleGroupedRowBudgetChange = async (h: any, newBudgetTxId: string) => {
    if (isSyntheticGroupedRow(h)) {
      const rowId = getSyntheticRowId(h)
      if (!newBudgetTxId) {
        // Clear
        setAssignments(prev => ({
          ...prev,
          [rowId]: { budgetTransactionId: '', occurrenceDate: '', excluded: prev[rowId]?.excluded ?? false },
        }))
      } else {
        const closestDate = getClosestUnfilledDate(h.date, newBudgetTxId)
        setAssignments(prev => ({
          ...prev,
          [rowId]: {
            budgetTransactionId: newBudgetTxId,
            occurrenceDate: closestDate || '',
            excluded: prev[rowId]?.excluded ?? false,
          },
        }))
        lastTouchedRef.current[rowId] = Date.now()
      }
    } else {
      // DB row
      try {
        await historyApi.update(h.id, { transactionId: newBudgetTxId || null })
        onHistoryChange?.()
      } catch (err: any) {
        setError(err?.response?.data?.error || 'Failed to update history row')
      }
    }
    setEditingGroupedRowId(null)
  }

  const handleGroupedRowDelete = async (h: any) => {
    if (isSyntheticGroupedRow(h)) return
    if (!window.confirm('Delete this historical transaction?')) return
    try {
      await historyApi.delete(h.id)
      onHistoryChange?.()
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to delete history row')
    }
  }

  const handleApplyAllRules = useCallback((activeRules: ImportRule[]) => {
    if (activeRules.length === 0 || parsedRows.length === 0) return
    const normalize = (s: string) =>
      s.toLowerCase().replace(/\d+/g, ' ').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()
    setAssignments(prev => {
      const next = { ...prev }
      for (const row of parsedRows) {
        const assign = next[row.id]
        if (assign?.excluded || assign?.budgetTransactionId) continue
        const normDesc = normalize(row.description)
        for (const rule of activeRules) {
          if (!rule.transactionId) continue
          if (rule.restrictToAccount && rule.accountIds.length > 0 && !rule.accountIds.includes(selectedAccountId)) continue
          const normPattern = normalize(rule.pattern)
          if (!normPattern) continue
          if (normDesc.includes(normPattern)) {
            const closestDate = getClosestUnfilledDate(row.date, rule.transactionId) || ''
            next[row.id] = { budgetTransactionId: rule.transactionId, occurrenceDate: closestDate, excluded: false, ruleMatched: true }
            break
          }
        }
      }
      return next
    })
  }, [parsedRows, selectedAccountId, getClosestUnfilledDate])

  return (
    <>
      <div className="card">
      <h3 className="text-lg font-medium text-gray-900 mb-4">Import Bank Data</h3>

      <div className="space-y-4">
          {committed && (
            <div className="p-3 bg-green-50 text-green-700 rounded-md text-sm">
              Import committed successfully!
            </div>
          )}

          {/* Account + File */}
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Account</label>
              <select
                className="form-input"
                value={selectedAccountId}
                onChange={(e) => {
                  const newAccountId = e.target.value
                  setSelectedAccountId(newAccountId)
                  setParsedRows([])
                  setAssignments({})
                  if (pendingFile) {
                    const file = pendingFile
                    setPendingFile(null)
                    handleFile(file, newAccountId)
                  } else if (lastFileRef.current) {
                    handleFile(lastFileRef.current, newAccountId)
                  }
                }}
              >
                <option value="">Select account...</option>
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
            <div
              ref={dropRef}
              className={`flex-1 min-w-[200px] border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
                isDragOver
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-300 hover:border-gray-400'
              }`}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onDragEnter={onDragEnter}
              onDragLeave={onDragLeave}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
              {fileName ? (
                <span className="text-sm text-gray-700">{fileName}</span>
              ) : (
                <span className="text-sm text-gray-500">Drop CSV here or click to choose</span>
              )}
            </div>
          </div>

          {parsedRows.length > 0 && (
            <div ref={rulesSectionRef} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
              <h4 className="text-sm font-semibold text-gray-700 mb-3">Auto-assign Rules</h4>
              <RulesManager
                inline
                refreshKey={rulesRefreshKey}
                sessionDescriptions={sessionDescriptions}
                sessionNegatives={sessionNegatives}
                selectedAccountId={selectedAccountId}
                onApplyRules={handleApplyAllRules}
              />
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 text-red-700 rounded-md text-sm">{error}</div>
          )}

          {/* Column mapping */}
          {parsedRows.length > 0 && (
            <div className="bg-gray-50 rounded-lg p-3 space-y-2">
              <p className="text-sm font-medium text-gray-700">Column Mapping</p>
              <div className="flex flex-wrap gap-3">
                <div>
                  <label className="text-xs text-gray-500">Date</label>
                  <input
                    type="text"
                    className="form-input text-sm py-1"
                    value={columnMapping.date}
                    onChange={(e) => setColumnMapping(prev => ({ ...prev, date: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Amount</label>
                  <input
                    type="text"
                    className="form-input text-sm py-1"
                    value={columnMapping.amount}
                    onChange={(e) => setColumnMapping(prev => ({ ...prev, amount: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Description</label>
                  <input
                    type="text"
                    className="form-input text-sm py-1"
                    value={columnMapping.description}
                    onChange={(e) => setColumnMapping(prev => ({ ...prev, description: e.target.value }))}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Reconciliation table */}
          {parsedRows.length > 0 && (
            <div className="space-y-2">
              {/* Rule-mode banner — visible when any rule-matched auto-assignment exists */}
              {parsedRows.some(r => !r.isDuplicate && r.ruleMatch?.transactionId) && (
                <div className="flex items-center gap-3 bg-yellow-50 border border-yellow-200 rounded px-3 py-2 text-sm">
                  <span className="text-yellow-700 font-medium flex items-center gap-1">
                    ⚡ {ruleMode === 'auto'
                      ? (() => { const n = parsedRows.filter(r => !r.isDuplicate && assignments[r.id]?.ruleMatched).length; return `${n} row${n !== 1 ? 's' : ''} auto-assigned by rule${n === 0 ? ' — all cleared' : ''}` })()
                      : `${parsedRows.filter(r => !r.isDuplicate && r.ruleMatch?.transactionId && !assignments[r.id]?.budgetTransactionId && !rejectedSuggestionRows.has(r.id)).length} row${parsedRows.filter(r => !r.isDuplicate && r.ruleMatch?.transactionId && !assignments[r.id]?.budgetTransactionId && !rejectedSuggestionRows.has(r.id)).length !== 1 ? 's' : ''} with rule suggestions`
                    }
                  </span>
                  <div className="flex gap-2 ml-auto">
                    {ruleMode === 'auto' ? (() => {
                      const activeCount = parsedRows.filter(r => !r.isDuplicate && assignments[r.id]?.ruleMatched).length
                      const applyAll = () => setAssignments(prev => {
                        const next = { ...prev }
                        parsedRows.forEach(r => {
                          if (!r.isDuplicate && r.ruleMatch?.transactionId && !next[r.id]?.budgetTransactionId && !rejectedSuggestionRows.has(r.id)) {
                            const closestDate = getClosestUnfilledDate(r.date, r.ruleMatch.transactionId) || ''
                            next[r.id] = {
                              budgetTransactionId: r.ruleMatch.transactionId,
                              occurrenceDate: closestDate,
                              excluded: next[r.id]?.excluded ?? false,
                              ruleMatched: true,
                            }
                          }
                        })
                        return next
                      })
                      if (activeCount === 0) {
                        return (
                          <button
                            className="text-xs text-yellow-700 underline hover:text-yellow-900"
                            onClick={applyAll}
                          >
                            Apply all rule assignments
                          </button>
                        )
                      }
                      return (
                        <>
                          <button
                            className="text-xs text-yellow-700 underline hover:text-yellow-900"
                            onClick={() => {
                              setRuleMode('suggest')
                              setAssignments(prev => {
                                const next = { ...prev }
                                parsedRows.forEach(r => {
                                  if (next[r.id]?.ruleMatched) {
                                    next[r.id] = { ...next[r.id], budgetTransactionId: '', occurrenceDate: '', ruleMatched: false }
                                  }
                                })
                                return next
                              })
                            }}
                          >
                            Switch to suggest-only
                          </button>
                          <button
                            className="text-xs text-red-600 underline hover:text-red-800"
                            onClick={() => setAssignments(prev => {
                              const next = { ...prev }
                              parsedRows.forEach(r => {
                                if (next[r.id]?.ruleMatched) {
                                  next[r.id] = { ...next[r.id], budgetTransactionId: '', occurrenceDate: '', ruleMatched: false }
                                }
                              })
                              return next
                            })}
                          >
                            Clear all rule assignments
                          </button>
                        </>
                      )
                    })() : (
                      <button
                        className="text-xs text-yellow-700 underline hover:text-yellow-900"
                        onClick={() => {
                          setRuleMode('auto')
                          setAssignments(prev => {
                            const next = { ...prev }
                            parsedRows.forEach(r => {
                              if (!r.isDuplicate && r.ruleMatch?.transactionId && !next[r.id]?.budgetTransactionId && !rejectedSuggestionRows.has(r.id)) {
                                const closestDate = getClosestUnfilledDate(r.date, r.ruleMatch.transactionId) || ''
                                next[r.id] = {
                                  budgetTransactionId: r.ruleMatch.transactionId,
                                  occurrenceDate: closestDate,
                                  excluded: next[r.id]?.excluded ?? false,
                                  ruleMatched: true,
                                }
                              }
                            })
                            return next
                          })
                        }}
                      >
                        Switch to auto-assign
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="flex justify-between items-center">
                <p className="text-sm font-medium text-gray-700">
                  {parsedRows.length} transaction{parsedRows.length !== 1 ? 's' : ''} to reconcile
                </p>
                <div className="flex gap-2">
                  <button
                    className="btn-secondary text-sm py-1 px-3"
                    onClick={() => handleCommit()}
                    disabled={loading}
                  >
                    Accept Selected
                  </button>
                  <button
                    className="btn-primary text-sm py-1 px-3"
                    onClick={() => handleCommit()}
                    disabled={loading}
                  >
                    Accept All
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <style>{`
                  @keyframes growDown {
                    from { transform: scaleY(0); transform-origin: top; }
                    to   { transform: scaleY(1); transform-origin: top; }
                  }
                  @keyframes slideInDown {
                    from { transform: translateY(-12px); }
                    to   { transform: translateY(0); }
                  }
                  @keyframes fadeIn {
                    from { opacity: 0; }
                    to   { opacity: 1; }
                  }
                `}</style>
                <table className="w-full text-sm table-fixed">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-2 py-2 text-left w-10">
                        <input
                          type="checkbox"
                          checked={parsedRows.length > 0 && parsedRows.every(r => !assignments[r.id]?.excluded)}
                          onChange={handleSelectAll}
                          title="Select all"
                        />
                      </th>
                      <th className="px-2 py-2 text-left w-28">Date</th>
                      <th className="px-2 py-2 text-left">Description</th>
                      <th className="px-2 py-2 text-right w-24">Amount</th>
                      <th className="px-2 py-2 text-left w-40">Budget Item</th>
                      <th className="px-2 py-2 text-left w-36">Apply to Date</th>
                      <th className="px-2 py-2 text-left w-20"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {parsedRows
                      .filter((row) => {
                        // During a hand-off the incoming owner stays a plain row.
                        if (row.id === incomingOwnerRowId) return true
                        const a = assignments[row.id]
                        if (!a?.budgetTransactionId || !a?.occurrenceDate) return true
                        // Excluded rows always show as standalone; they don't compete
                        // for group ownership and must remain visible for re-inclusion.
                        if (a?.excluded) return true
                        return isLatestAssignedRow(row.id, a.budgetTransactionId, a.occurrenceDate)
                      })
                      .map((row) => {
                      const assign = assignments[row.id]
                      const showGrouped = row.id !== incomingOwnerRowId
                        && assign?.budgetTransactionId && assign?.occurrenceDate
                        && isLatestAssignedRow(row.id, assign.budgetTransactionId, assign.occurrenceDate)
                      const grouped = showGrouped
                        ? getGroupedHistoryRows(assign.budgetTransactionId, assign.occurrenceDate, row.id)
                        : []

                      const hasGrouped = grouped.length > 0

                      return (
                        <React.Fragment key={row.id}>
                          {hasGrouped ? (() => {
                            const groupKey = `${assign.budgetTransactionId}::${assign.occurrenceDate}`
                            return (
                              <>
                                {/* Placeholder header for the budget item group */}
                                <tr data-group-key={groupKey} style={groupFadeStyle(groupKey)} className="bg-blue-50 border-l-4 border-blue-300">
                                <td colSpan={7} className="px-3 py-2">
                                  <div className="flex items-center gap-2">
                                    {assign?.ruleMatched && (
                                      <span title={`Auto-assigned by rule: "${row.ruleMatch?.pattern ?? ''}"`} className="text-yellow-500 text-xs shrink-0">⚡</span>
                                    )}
                                    <span className="font-medium text-blue-800 text-sm">
                                      {getBudgetTransactionName(assign.budgetTransactionId)}
                                    </span>
                                    <span className="text-blue-600 text-xs">
                                      {formatDateForDisplay(assign.occurrenceDate)}
                                    </span>
                                    <span className="text-blue-400 text-xs">
                                      ({grouped.length + 1} transactions)
                                    </span>
                                  </div>
                                </td>
                              </tr>
                                {/* Current bank row rendered as the first sub-row */}
                                <tr data-group-key={groupKey} style={groupFadeStyle(groupKey)} className={row.isDuplicate ? 'bg-yellow-50/50' : 'bg-gray-50'} data-row-id={row.id}>
                                <td className="px-2 py-1">
                                  <input
                                    type="checkbox"
                                    checked={!assign?.excluded}
                                    onChange={() => toggleExcluded(row.id)}
                                    title="Include in import"
                                  />
                                </td>
                                <td className="px-2 py-1 whitespace-nowrap text-gray-500 text-xs">
                                  ↳ {formatDateForDisplay(row.date)}
                                </td>
                                <td className="px-2 py-1">
                                  <input
                                    type="text"
                                    className="form-input text-xs py-0.5 w-full"
                                    value={row.description}
                                    onChange={(e) => handleUpdateRowField(row.id, 'description', e.target.value)}
                                  />
                                </td>
                                <td className={`px-2 py-1 text-right font-mono text-xs ${row.amount < 0 ? 'text-red-600' : 'text-green-600'}`}>
                                  <input
                                    type="number"
                                    step="0.01"
                                    className="form-input text-xs py-0.5 w-20 text-right"
                                    value={row.amount}
                                    onChange={(e) => handleUpdateRowField(row.id, 'amount', e.target.value)}
                                  />
                                </td>
                                <td className="px-2 py-1">
                                  <select
                                    className="form-input text-xs py-0.5 w-full"
                                    value={assign?.budgetTransactionId || ''}
                                    onChange={(e) => handleBudgetItemSelect(row.id, e.target.value)}
                                  >
                                    <option value="">Select...</option>
                                    <option value="__new__">+ New Budget Item</option>
                                    {budgetTransactions
                                      .slice()
                                      .sort((a, b) => a.name.localeCompare(b.name))
                                      .map(tx => (
                                        <option key={tx.id} value={tx.id}>{tx.name}</option>
                                      ))}
                                  </select>
                                </td>
                                <td className="px-2 py-1">
                                  {assign?.budgetTransactionId && (
                                    <select
                                      className="form-input text-xs py-0.5 w-full"
                                      value={assign?.occurrenceDate || ''}
                                      onChange={(e) => handleAssignDate(row.id, e.target.value)}
                                    >
                                      <option value="">Unassigned</option>
                                      {getOccurrenceDates(assign.budgetTransactionId).map(occ => (
                                        <option key={occ.date} value={occ.date}>
                                          {occ.label} {occ.filled ? '●' : '○'}
                                        </option>
                                      ))}
                                    </select>
                                  )}
                                </td>
                                <td className="px-2 py-1">
                                  <button
                                    className="text-xs text-blue-600 hover:text-blue-800 underline"
                                    onClick={() => handleSplitRow(row.id)}
                                    title="Split into two separate transactions"
                                  >
                                    Split
                                  </button>
                                </td>
                                </tr>
                              </>
                            )
                          })() : (
                            /* Normal ungrouped main row */
                            <tr className={row.isDuplicate ? 'bg-yellow-50' : 'bg-white'} data-row-id={row.id}>
                              <td className="px-2 py-2">
                                <input
                                  type="checkbox"
                                  checked={!assign?.excluded}
                                  onChange={() => toggleExcluded(row.id)}
                                  title="Include in import"
                                />
                              </td>
                              <td className="px-2 py-2 whitespace-nowrap">{formatDateForDisplay(row.date)}</td>
                              <td className="px-2 py-2">
                                <div className="flex items-center gap-1">
                                  {assign?.ruleMatched && (
                                    <span title={`Auto-assigned by rule: "${row.ruleMatch?.pattern ?? ''}"`} className="text-yellow-500 text-xs shrink-0">⚡</span>
                                  )}
                                  <input
                                    type="text"
                                    className="form-input text-sm py-1 w-full"
                                    value={row.description}
                                    onChange={(e) => handleUpdateRowField(row.id, 'description', e.target.value)}
                                  />
                                </div>
                              </td>
                              <td className={`px-2 py-2 text-right font-mono ${row.amount < 0 ? 'text-red-600' : 'text-green-600'}`}>
                                <input
                                  type="number"
                                  step="0.01"
                                  className="form-input text-sm py-1 w-24 text-right"
                                  value={row.amount}
                                  onChange={(e) => handleUpdateRowField(row.id, 'amount', e.target.value)}
                                />
                              </td>
                              <td className="px-2 py-2">
                                {ruleMode === 'suggest' && row.ruleMatch?.transactionId && !assign?.budgetTransactionId && !rejectedSuggestionRows.has(row.id) ? (
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-xs text-yellow-700 font-medium flex items-center gap-1 shrink-0">
                                      ⚡ {row.ruleMatch.transactionName ?? getBudgetTransactionName(row.ruleMatch.transactionId)}
                                    </span>
                                    <button
                                      className="text-xs bg-green-100 text-green-800 hover:bg-green-200 px-2 py-0.5 rounded font-medium"
                                      onClick={() => handleAssignBudgetItem(row.id, row.ruleMatch!.transactionId!)}
                                    >
                                      Accept
                                    </button>
                                    <button
                                      className="text-xs bg-gray-100 text-gray-600 hover:bg-gray-200 px-2 py-0.5 rounded"
                                      onClick={() => setRejectedSuggestionRows(prev => new Set(prev).add(row.id))}
                                    >
                                      Reject
                                    </button>
                                  </div>
                                ) : (
                                  <select
                                    key={`budget-${row.id}`}
                                    className="form-input text-sm py-1 w-full"
                                    value={assign?.budgetTransactionId || ''}
                                    onChange={(e) => handleBudgetItemSelect(row.id, e.target.value)}
                                  >
                                    <option value="">Select...</option>
                                    <option value="__new__">+ New Budget Item</option>
                                    {budgetTransactions
                                      .slice()
                                      .sort((a, b) => a.name.localeCompare(b.name))
                                      .map(tx => (
                                        <option key={tx.id} value={tx.id}>{tx.name}</option>
                                      ))}
                                  </select>
                                )}
                              </td>
                              <td className="px-2 py-2">
                                {assign?.budgetTransactionId && (
                                  <select
                                    key={`date-${row.id}`}
                                    className="form-input text-sm py-1 w-full"
                                    value={assign?.occurrenceDate || ''}
                                    onChange={(e) => handleAssignDate(row.id, e.target.value)}
                                  >
                                    <option value="">Unassigned</option>
                                    {getOccurrenceDates(assign.budgetTransactionId).map(occ => (
                                      <option key={occ.date} value={occ.date}>
                                        {occ.label} {occ.filled ? '●' : '○'}
                                      </option>
                                    ))}
                                  </select>
                                )}
                              </td>
                              <td className="px-2 py-2">
                                <button
                                  className="text-xs text-blue-600 hover:text-blue-800 underline"
                                  onClick={() => handleSplitRow(row.id)}
                                  title="Split into two separate transactions"
                                >
                                  Split
                                </button>
                              </td>
                            </tr>
                          )}
                          {/* Grouped history rows (synthetic siblings + existing DB rows) */}
                          {hasGrouped && (() => {
                            const groupKey = `${assign.budgetTransactionId}::${assign.occurrenceDate}`
                            const isExpanded = expandedGroups.has(groupKey)
                            const visibleRows = isExpanded ? grouped : grouped.slice(0, 3)
                            const hiddenCount = grouped.length - 3
                            return (
                              <>
                                {visibleRows.map((h: any) => {
                                  const isSynthetic = isSyntheticGroupedRow(h)
                                  const isEditing = editingGroupedRowId === h.id
                                  const typeLabel = h.sourceType === 'bank'
                                    ? 'Bank'
                                    : h.sourceType === 'manual'
                                    ? 'Manual'
                                    : h.sourceType === 'history'
                                    ? 'History'
                                    : 'Forecast'
                                  const typeColor = h.sourceType === 'bank'
                                    ? 'bg-blue-100 text-blue-700'
                                    : h.sourceType === 'manual'
                                    ? 'bg-green-100 text-green-700'
                                    : h.sourceType === 'history'
                                    ? 'bg-purple-100 text-purple-700'
                                    : 'bg-gray-100 text-gray-600'
                                  return (
                                    <tr key={h.id} data-group-key={groupKey} style={groupFadeStyle(groupKey)} className={`bg-gray-50 ${h.superseded ? 'opacity-60' : ''}`}>
                                      <td className="px-2 py-1"></td>
                                      <td className="px-2 py-1 whitespace-nowrap text-gray-400 text-xs">
                                        ↳ <span className={h.superseded ? 'line-through' : ''}>{formatDateForDisplay(h.date)}</span>
                                      </td>
                                      <td className="px-2 py-1 text-gray-500 text-xs">
                                        <div className="flex items-center gap-1.5">
                                          <span className={`inline-block px-1 py-0.5 rounded text-[10px] leading-none font-medium ${typeColor}`}>
                                            {typeLabel}
                                          </span>
                                          <span className={h.superseded ? 'line-through' : ''}>{h.description}</span>
                                          {h.superseded && (
                                            <span className="text-[10px] text-amber-600 font-medium">Superseded</span>
                                          )}
                                        </div>
                                      </td>
                                      <td className={`px-2 py-1 text-right font-mono text-xs ${h.amount < 0 ? 'text-red-400' : 'text-green-400'}`}>
                                        <span className={h.superseded ? 'line-through' : ''}>${Math.abs(h.amount).toFixed(2)}</span>
                                      </td>
                                      <td className="px-2 py-1 text-gray-400 text-xs">
                                        {isEditing ? (
                                          <select
                                            className="form-input text-xs py-0.5 w-full"
                                            autoFocus
                                            value={h.transactionId || ''}
                                            onChange={(e) => handleGroupedRowBudgetChange(h, e.target.value)}
                                          >
                                            <option value="">Clear</option>
                                            {budgetTransactions
                                              .slice()
                                              .sort((a, b) => a.name.localeCompare(b.name))
                                              .map(tx => (
                                                <option key={tx.id} value={tx.id}>{tx.name}</option>
                                              ))}
                                          </select>
                                        ) : (
                                          <span className="max-w-full truncate inline-block">Already assigned to {getBudgetTransactionName(h.transactionId)}</span>
                                        )}
                                      </td>
                                      <td className="px-2 py-1"></td>
                                      <td className="px-2 py-1">
                                        <div className="flex gap-2">
                                          {!isEditing && (
                                            <button
                                              className="text-xs text-blue-600 hover:text-blue-800 underline"
                                              onClick={() => setEditingGroupedRowId(h.id)}
                                            >
                                              Edit
                                            </button>
                                          )}
                                          {!isSynthetic && !isEditing && (
                                            <button
                                              className="text-xs text-red-600 hover:text-red-800 underline"
                                              onClick={() => handleGroupedRowDelete(h)}
                                            >
                                              Delete
                                            </button>
                                          )}
                                        </div>
                                      </td>
                                    </tr>
                                  )
                                })}
                                {hiddenCount > 0 && !isExpanded && (
                                  <tr data-group-key={groupKey} style={groupFadeStyle(groupKey)} className="bg-gray-50">
                                    <td className="px-2 py-1"></td>
                                    <td className="px-2 py-1"></td>
                                    <td className="px-2 py-1 text-gray-400 text-xs">
                                      <button
                                        className="text-blue-600 hover:text-blue-800 underline"
                                        onClick={() => setExpandedGroups(prev => new Set(prev).add(groupKey))}
                                      >
                                        ... ({hiddenCount} more)
                                      </button>
                                    </td>
                                    <td colSpan={4}></td>
                                  </tr>
                                )}
                                {isExpanded && hiddenCount > 0 && (
                                  <tr data-group-key={groupKey} style={groupFadeStyle(groupKey)} className="bg-gray-50">
                                    <td className="px-2 py-1"></td>
                                    <td className="px-2 py-1"></td>
                                    <td className="px-2 py-1 text-gray-400 text-xs">
                                      <button
                                        className="text-blue-600 hover:text-blue-800 underline"
                                        onClick={() => setExpandedGroups(prev => {
                                          const next = new Set(prev)
                                          next.delete(groupKey)
                                          return next
                                        })}
                                      >
                                        ... (show less)
                                      </button>
                                    </td>
                                    <td colSpan={4}></td>
                                  </tr>
                                )}
                              </>
                            )
                          })()}
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Rule Suggestion Modal */}
      {ruleSuggestion && (
        <RuleSuggestionModal
          transactionName={ruleSuggestion.transactionName}
          suggestedPattern={ruleSuggestion.suggestedPattern}
          examples={ruleSuggestion.examples}
          currentAccountId={ruleSuggestion.accountId}
          allAccounts={accounts}
          existingRuleId={ruleSuggestion.existingRuleId}
          onConfirm={handleRuleConfirm}
          onDismiss={() => setRuleSuggestion(null)}
          onDisable={async () => {
            try { await rulesApi.disableSuggestions(ruleSuggestion.transactionId) } catch { /* ignore */ }
            setRuleSuggestion(null)
          }}
        />
      )}

      {/* Pre-commit Summary Modal */}
      {showCommitSummary && (() => {
        const rows = buildRowsToCommit()
        const toCommit = rows.map((r: any) => ({
          date: r.bankRow.date,
          description: r.bankRow.description,
          amount: r.bankRow.amount,
          budgetItemName: getBudgetTransactionName(r.budgetTransactionId),
          occurrenceDate: r.occurrenceDate,
        }))
        const excludedCount = parsedRows.filter(r => assignments[r.id]?.excluded).length
        const skippedCount = parsedRows.length - toCommit.length - excludedCount
        return (
          <CommitSummaryModal
            toCommit={toCommit}
            excludedCount={excludedCount}
            skippedCount={skippedCount}
            onConfirm={doCommit}
            onCancel={() => setShowCommitSummary(false)}
          />
        )
      })()}

      {/* New Budget Item Modal */}
      {newBudgetForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
          onClick={(e) => {
            if (e.target === e.currentTarget) setNewBudgetForm(null)
          }}
        >
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">New Budget Item</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  className="form-input w-full"
                  value={newBudgetForm.name}
                  onChange={e => setNewBudgetForm(prev => prev ? { ...prev, name: e.target.value } : null)}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <CategorySelector
                  categories={categories}
                  selectedCategoryId={newBudgetForm.categoryId}
                  onChange={(id: string) => setNewBudgetForm(prev => prev ? { ...prev, categoryId: id } : null)}
                  onCategoryAdded={(cat: Category) => {
                    onHistoryChange?.()
                    setNewBudgetForm(prev => prev ? { ...prev, categoryId: cat.id } : null)
                  }}
                  className="form-input w-full"
                />
              </div>
              {newBudgetForm.error && (
                <p className="text-red-600 text-sm">{newBudgetForm.error}</p>
              )}
            </div>
            <div className="flex gap-3 mt-5 justify-end">
              <button
                type="button"
                className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm rounded hover:bg-gray-50"
                onClick={() => setNewBudgetForm(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
                onClick={handleSaveNewBudgetItem}
                disabled={newBudgetForm.saving}
              >
                {newBudgetForm.saving ? 'Saving…' : 'Save Budget Item'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Quick Rule button — visible when rules section scrolls off-screen */}
      {parsedRows.length > 0 && !rulesVisible && (
        <div className="fixed top-4 right-4 z-50 flex flex-col items-end gap-2">
          <button
            onClick={() => setShowQuickRule(v => !v)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-full shadow-lg transition-colors"
            title="Create a quick rule"
          >
            <span className="text-base leading-none">⚡</span>
            {showQuickRule ? 'Close' : 'Quick Rule'}
          </button>

          {showQuickRule && (
            <div className="w-80 bg-white border border-blue-200 rounded-xl shadow-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-blue-800">Create custom rule</h3>
                <button
                  onClick={() => { setShowQuickRule(false); setQrError('') }}
                  className="text-gray-400 hover:text-gray-600 text-lg leading-none"
                >✕</button>
              </div>

              {qrError && (
                <p className="text-xs text-red-600 bg-red-50 rounded px-2 py-1">{qrError}</p>
              )}

              <div>
                <label className="block text-xs text-gray-600 mb-1">Budget Item *</label>
                <select
                  className="form-input text-sm py-1 w-full"
                  value={qrTransactionId}
                  onChange={e => setQrTransactionId(e.target.value)}
                >
                  <option value="">Select…</option>
                  {budgetTransactions
                    .slice()
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-gray-600 mb-1">
                  Match pattern * <span className="text-gray-400">(case-insensitive substring)</span>
                </label>
                <input
                  type="text"
                  className="form-input text-sm py-1 w-full font-mono"
                  placeholder="e.g. mevan"
                  value={qrPattern}
                  onChange={e => setQrPattern(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveQuickRule()}
                />
              </div>

              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={qrRestrictToAccount}
                    onChange={e => setQrRestrictToAccount(e.target.checked)}
                    className="rounded"
                  />
                  Restrict to
                </label>
                <MultiSelectDropdown
                  options={accounts.map(a => ({ id: a.id, label: a.name }))}
                  selected={qrAccountIds}
                  onChange={setQrAccountIds}
                  placeholder="Select accounts…"
                  disabled={!qrRestrictToAccount}
                  className="flex-1"
                />
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  className="btn-primary text-sm py-1 px-4"
                  onClick={saveQuickRule}
                  disabled={qrSaving || !qrTransactionId || !qrPattern.trim()}
                >
                  {qrSaving ? 'Saving…' : 'Save Rule'}
                </button>
                <button
                  className="btn-secondary text-sm py-1 px-3"
                  onClick={() => { setShowQuickRule(false); setQrError('') }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}

export default BankImportCard
