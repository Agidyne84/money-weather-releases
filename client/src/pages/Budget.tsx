import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Transaction, Category, Account } from '../types'
import { transactionsApi, categoriesApi, accountsApi, historyApi, HistoryRow } from '../services/database'
import { createSafeDate, formatDateForStorage, formatDateForDisplay, formatDateForInput } from '../utils/dateUtils'
import { isTransactionOnDate } from '../../../shared/recurrence'
import FrequencySelector from '../components/FrequencySelector'
import CategorySelector from '../components/CategorySelector'
import { 
  BudgetVsActualWidget, 
  BudgetSummaryWidget,
  AnalyticsWidget,
  SpendingTrendChart
} from '../components/analytics'

const Budget: React.FC = () => {
  const [categories, setCategories] = useState<Category[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [historyData, setHistoryData] = useState<HistoryRow[]>([])
  const [analyticsPeriod, setAnalyticsPeriod] = useState<'current-month' | 'last-3' | 'ytd'>('last-3')
  const [bvaSelectedParent, setBvaSelectedParent] = useState<string | null>(null)
  const [bvaTableExpanded, setBvaTableExpanded] = useState(false)
  const [progressExpanded, setProgressExpanded] = useState(false)
  const [spendingMode, setSpendingMode] = useState<'parent' | 'child'>('parent')
  const [spendingSelectedParent, setSpendingSelectedParent] = useState<string | null>(null)
  const [progressSelectedParent, setProgressSelectedParent] = useState<string | null>(null)
  const [summaryMonthOffset, setSummaryMonthOffset] = useState<number>(-1)
  const [loading, setLoading] = useState(true)
  const [formErrors, setFormErrors] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState<'item' | 'category' | 'analytics'>('item')
  const [addingTransaction, setAddingTransaction] = useState(false)
  const [editingTransaction, setEditingTransaction] = useState<string | null>(null)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showFrequencyCustomize, setShowFrequencyCustomize] = useState(false)
  const [frequencyCustomizeContext, setFrequencyCustomizeContext] = useState<'add' | 'edit' | null>(null)
  const [weekDays, setWeekDays] = useState<boolean[]>([false, false, false, false, false, false, false])
  const [monthDays, setMonthDays] = useState<boolean[]>(Array.from({ length: 31 }, () => false))
  const [yearMonthPattern, setYearMonthPattern] = useState({
    months: [] as number[],
    day: 1
  })
  const [monthPatternType, setMonthPatternType] = useState<'specific' | 'week'>('specific')
  const [showMonthDates, setShowMonthDates] = useState(false)
  const [yearPatternType, setYearPatternType] = useState<'month' | 'week'>('month')
  const [showYearMonths, setShowYearMonths] = useState(false)

  // Balance adjustment modal
  const [showBalanceModal, setShowBalanceModal] = useState(false)
  const [balanceEdits, setBalanceEdits] = useState<Record<string, string>>({})

  const openBalanceModal = () => {
    const edits: Record<string, string> = {}
    accounts.forEach(a => { edits[a.id] = a.currentBalance.toFixed(2) })
    setBalanceEdits(edits)
    setShowBalanceModal(true)
  }

  const handleSaveBalances = async () => {
    try {
      await Promise.all(
        accounts.map(async (account) => {
          const value = balanceEdits[account.id]
          if (value === undefined || value === '') return
          const num = Number(value)
          if (isNaN(num)) return
          if (num !== account.currentBalance) {
            await accountsApi.update(account.id, { currentBalance: num })
          }
        })
      )
      await loadData()
      setShowBalanceModal(false)
    } catch (error) {
      console.error('Error updating balances:', error)
      alert('Failed to update balances. Please try again.')
    }
  }

  // Field visibility for Budget by Item tables
  const ALL_BUDGET_FIELDS = ['transaction', 'category', 'startDate', 'amount', 'frequency', 'account', 'monthly', 'yearly', 'actions'] as const
  type BudgetField = typeof ALL_BUDGET_FIELDS[number]

  const FIELD_WIDTHS: Record<BudgetField, string> = {
    transaction: '18%',
    category: '12%',
    startDate: '10%',
    amount: '8%',
    frequency: '16%',
    account: '10%',
    monthly: '8%',
    yearly: '8%',
    actions: '10%'
  }

  const [visibleFields, setVisibleFields] = useState<BudgetField[]>(() => {
    const saved = localStorage.getItem('budgetVisibleFields')
    return saved ? JSON.parse(saved) : ['transaction', 'category', 'amount', 'frequency', 'account', 'monthly', 'actions']
  })

  const toggleFieldVisibility = (field: BudgetField) => {
    setVisibleFields(prev => {
      const next = prev.includes(field)
        ? prev.filter(f => f !== field)
        : [...prev, field]
      localStorage.setItem('budgetVisibleFields', JSON.stringify(next))
      return next
    })
  }

  const resetVisibleFields = () => {
    const defaults: BudgetField[] = ['transaction', 'category', 'amount', 'frequency', 'account', 'monthly', 'actions']
    setVisibleFields(defaults)
    localStorage.setItem('budgetVisibleFields', JSON.stringify(defaults))
  }

  const isFieldVisible = (field: BudgetField) => visibleFields.includes(field)

  // Budget by Category: expand/collapse parent categories
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set())

  const toggleParentExpanded = (parentId: string) => {
    setExpandedParents(prev => {
      const next = new Set(prev)
      if (next.has(parentId)) next.delete(parentId)
      else next.add(parentId)
      return next
    })
  }

  const expandAllParents = () => {
    const allParentIds = categories
      .filter(cat => !cat.parentId)
      .map(cat => cat.id)
    setExpandedParents(new Set(allParentIds))
  }

  const collapseAllParents = () => {
    setExpandedParents(new Set())
  }

  const getTransactionMonthlyAmount = (transaction: Transaction): number => {
    const startDate = createSafeDate(transaction.startDate)
    const endDate = transaction.endDate ? createSafeDate(transaction.endDate) : null

    const yearLater = new Date(startDate)
    yearLater.setFullYear(yearLater.getFullYear() + 1)

    const windowEnd = endDate && endDate < yearLater ? endDate : yearLater

    let count = 0
    const d = new Date(startDate)

    while (d.getTime() <= windowEnd.getTime()) {
      if (isTransactionOnDate(transaction, d)) {
        count++
      }
      d.setDate(d.getDate() + 1)
    }

    if (endDate) {
      // Transaction has an end date — average over its actual active lifetime
      const activeMonths = Math.max(1,
        (windowEnd.getFullYear() - startDate.getFullYear()) * 12 +
        (windowEnd.getMonth() - startDate.getMonth()) +
        1
      )
      return (count * transaction.amount) / activeMonths
    }

    // No end date — use frequency-aware calculation
    const unit = transaction.frequency?.unit?.toLowerCase() || 'months'
    if (unit === 'months') {
      return transaction.amount
    }
    if (unit === 'years') {
      return transaction.amount / 12
    }

    // Weekly, daily, and custom patterns — use occurrence-based average over 12 months
    return (count * transaction.amount) / 12
  }

  const getCategoryMonthlyAmount = (categoryId: string, type: 'income' | 'expense') => {
    return transactions
      .filter(t => t.categoryId === categoryId && t.type === type && t.isActive)
      .reduce((sum, t) => sum + Math.abs(getTransactionMonthlyAmount(t)), 0)
  }

  const getParentMonthlyAmount = (parentId: string, type: 'income' | 'expense') => {
    const parentAmount = getCategoryMonthlyAmount(parentId, type)
    const childrenAmount = categories
      .filter(cat => cat.parentId === parentId)
      .reduce((sum, child) => sum + getCategoryMonthlyAmount(child.id, type), 0)
    return parentAmount + childrenAmount
  }

  const getColGroup = () =>
    visibleFields.map(field => <col key={field} style={{ width: FIELD_WIDTHS[field] }} />)

  const weekDayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const weekDayShortNames = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

  const getOrdinal = (num: number): string => {
    const j = num % 10
    const k = num % 100
    if (j === 1 && k !== 11) return num + 'st'
    if (j === 2 && k !== 12) return num + 'nd'
    if (j === 3 && k !== 13) return num + 'rd'
    return num + 'th'
  }

  
  const getFrequencyDescription = (frequency: any): string => {
    if (!frequency) return 'Monthly'
    
    if (frequency.unit === 'custom' && frequency.customPattern) {
      // Parse the custom pattern and generate human-readable description
      if (frequency.customPattern.startsWith('months:') && !frequency.customPattern.includes('week:')) {
        const monthsStart = frequency.customPattern.indexOf('months:') + 7
        const dayStart = frequency.customPattern.indexOf(',day:')
        
        let months: number[] = []
        let day = 1
        
        if (dayStart > -1) {
          const monthsPart = frequency.customPattern.substring(monthsStart, dayStart)
          months = monthsPart.split(',').map(Number)
          const dayPart = frequency.customPattern.substring(dayStart + 5)
          day = parseInt(dayPart)
        }
        
        if (months.length === 1) {
          const selectedMonthNames = months.map(m => monthNames[m] || 'Unknown').join(', ')
          return `Every ${frequency.value} year${frequency.value > 1 ? 's' : ''} on the ${getOrdinal(day)} of ${selectedMonthNames}`
        }
        
        const sortedMonths = months.sort((a, b) => a - b)
        const monthNamesList = sortedMonths.map(m => monthNames[m] || 'Unknown').join(', ')
        return `Every ${frequency.value} year${frequency.value > 1 ? 's' : ''} on the ${getOrdinal(day)} of ${monthNamesList}`
      }
      
      if (frequency.customPattern.includes('week:')) {
        const parts = frequency.customPattern.split(',')
        
        // Check if this is a "week:2,day:3" pattern (no months)
        if (parts.length === 2 && parts[0].startsWith('week:') && parts[1].startsWith('day:')) {
          const week = parseInt(parts[0].replace('week:', ''))
          const day = parseInt(parts[1].replace('day:', ''))
          return `Every ${frequency.value} month${frequency.value > 1 ? 's' : ''} on the ${getOrdinal(week)} ${weekDayNames[day]}`
        }
        
        // Original pattern: "months:X,Y,week:Z,day:W"
        if (parts.length >= 3) {
          const months = parts[0].replace('months:', '').split(',').map(Number) as number[]
          const week = parseInt(parts[1].replace('week:', ''))
          const day = parseInt(parts[2].replace('day:', ''))
          const selectedMonthNames = months.map((m: number) => monthNames[m] || 'Unknown').join(', ')
          return `Every ${frequency.value} year${frequency.value > 1 ? 's' : ''} on the ${getOrdinal(week)} ${weekDayNames[day]} of ${selectedMonthNames}`
        }
      }
      
      if (frequency.customPattern.startsWith('days:')) {
        const days = frequency.customPattern.replace('days:', '').split(',').map(Number) as number[]
        const dayList = days.map((d: number) => getOrdinal(d)).join(', ')
        return `Every ${frequency.value} month${frequency.value > 1 ? 's' : ''} on the ${dayList}`
      }
      
      if (frequency.customPattern.startsWith('week:')) {
        const parts = frequency.customPattern.split(',')
        const week = parseInt(parts[0].replace('week:', ''))
        const day = parseInt(parts[1].replace('day:', ''))
        return `Every ${frequency.value} month${frequency.value > 1 ? 's' : ''} on the ${getOrdinal(week)} ${weekDayNames[day]}`
      }
      
      // Fallback for other custom patterns
      return frequency.customPattern
    }
    
    if (frequency.unit === 'weeks' && frequency.customPattern?.startsWith('days:')) {
      const days = frequency.customPattern.replace('days:', '').split(',').map(Number) as number[]
      const dayNames = days.map((d: number) => weekDayShortNames[d]).join(', ')
      return `Every ${frequency.value} week${frequency.value > 1 ? 's' : ''} on ${dayNames}`
    }

    if (frequency.unit === 'months') {
      if (frequency.customPattern?.startsWith('days:')) {
        const days = frequency.customPattern.replace('days:', '').split(',').map(Number) as number[]
        const dayList = days.map((d: number) => getOrdinal(d)).join(', ')
        return `Every ${frequency.value} month${frequency.value > 1 ? 's' : ''} on the ${dayList}`
      }
      if (frequency.customPattern?.startsWith('week:')) {
        const parts = frequency.customPattern.split(',')
        const week = parseInt(parts[0].replace('week:', ''))
        const day = parseInt(parts[1].replace('day:', ''))
        return `Every ${frequency.value} month${frequency.value > 1 ? 's' : ''} on the ${getOrdinal(week)} ${weekDayNames[day]}`
      }
    }

    if (frequency.unit === 'years') {
      if (frequency.customPattern?.startsWith('months:') && !frequency.customPattern.includes('week:')) {
        const monthsStart = frequency.customPattern.indexOf('months:') + 7
        const dayStart = frequency.customPattern.indexOf(',day:')
        
        let months: number[] = []
        let day = 1
        
        if (dayStart > -1) {
          const monthsPart = frequency.customPattern.substring(monthsStart, dayStart)
          months = monthsPart.split(',').map(Number)
          const dayPart = frequency.customPattern.substring(dayStart + 5)
          day = parseInt(dayPart)
        }
        
        if (months.length === 1) {
          const selectedMonthNames = months.map(m => monthNames[m] || 'Unknown').join(', ')
          return `Every ${frequency.value} year${frequency.value > 1 ? 's' : ''} on the ${getOrdinal(day)} of ${selectedMonthNames}`
        } else {
          const sortedMonths = months.sort((a, b) => a - b)
          const monthNamesList = sortedMonths.map((m: number) => monthNames[m] || 'Unknown').join(', ')
          return `Every ${frequency.value} year${frequency.value > 1 ? 's' : ''} on the ${getOrdinal(day)} of ${monthNamesList}`
        }
      }
      if (frequency.customPattern?.includes('week:')) {
        const parts = frequency.customPattern.split(',')
        const months = parts[0].replace('months:', '').split(',').map(Number) as number[]
        const week = parseInt(parts[1].replace('week:', ''))
        const day = parseInt(parts[2].replace('day:', ''))
        const selectedMonthNames = months.map((m: number) => monthNames[m] || 'Unknown').join(', ')
        return `Every ${frequency.value} year${frequency.value > 1 ? 's' : ''} on the ${getOrdinal(week)} ${weekDayNames[day]} of ${selectedMonthNames}`
      }
    }

    return `Every ${frequency.value} ${frequency.unit}${frequency.value > 1 && !frequency.unit.endsWith('s') ? 's' : ''}`
  }

  const handleWeekDayToggle = (index: number) => {
    // Don't allow unselecting the start date day
    if (editFormData.startDate && (editFormData.frequency?.unit === 'custom' ? 'weeks' : editFormData.frequency?.unit) === 'weeks') {
      const startDay = createSafeDate(editFormData.startDate).getDay()
      if (index === startDay && weekDays[index]) {
        return // Don't allow unselecting the start date day
      }
    }
    
    const newDays = [...weekDays]
    newDays[index] = !newDays[index]
    setWeekDays(newDays)
    
    const selectedDays = newDays.map((selected, i) => selected ? i : -1).filter(i => i !== -1)
    if (selectedDays.length > 0) {
      setEditFormData({
        ...editFormData,
        frequency: {
          ...editFormData.frequency,
          unit: 'weeks',
          value: editFormData.frequency?.value || 1,
          customPattern: `days:${selectedDays.join(',')}`
        }
      })
    }
  }

  const handleMonthDayToggle = (day: number) => {
    // Don't allow unselecting the start date day
    if (editFormData.startDate && (editFormData.frequency?.unit === 'custom' ? 'months' : editFormData.frequency?.unit) === 'months') {
      const startDay = createSafeDate(editFormData.startDate).getDate()
      if (day === startDay && monthDays[day - 1]) {
        return // Don't allow unselecting the start date day
      }
    }
    
    const newDays = [...monthDays]
    newDays[day - 1] = !newDays[day - 1]
    setMonthDays(newDays)
    
    const selectedDays = newDays.map((selected, i) => selected ? i + 1 : -1).filter(i => i !== -1)
    
    if (selectedDays.length > 0) {
      if (selectedDays.length === 1 && editFormData.startDate && selectedDays[0] === createSafeDate(editFormData.startDate).getDate()) {
        // If only the start date is selected, clear the custom pattern
        setEditFormData({
          ...editFormData,
          frequency: {
            ...editFormData.frequency,
            customPattern: undefined
          }
        })
      } else {
        setEditFormData({
          ...editFormData,
          frequency: {
            ...editFormData.frequency,
            customPattern: `days:${selectedDays.join(',')}`
          }
        })
      }
    }
  }

  const handleYearMonthToggle = (monthIndex: number) => {
    // Don't allow unselecting the start date month
    if (editFormData.startDate && (editFormData.frequency?.unit === 'custom' ? 'years' : editFormData.frequency?.unit) === 'years') {
      const startMonth = createSafeDate(editFormData.startDate).getMonth()
      if (monthIndex === startMonth && yearMonthPattern.months.includes(monthIndex)) {
        return // Don't allow unselecting the start date month
      }
    }
    
    const newMonths = yearMonthPattern.months.includes(monthIndex)
      ? yearMonthPattern.months.filter(m => m !== monthIndex)
      : [...yearMonthPattern.months, monthIndex].sort((a, b) => a - b)
    
    setYearMonthPattern(prev => ({ ...prev, months: newMonths }))
    
    if (newMonths.length > 0) {
      const startDay = editFormData.startDate ? createSafeDate(editFormData.startDate).getDate() : 1
      
      if (newMonths.length === 1 && editFormData.startDate && newMonths[0] === createSafeDate(editFormData.startDate).getMonth()) {
        setEditFormData({
          ...editFormData,
          frequency: {
            ...editFormData.frequency,
            unit: 'years',
            value: editFormData.frequency?.value || 1,
            customPattern: undefined
          }
        })
      } else {
        const customPattern = `months:${newMonths.join(',')},day:${startDay}`
        setEditFormData({
          ...editFormData,
          frequency: {
            ...editFormData.frequency,
            unit: 'years',
            value: editFormData.frequency?.value || 1,
            customPattern: customPattern
          }
        })
      }
    }
  }

  const [editFormData, setEditFormData] = useState({
    name: '',
    amount: '',
    categoryId: '',
    accountId: '',
    type: '' as 'income' | 'expense' | 'administrative' | '',
    isTransfer: false,
    transferToAccountId: '',
    startDate: '',
    pauseStartDate: '',
    pauseEndDate: '',
    frequency: {
      unit: 'months' as 'days' | 'weeks' | 'months' | 'years' | 'custom',
      value: 1,
      customPattern: undefined as string | undefined
    }
  })
  const [formData, setFormData] = useState({
    name: '',
    amount: '',
    frequency: {
      unit: 'months' as 'days' | 'weeks' | 'months' | 'years',
      value: 1,
      customPattern: undefined as string | undefined
    },
    startDate: formatDateForStorage(new Date()),
    categoryId: '',
    accountId: '',
    type: '' as 'income' | 'expense' | 'administrative' | '',
    isTransfer: false,
    transferToAccountId: ''
  })
  const scrollToTransactionForm = () => {
    const formElement = document.getElementById('add-transaction-form')
    if (formElement) {
      formElement.scrollIntoView({ behavior: 'smooth' })
    }
  }

  const loadData = async () => {
    try {
      const now = new Date()
      const yearAgo = new Date(now)
      yearAgo.setFullYear(yearAgo.getFullYear() - 1)
      const [categoriesData, transactionsData, accountsData, historyRows] = await Promise.all([
        categoriesApi.getAll(),
        transactionsApi.getAll(),
        accountsApi.getAll(),
        historyApi.getAll({
          startDate: yearAgo.toISOString().split('T')[0],
          limit: 5000,
          includeUnposted: false,
          includeExcluded: false,
        }),
      ])
      // categoriesApi.getAll() already returns flat data
      setCategories(categoriesData)
      setTransactions(transactionsData)
      setAccounts(accountsData)
      setHistoryData(historyRows)

      // Form defaults intentionally left empty for type/account/category so user must select
    } catch (error) {
      console.error('Error loading data:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const validateForm = (): boolean => {
    const errors: string[] = []

    if (!formData.name.trim()) errors.push('Transaction name is required')
    if (!formData.amount || isNaN(Number(formData.amount))) errors.push('Amount must be a valid number')
    if (!formData.categoryId) errors.push('Category is required')
    if (!formData.accountId) errors.push('Account is required')
    if (!formData.startDate) errors.push('Start date is required')
    if (!formData.type) errors.push('Type is required')
    if (!formData.frequency || formData.frequency.value <= 0) errors.push('Frequency value must be greater than 0')
    if ((formData.frequency?.unit as any) === 'custom' && !formData.frequency.customPattern?.trim()) errors.push('Custom frequency pattern is required')

    setFormErrors(errors)
    return errors.length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!validateForm()) return

    if (Number(formData.amount) === 0) {
      const ok = window.confirm(
        'This transaction has an amount of 0.\n\n' +
        'Zero-amount budget items are useful as placeholders (e.g., to reserve a category or date slot).\n\n' +
        'Continue adding this placeholder transaction?'
      )
      if (!ok) return
    }

    setAddingTransaction(true)
    try {
      const transactionData: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'> = {
        name: formData.name,
        amount: formData.type === 'expense' ? -Math.abs(Number(formData.amount)) :
                formData.type === 'administrative' ? Number(formData.amount) :
                Math.abs(Number(formData.amount)),
        frequency: {
          value: Number(formData.frequency.value),
          unit: formData.frequency.unit,
          customPattern: (formData.frequency.unit as any) === 'custom' ? formData.frequency.customPattern : undefined
        },
        startDate: createSafeDate(formData.startDate),
        categoryId: formData.categoryId,
        accountId: formData.accountId,
        type: formData.type as 'income' | 'expense' | 'administrative',
        isTransfer: formData.isTransfer,
        transferToAccountId: formData.isTransfer ? formData.transferToAccountId : undefined,
        isActive: true
      }

      await transactionsApi.create(transactionData)

      // Reset form and reload data
      setFormData({
        name: '',
        amount: '',
        frequency: {
          unit: 'months',
          value: 1,
          customPattern: undefined
        },
        startDate: formatDateForStorage(new Date()),
        categoryId: '',
        accountId: '',
        type: '',
        isTransfer: false,
        transferToAccountId: ''
      })
      setFormErrors([])
      await loadData()
    } catch (error) {
      console.error('Error creating transaction:', error)
      setFormErrors(['Failed to create transaction. Please try again.'])
    } finally {
      setAddingTransaction(false)
    }
  }

  // Calculate budget summaries
  const calculateBudgetSummary = () => {
    const monthlyIncome = transactions
      .filter(t => t.type === 'income' && t.isActive && t.id)
      .reduce((sum, t) => sum + getTransactionMonthlyAmount(t), 0)

    const monthlyExpenses = transactions
      .filter(t => t.type === 'expense' && t.isActive && t.id)
      .reduce((sum, t) => sum + Math.abs(getTransactionMonthlyAmount(t)), 0)

    const monthlyAdministrative = transactions
      .filter(t => t.type === 'administrative' && t.isActive && t.id)
      .reduce((sum, t) => sum + getTransactionMonthlyAmount(t), 0)

    const netMonthly = monthlyIncome - monthlyExpenses + monthlyAdministrative

    return { monthlyIncome, monthlyExpenses, monthlyAdministrative, netMonthly }
  }

  // Analytics helper: compute start/end dates for the selected period
  const getAnalyticsPeriodDates = (): { start: string; end: string; months: number } => {
    const now = new Date()
    const todayStr = now.toISOString().split('T')[0]
    if (analyticsPeriod === 'current-month') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1)
      return { start: start.toISOString().split('T')[0], end: todayStr, months: 1 }
    }
    if (analyticsPeriod === 'last-3') {
      const start = new Date(now)
      start.setMonth(start.getMonth() - 3)
      start.setDate(1)
      return { start: start.toISOString().split('T')[0], end: todayStr, months: 3 }
    }
    // ytd
    const start = new Date(now.getFullYear(), 0, 1)
    const months = now.getMonth() + 1
    return { start: start.toISOString().split('T')[0], end: todayStr, months }
  }

  const getHistoryInPeriod = (start: string, end: string): HistoryRow[] =>
    historyData.filter(h => {
      const dateStr = h.date instanceof Date
        ? h.date.toISOString().split('T')[0]
        : String(h.date).split('T')[0]
      return dateStr >= start && dateStr <= end
    })

  // Analytics data processing functions
  const getBudgetVsActualData = () => {
    const { start, end, months } = getAnalyticsPeriodDates()
    const periodHistory = getHistoryInPeriod(start, end)
    const creditCatIds = getCreditPaymentCategoryIds()

    // Include both expense-type and transfer-to-credit budget items
    const budgetCategoryIds = new Set(
      transactions
        .filter(t => t.isActive && (
          t.type === 'expense' ||
          (t.isTransfer && t.transferToAccountId && accounts.some(a => a.id === t.transferToAccountId && a.type === 'credit'))
        ))
        .map(t => t.categoryId)
    )
    const relevantCats = categories.filter(cat =>
      !cat.parentId && (
        budgetCategoryIds.has(cat.id) ||
        categories.some(child => child.parentId === cat.id && budgetCategoryIds.has(child.id))
      )
    )

    return relevantCats
      .map(category => {
        // Budget: sum monthly scheduled amounts × period months
        const childCatIds = categories
          .filter(c => c.parentId === category.id)
          .map(c => c.id)
        const allCatIds = [category.id, ...childCatIds]
        const isCredit = allCatIds.some(id => creditCatIds.has(id))

        const budgetMonthly = transactions
          .filter(t => allCatIds.includes(t.categoryId) && t.isActive && (
            t.type === 'expense' ||
            (isCredit && t.isTransfer)
          ))
          .reduce((sum, t) => sum + Math.abs(getTransactionMonthlyAmount(t)), 0)
        const budget = budgetMonthly * months

        // Actual: for credit categories include both expense and income history entries
        const actual = periodHistory
          .filter(h => allCatIds.includes(h.categoryId) && (
            h.type === 'expense' || (isCredit && h.type === 'income')
          ))
          .reduce((sum, h) => sum + Math.abs(h.amount), 0)

        return { category: category.name, budget, actual, color: category.color || '#6B7280', isCredit }
      })
      .filter(item => item.budget > 0 || item.actual > 0)
  }

  const getBudgetProgressData = () => getBudgetVsActualData()

  const getCurrentMonthInfo = () => {
    const now = new Date()
    // summaryMonthOffset: 0 = current (in-progress), -1 = last month, -2 = two months ago, etc.
    const targetDate = new Date(now.getFullYear(), now.getMonth() + summaryMonthOffset, 1)
    const year = targetDate.getFullYear()
    const month = targetDate.getMonth()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const isCurrentMonth = summaryMonthOffset === 0
    const daysPassed = isCurrentMonth ? now.getDate() : daysInMonth
    const monthName = targetDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

    const monthStart = new Date(year, month, 1).toISOString().split('T')[0]
    const monthEnd = isCurrentMonth
      ? now.toISOString().split('T')[0]
      : new Date(year, month + 1, 0).toISOString().split('T')[0]
    const monthHistory = getHistoryInPeriod(monthStart, monthEnd)

    // Overall: exclude transfers — they move money between accounts, not net spending.
    // Per-account gauges handle transfers separately (savings deposits, credit payments).
    const totalBudget = transactions
      .filter(t => t.type === 'expense' && t.isActive && !t.isTransfer)
      .reduce((sum, t) => sum + Math.abs(getTransactionMonthlyAmount(t)), 0)
    const totalSpent = monthHistory
      .filter(h => h.type === 'expense' && !h.isTransfer)
      .reduce((sum, h) => sum + Math.abs(h.amount), 0)
    const totalRemaining = totalBudget - totalSpent

    // Per-account-type gauge data
    const checkingIds = new Set(accounts.filter(a => a.type === 'checking').map(a => a.id))
    const savingsIds  = new Set(accounts.filter(a => a.type === 'savings').map(a => a.id))
    const creditIds   = new Set(accounts.filter(a => a.type === 'credit').map(a => a.id))

    // Checking: non-transfer expense budget items on checking accounts
    const checkingBudget = transactions
      .filter(t => t.isActive && !t.isTransfer && t.type === 'expense' && checkingIds.has(t.accountId))
      .reduce((s, t) => s + Math.abs(getTransactionMonthlyAmount(t)), 0)
    const checkingActual = monthHistory
      .filter(h => !h.isTransfer && h.type === 'expense' && checkingIds.has(h.accountId))
      .reduce((s, h) => s + Math.abs(h.amount), 0)

    // Savings: transfers TO savings + income ON savings (interest, direct deposits, etc.)
    const savingsTransferBudget = transactions
      .filter(t => t.isActive && t.isTransfer && t.transferToAccountId && savingsIds.has(t.transferToAccountId))
      .reduce((s, t) => s + Math.abs(getTransactionMonthlyAmount(t)), 0)
    const savingsIncomeBudget = transactions
      .filter(t => t.isActive && t.type === 'income' && savingsIds.has(t.accountId))
      .reduce((s, t) => s + Math.abs(getTransactionMonthlyAmount(t)), 0)
    const savingsBudget = savingsTransferBudget + savingsIncomeBudget

    const savingsTransferActual = monthHistory
      .filter(h => h.isTransfer && h.transferToAccountId && savingsIds.has(h.transferToAccountId))
      .reduce((s, h) => s + Math.abs(h.amount), 0)
    const savingsIncomeActual = monthHistory
      .filter(h => h.type === 'income' && savingsIds.has(h.accountId))
      .reduce((s, h) => s + Math.abs(h.amount), 0)
    const savingsActual = savingsTransferActual + savingsIncomeActual

    // Credit: NET = transfers TO credit (payments, positive) minus expenses ON credit (purchases, negative).
    // Transfer payments raise the gauge, credit purchases lower it.
    const creditTransferBudget = transactions
      .filter(t => t.isActive && t.isTransfer && t.transferToAccountId && creditIds.has(t.transferToAccountId))
      .reduce((s, t) => s + Math.abs(getTransactionMonthlyAmount(t)), 0)
    const creditPurchaseBudget = transactions
      .filter(t => t.isActive && !t.isTransfer && t.type === 'expense' && creditIds.has(t.accountId))
      .reduce((s, t) => s + Math.abs(getTransactionMonthlyAmount(t)), 0)
    const creditBudget = creditTransferBudget - creditPurchaseBudget

    const creditTransferActual = monthHistory
      .filter(h => h.isTransfer && h.transferToAccountId && creditIds.has(h.transferToAccountId))
      .reduce((s, h) => s + Math.abs(h.amount), 0)
    const creditPurchaseActual = monthHistory
      .filter(h => creditIds.has(h.accountId) && !h.isTransfer && h.type === 'expense')
      .reduce((s, h) => s + Math.abs(h.amount), 0)
    const creditIncomeActual = monthHistory
      .filter(h => creditIds.has(h.accountId) && h.type === 'income')
      .reduce((s, h) => s + Math.abs(h.amount), 0)
    const creditActual = creditTransferActual + creditIncomeActual - creditPurchaseActual

    return {
      totalBudget, totalSpent, totalRemaining, monthName, daysInMonth, daysPassed,
      isCompleted: !isCurrentMonth,
      checkingGauge: checkingIds.size > 0 ? { budget: checkingBudget, actual: checkingActual } : undefined,
      savingsGauge:  savingsIds.size  > 0 ? { budget: savingsBudget,  actual: savingsActual  } : undefined,
      creditGauge:   creditIds.size   > 0 ? { budget: creditBudget,   actual: creditActual   } : undefined,
    }
  }

  const getCreditPaymentCategoryIds = (): Set<string> => {
    const creditAccountIds = new Set(
      accounts.filter(a => a.type === 'credit').map(a => a.id)
    )
    const catIds = new Set<string>()
    transactions.forEach(t => {
      if (!t.isActive || !t.categoryId) return
      // Direct: budget item lives on the credit account itself
      if (creditAccountIds.has(t.accountId)) {
        catIds.add(t.categoryId)
      }
      // Transfer: money moves FROM another account TO the credit card (i.e., a payment)
      if (t.isTransfer && t.transferToAccountId && creditAccountIds.has(t.transferToAccountId)) {
        catIds.add(t.categoryId)
      }
    })
    return catIds
  }

  const getSpendingByCategory = () => {
    const { start, end } = getAnalyticsPeriodDates()
    const periodHistory = getHistoryInPeriod(start, end)
    return categories
      .filter(cat => !cat.parentId)
      .map(category => {
        const childCatIds = categories.filter(c => c.parentId === category.id).map(c => c.id)
        const allCatIds = [category.id, ...childCatIds]
        const total = periodHistory
          .filter(h => allCatIds.includes(h.categoryId) && h.type === 'expense')
          .reduce((sum, h) => sum + Math.abs(h.amount), 0)
        return { label: category.name, value: total, color: category.color || '#6B7280' }
      })
      .filter(item => item.value > 0)
  }

  // Budget vs Actual display data: parent-level or drilled-down children, sorted by max(budget,actual) desc
  const getBudgetVsActualForDisplay = () => {
    const parentData = getBudgetVsActualData().sort((a, b) => Math.max(b.budget, b.actual) - Math.max(a.budget, a.actual))
    if (!bvaSelectedParent) return parentData

    const parentCat = categories.find(c => c.name === bvaSelectedParent && !c.parentId)
    if (!parentCat) return parentData

    const childCats = categories.filter(c => c.parentId === parentCat.id)
    if (childCats.length === 0) return parentData

    const { start, end, months } = getAnalyticsPeriodDates()
    const periodHistory = getHistoryInPeriod(start, end)

    const creditCatIds = getCreditPaymentCategoryIds()
    return childCats
      .map(cat => {
        const isCreditCat = creditCatIds.has(cat.id)
        const budget = transactions
          .filter(t => t.categoryId === cat.id && t.isActive && (t.type === 'expense' || (isCreditCat && t.isTransfer)))
          .reduce((s, t) => s + Math.abs(getTransactionMonthlyAmount(t)), 0) * months
        const actual = periodHistory
          .filter(h => h.categoryId === cat.id && (h.type === 'expense' || (isCreditCat && h.type === 'income')))
          .reduce((s, h) => s + Math.abs(h.amount), 0)
        return { category: cat.name, budget, actual, color: cat.color || parentCat.color || '#6B7280', isCredit: isCreditCat }
      })
      .filter(i => i.budget > 0 || i.actual > 0)
      .sort((a, b) => Math.max(b.budget, b.actual) - Math.max(a.budget, a.actual))
  }

  // Spending trend: daily actual expense spending over the selected period (mirrors Dashboard style)
  const getSpendingTrendData = () => {
    const { start, end } = getAnalyticsPeriodDates()
    const startDate = new Date(start)
    const endDate = new Date(end)
    const days: { label: string; value: number; date: Date }[] = []
    const current = new Date(startDate)
    while (current <= endDate) {
      const dateStr = current.toISOString().split('T')[0]
      const dayTotal = historyData
        .filter(h => {
          const hDate = h.date instanceof Date
            ? h.date.toISOString().split('T')[0]
            : String(h.date).split('T')[0]
          return hDate === dateStr && (h.type === 'expense' || (h.type as string) === 'administrative')
        })
        .reduce((sum, h) => sum + Math.abs(h.amount), 0)
      days.push({
        label: current.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        value: dayTotal,
        date: new Date(current),
      })
      current.setDate(current.getDate() + 1)
    }
    return days
  }

  const navigate = useNavigate()

  const navigateToHistory = (categoryName: string) => {
    const cat = categories.find(c => c.name === categoryName)
    if (!cat) return
    const { start, end } = getAnalyticsPeriodDates()
    const ok = window.confirm(
      `View History for "${categoryName}"?\n\nYou'll be taken to the History page filtered to this category for the selected time period.`
    )
    if (!ok) return
    sessionStorage.setItem('budgetAnalyticsReturn', JSON.stringify({
      activeTab: 'analytics',
      analyticsPeriod,
      summaryMonthOffset,
      bvaSelectedParent,
      bvaTableExpanded,
      progressExpanded,
      spendingMode,
      spendingSelectedParent,
      progressSelectedParent,
    }))
    navigate('/history', { state: { categoryId: cat.id, startDate: start, endDate: end } })
  }

  // Restore analytics state when returning from History page
  useEffect(() => {
    const saved = sessionStorage.getItem('budgetAnalyticsReturn')
    if (!saved) return
    try {
      const s = JSON.parse(saved)
      setActiveTab(s.activeTab ?? 'analytics')
      setAnalyticsPeriod(s.analyticsPeriod ?? 'last-3')
      setSummaryMonthOffset(s.summaryMonthOffset ?? -1)
      setBvaSelectedParent(s.bvaSelectedParent ?? null)
      setBvaTableExpanded(s.bvaTableExpanded ?? false)
      setProgressExpanded(s.progressExpanded ?? false)
      setSpendingMode(s.spendingMode ?? 'parent')
      setSpendingSelectedParent(s.spendingSelectedParent ?? null)
      setProgressSelectedParent(s.progressSelectedParent ?? null)
    } catch { /* ignore corrupt data */ }
    sessionStorage.removeItem('budgetAnalyticsReturn')
  }, [])

  // Spending by category for display: parent, all-child, or drilled-down children
  const getSpendingByCategoryForDisplay = () => {
    const { start, end } = getAnalyticsPeriodDates()
    const periodHistory = getHistoryInPeriod(start, end)

    if (spendingSelectedParent !== null) {
      const parentCat = categories.find(c => c.name === spendingSelectedParent && !c.parentId)
      if (!parentCat) return getSpendingByCategory()
      const childCats = categories.filter(c => c.parentId === parentCat.id)
      return childCats
        .map(cat => ({
          label: cat.name,
          value: periodHistory
            .filter(h => h.categoryId === cat.id && h.type === 'expense')
            .reduce((s, h) => s + Math.abs(h.amount), 0),
          color: cat.color || parentCat.color || '#6B7280',
        }))
        .filter(i => i.value > 0)
    }

    if (spendingMode === 'child') {
      return categories
        .filter(cat => cat.parentId)
        .map(cat => ({
          label: cat.name,
          value: periodHistory
            .filter(h => h.categoryId === cat.id && h.type === 'expense')
            .reduce((s, h) => s + Math.abs(h.amount), 0),
          color: cat.color || '#6B7280',
        }))
        .filter(i => i.value > 0)
    }

    return getSpendingByCategory()
  }

  // Budget progress for display: parent-level or drilled-down children
  const getBudgetProgressForDisplay = () => {
    const allProgress = getBudgetProgressData()
    if (progressSelectedParent === null) return allProgress

    const parentCat = categories.find(c => c.name === progressSelectedParent && !c.parentId)
    if (!parentCat) return allProgress
    const childCats = categories.filter(c => c.parentId === parentCat.id)
    if (childCats.length === 0) return allProgress

    const { start, end, months } = getAnalyticsPeriodDates()
    const periodHistory = getHistoryInPeriod(start, end)
    const creditCatIds2 = getCreditPaymentCategoryIds()
    return childCats
      .map(cat => {
        const isCreditCat = creditCatIds2.has(cat.id)
        const budget = transactions
          .filter(t => t.categoryId === cat.id && t.isActive && (t.type === 'expense' || (isCreditCat && t.isTransfer)))
          .reduce((s, t) => s + Math.abs(getTransactionMonthlyAmount(t)), 0) * months
        const actual = periodHistory
          .filter(h => h.categoryId === cat.id && (h.type === 'expense' || (isCreditCat && h.type === 'income')))
          .reduce((s, h) => s + Math.abs(h.amount), 0)
        return { category: cat.name, budget, actual, color: cat.color || parentCat.color || '#6B7280', isCredit: isCreditCat }
      })
      .filter(i => i.budget > 0 || i.actual > 0)
  }

  // Category performance: per category this month / last month / 3-month avg / budgeted
  const getCategoryPerformanceData = () => {
    const now = new Date()
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
    const thisMonthEnd = now.toISOString().split('T')[0]
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0]
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0]
    const threeMonthStart = new Date(now.getFullYear(), now.getMonth() - 3, 1).toISOString().split('T')[0]

    const thisMonthH = getHistoryInPeriod(thisMonthStart, thisMonthEnd)
    const lastMonthH = getHistoryInPeriod(lastMonthStart, lastMonthEnd)
    const threeMonthH = getHistoryInPeriod(threeMonthStart, thisMonthEnd)

    return categories
      .filter(cat => !cat.parentId)
      .map(category => {
        const childCatIds = categories.filter(c => c.parentId === category.id).map(c => c.id)
        const allCatIds = [category.id, ...childCatIds]
        const sum = (rows: HistoryRow[]) =>
          rows.filter(h => allCatIds.includes(h.categoryId) && h.type === 'expense')
              .reduce((s, h) => s + Math.abs(h.amount), 0)
        const budgeted = transactions
          .filter(t => allCatIds.includes(t.categoryId) && t.type === 'expense' && t.isActive)
          .reduce((s, t) => s + Math.abs(getTransactionMonthlyAmount(t)), 0)
        const thisMonth = sum(thisMonthH)
        const lastMonth = sum(lastMonthH)
        const threeMonthAvg = sum(threeMonthH) / 3
        const trend: 'up' | 'down' | 'flat' =
          thisMonth > threeMonthAvg * 1.05 ? 'up' :
          thisMonth < threeMonthAvg * 0.95 ? 'down' : 'flat'
        return { category: category.name, color: category.color || '#6B7280', budgeted, thisMonth, lastMonth, threeMonthAvg, trend }
      })
      .filter(item => item.budgeted > 0 || item.thisMonth > 0)
  }

  // Computed insights based on real history vs budget
  const getComputedInsights = () => {
    const { start, end } = getAnalyticsPeriodDates()
    const bva = getBudgetVsActualData()
    const now = new Date()
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0]
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0]
    const currentSpend = getHistoryInPeriod(start, end)
      .filter(h => h.type === 'expense').reduce((s, h) => s + Math.abs(h.amount), 0)
    const lastMonthSpend = getHistoryInPeriod(lastMonthStart, lastMonthEnd)
      .filter(h => h.type === 'expense').reduce((s, h) => s + Math.abs(h.amount), 0)
    const momChange = lastMonthSpend > 0 ? ((currentSpend - lastMonthSpend) / lastMonthSpend) * 100 : null

    const overBudget = bva
      .filter(i => i.actual > i.budget && i.budget > 0)
      .sort((a, b) => (b.actual - b.budget) - (a.actual - a.budget))
      .slice(0, 3)
    const underBudget = bva
      .filter(i => i.budget > 0 && i.actual < i.budget)
      .sort((a, b) => (b.budget - b.actual) - (a.budget - a.actual))
      .slice(0, 3)

    return { overBudget, underBudget, momChange, currentSpend, lastMonthSpend }
  }

  const { monthlyIncome, monthlyExpenses, monthlyAdministrative, netMonthly } = calculateBudgetSummary()

  // Edit transaction functions
  const startEditTransaction = (transaction: Transaction) => {
    setEditingTransaction(transaction.id)
    setEditFormData({
      name: transaction.name,
      amount: transaction.amount.toString(),
      categoryId: transaction.categoryId,
      accountId: transaction.accountId,
      type: transaction.type,
      isTransfer: transaction.isTransfer || false,
      transferToAccountId: transaction.transferToAccountId || '',
      startDate: formatDateForInput(transaction.startDate), // Use formatDateForInput to avoid timezone issues
      pauseStartDate: transaction.pauseStartDate ? formatDateForInput(transaction.pauseStartDate) : '',
      pauseEndDate: transaction.pauseEndDate ? formatDateForInput(transaction.pauseEndDate) : '',
      frequency: {
        unit: transaction.frequency.unit,
        value: transaction.frequency.value,
        customPattern: transaction.frequency.customPattern
      }
    })
    setShowEditModal(true)
  }

  const cancelEdit = () => {
    setEditingTransaction(null)
    setShowEditModal(false)
    setEditFormData({
      name: '',
      amount: '',
      categoryId: '',
      accountId: '',
      type: 'expense' as 'income' | 'expense' | 'administrative',
      isTransfer: false,
      transferToAccountId: '',
      startDate: '',
      pauseStartDate: '',
      pauseEndDate: '',
      frequency: {
        unit: 'months',
        value: 1,
        customPattern: undefined
      }
    })
  }

  const handleDeleteTransaction = async (transaction: Transaction) => {
    const confirmed = window.confirm(
      `Delete "${transaction.name}"? This removes the transaction and all its forecast occurrences. This cannot be undone.`
    )
    if (!confirmed) return
    try {
      await transactionsApi.delete(transaction.id)
      if (editingTransaction === transaction.id) {
        cancelEdit()
      }
      await loadData()
    } catch (error: any) {
      console.error('Error deleting transaction:', error)
      alert(`Failed to delete "${transaction.name}". ${error?.response?.data?.error || error?.message || ''}`)
    }
  }

  const saveEditTransaction = async (transactionId: string) => {
    if (Number(editFormData.amount) === 0) {
      const ok = window.confirm(
        'This transaction has an amount of 0.\n\n' +
        'Zero-amount budget items are useful as placeholders (e.g., to reserve a category or date slot).\n\n' +
        'Continue saving this placeholder transaction?'
      )
      if (!ok) return
    }

    try {
      console.log('Saving transaction with ID:', transactionId)
      console.log('Edit form data:', editFormData)
      
      const updateData = {
        name: editFormData.name,
        amount: editFormData.type === 'expense' ? -Math.abs(Number(editFormData.amount)) :
                editFormData.type === 'administrative' ? Number(editFormData.amount) :
                Math.abs(Number(editFormData.amount)),
        categoryId: editFormData.categoryId,
        accountId: editFormData.accountId,
        type: editFormData.type as 'income' | 'expense' | 'administrative',
        isTransfer: editFormData.isTransfer,
        transferToAccountId: editFormData.isTransfer ? editFormData.transferToAccountId : undefined,
        startDate: createSafeDate(editFormData.startDate),
        pauseStartDate: editFormData.pauseStartDate ? createSafeDate(editFormData.pauseStartDate) : undefined,
        pauseEndDate: editFormData.pauseEndDate ? createSafeDate(editFormData.pauseEndDate) : undefined,
        frequency: editFormData.frequency,
        isActive: true // Ensure the transaction remains active
      }
      
      console.log('Update data being sent:', updateData)
      
      await transactionsApi.update(transactionId, updateData)
      console.log('Transaction updated successfully')
      await loadData()
      cancelEdit()
    } catch (error: any) {
      console.error('Error updating transaction:', error)
      console.error('Error details:', error?.response?.data || error?.message)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-gray-500">Loading budget...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header with Tabs */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Budget & Transactions</h1>
          <p className="text-gray-600">Manage your recurring transactions and budget planning</p>
        </div>
        <button onClick={scrollToTransactionForm} className="btn-primary">
          Add Transaction
        </button>
      </div>

      {/* Navigation Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('item')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'item'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Budget by Item
          </button>
          <button
            onClick={() => setActiveTab('category')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'category'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Budget by Category
          </button>
          <button
            onClick={() => setActiveTab('analytics')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'analytics'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Budget Analytics
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'category' && (
        <>
          {/* Budget Summary */}
          <div className="card">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium text-gray-900">Budget Summary</h3>
              <button
                type="button"
                className="btn-secondary text-sm"
                onClick={openBalanceModal}
              >
                Update Current Balances
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="text-center p-4 bg-green-50 rounded-lg">
                <p className="text-sm text-green-600 font-medium">Monthly Income</p>
                <p className="text-2xl font-bold text-green-700">${monthlyIncome.toFixed(2)}</p>
              </div>
              <div className="text-center p-4 bg-red-50 rounded-lg">
                <p className="text-sm text-red-600 font-medium">Monthly Expenses</p>
                <p className="text-2xl font-bold text-red-700">${monthlyExpenses.toFixed(2)}</p>
              </div>
              <div className="text-center p-4 bg-blue-50 rounded-lg">
                <p className="text-sm text-blue-600 font-medium">Net Monthly</p>
                <p className={`text-2xl font-bold ${netMonthly >= 0 ? 'text-blue-700' : 'text-red-700'}`}>
                  ${netMonthly.toFixed(2)}
                </p>
              </div>
            </div>
          </div>

          {/* Budget by Category */}
          <div className="card">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Budget by Category</h3>

            {/* Income Categories Table */}
            <div className="mb-6">
              <div className="flex justify-between items-center mb-2">
                <h4 className="text-md font-medium text-gray-700">Income</h4>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={expandAllParents}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Expand All
                  </button>
                  <button
                    type="button"
                    onClick={collapseAllParents}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Collapse All
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b-2 border-gray-200">
                      <th className="text-left py-2 px-3 text-sm font-medium text-gray-700">Category</th>
                      <th className="text-right py-2 px-3 text-sm font-medium text-gray-700">Monthly</th>
                      <th className="text-right py-2 px-3 text-sm font-medium text-gray-700">Yearly</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categories
                      .filter(cat => !cat.parentId && getParentMonthlyAmount(cat.id, 'income') > 0)
                      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
                      .flatMap(parent => {
                        const parentTotal = getParentMonthlyAmount(parent.id, 'income')
                        const isExpanded = expandedParents.has(parent.id)
                        const childCategories = categories
                          .filter(cat => cat.parentId === parent.id && getCategoryMonthlyAmount(cat.id, 'income') > 0)
                          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
                        const parentHasChildren = childCategories.length > 0

                        const rows = [
                          <tr key={parent.id} className="border-b border-gray-100">
                            <td className="py-3 px-3">
                              <div className="flex items-center space-x-2">
                                {parentHasChildren ? (
                                  <button
                                    type="button"
                                    onClick={() => toggleParentExpanded(parent.id)}
                                    className="text-gray-500 hover:text-gray-700 focus:outline-none w-4 text-xs"
                                  >
                                    {isExpanded ? '▼' : '▶'}
                                  </button>
                                ) : (
                                  <span className="w-4"></span>
                                )}
                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: parent.color }}></div>
                                <span className="font-medium text-gray-900">{parent.name}</span>
                              </div>
                            </td>
                            <td className="text-right py-3 px-3">
                              <span className="font-medium text-green-600">+${parentTotal.toFixed(2)}</span>
                            </td>
                            <td className="text-right py-3 px-3">
                              <span className="font-medium text-green-600">+${(parentTotal * 12).toFixed(2)}</span>
                            </td>
                          </tr>
                        ]

                        if (isExpanded) {
                          childCategories.forEach(child => {
                            const childTotal = getCategoryMonthlyAmount(child.id, 'income')
                            rows.push(
                              <tr key={child.id} className="border-b border-gray-100 bg-gray-50">
                                <td className="py-2 px-3 pl-10">
                                  <div className="flex items-center space-x-2">
                                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: child.color }}></div>
                                    <span className="text-sm text-gray-700">{child.name}</span>
                                  </div>
                                </td>
                                <td className="text-right py-2 px-3">
                                  <span className="text-sm text-green-600">+${childTotal.toFixed(2)}</span>
                                </td>
                                <td className="text-right py-2 px-3">
                                  <span className="text-sm text-green-600">+${(childTotal * 12).toFixed(2)}</span>
                                </td>
                              </tr>
                            )
                          })
                        }

                        return rows
                      })}
                    {/* Income Totals Row */}
                    <tr className="border-t-2 border-gray-200 bg-green-50">
                      <td className="py-3 px-3 font-bold text-gray-900">Income Total</td>
                      <td className="text-right py-3 px-3 font-bold text-green-700">
                        +${monthlyIncome.toFixed(2)}
                      </td>
                      <td className="text-right py-3 px-3 font-bold text-green-700">
                        +${(monthlyIncome * 12).toFixed(2)}
                      </td>
                    </tr>
                  </tbody>
                </table>
                {categories.filter(cat => !cat.parentId && getParentMonthlyAmount(cat.id, 'income') > 0).length === 0 && (
                  <p className="text-gray-500 text-sm py-4">No income categories found</p>
                )}
              </div>
            </div>

            {/* Expense Categories Table */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <h4 className="text-md font-medium text-gray-700">Expenses</h4>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={expandAllParents}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Expand All
                  </button>
                  <button
                    type="button"
                    onClick={collapseAllParents}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Collapse All
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b-2 border-gray-200">
                      <th className="text-left py-2 px-3 text-sm font-medium text-gray-700">Category</th>
                      <th className="text-right py-2 px-3 text-sm font-medium text-gray-700">Monthly</th>
                      <th className="text-right py-2 px-3 text-sm font-medium text-gray-700">Yearly</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categories
                      .filter(cat => !cat.parentId && getParentMonthlyAmount(cat.id, 'expense') > 0)
                      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
                      .flatMap(parent => {
                        const parentTotal = getParentMonthlyAmount(parent.id, 'expense')
                        const isExpanded = expandedParents.has(parent.id)
                        const childCategories = categories
                          .filter(cat => cat.parentId === parent.id && getCategoryMonthlyAmount(cat.id, 'expense') > 0)
                          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
                        const parentHasChildren = childCategories.length > 0

                        const rows = [
                          <tr key={parent.id} className="border-b border-gray-100">
                            <td className="py-3 px-3">
                              <div className="flex items-center space-x-2">
                                {parentHasChildren ? (
                                  <button
                                    type="button"
                                    onClick={() => toggleParentExpanded(parent.id)}
                                    className="text-gray-500 hover:text-gray-700 focus:outline-none w-4 text-xs"
                                  >
                                    {isExpanded ? '▼' : '▶'}
                                  </button>
                                ) : (
                                  <span className="w-4"></span>
                                )}
                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: parent.color }}></div>
                                <span className="font-medium text-gray-900">{parent.name}</span>
                              </div>
                            </td>
                            <td className="text-right py-3 px-3">
                              <span className="font-medium text-red-600">-${parentTotal.toFixed(2)}</span>
                            </td>
                            <td className="text-right py-3 px-3">
                              <span className="font-medium text-red-600">-${(parentTotal * 12).toFixed(2)}</span>
                            </td>
                          </tr>
                        ]

                        if (isExpanded) {
                          childCategories.forEach(child => {
                            const childTotal = getCategoryMonthlyAmount(child.id, 'expense')
                            rows.push(
                              <tr key={child.id} className="border-b border-gray-100 bg-gray-50">
                                <td className="py-2 px-3 pl-10">
                                  <div className="flex items-center space-x-2">
                                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: child.color }}></div>
                                    <span className="text-sm text-gray-700">{child.name}</span>
                                  </div>
                                </td>
                                <td className="text-right py-2 px-3">
                                  <span className="text-sm text-red-600">-${childTotal.toFixed(2)}</span>
                                </td>
                                <td className="text-right py-2 px-3">
                                  <span className="text-sm text-red-600">-${(childTotal * 12).toFixed(2)}</span>
                                </td>
                              </tr>
                            )
                          })
                        }

                        return rows
                      })}
                    {/* Expense Totals Row */}
                    <tr className="border-t-2 border-gray-200 bg-red-50">
                      <td className="py-3 px-3 font-bold text-gray-900">Expense Total</td>
                      <td className="text-right py-3 px-3 font-bold text-red-700">
                        -${monthlyExpenses.toFixed(2)}
                      </td>
                      <td className="text-right py-3 px-3 font-bold text-red-700">
                        -${(monthlyExpenses * 12).toFixed(2)}
                      </td>
                    </tr>
                  </tbody>
                </table>
                {categories.filter(cat => !cat.parentId && getParentMonthlyAmount(cat.id, 'expense') > 0).length === 0 && (
                  <p className="text-gray-500 text-sm py-4">No expense categories found</p>
                )}
              </div>
            </div>

            {/* Overall Summary */}
            <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-sm text-blue-600 font-medium">Monthly Net</p>
                  <p className={`text-lg font-bold ${netMonthly >= 0 ? 'text-blue-700' : 'text-red-700'}`}>
                    ${netMonthly.toFixed(2)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-blue-600 font-medium">Yearly Net</p>
                  <p className={`text-lg font-bold ${netMonthly >= 0 ? 'text-blue-700' : 'text-red-700'}`}>
                    ${(netMonthly * 12).toFixed(2)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-blue-600 font-medium">Savings Rate</p>
                  <p className="text-lg font-bold text-blue-700">
                    {monthlyIncome > 0 ? ((netMonthly / monthlyIncome) * 100).toFixed(1) : '0'}%
                  </p>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {activeTab === 'item' && (
        <>
          {/* Budget Summary */}
          <div className="card">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium text-gray-900">Budget Summary</h3>
              <button
                type="button"
                className="btn-secondary text-sm"
                onClick={openBalanceModal}
              >
                Update Current Balances
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="text-center p-4 bg-green-50 rounded-lg">
                <p className="text-sm text-green-600 font-medium">Monthly Income</p>
                <p className="text-2xl font-bold text-green-700">${monthlyIncome.toFixed(2)}</p>
              </div>
              <div className="text-center p-4 bg-red-50 rounded-lg">
                <p className="text-sm text-red-600 font-medium">Monthly Expenses</p>
                <p className="text-2xl font-bold text-red-700">${monthlyExpenses.toFixed(2)}</p>
              </div>
              <div className="text-center p-4 bg-blue-50 rounded-lg">
                <p className="text-sm text-blue-600 font-medium">Net Monthly</p>
                <p className={`text-2xl font-bold ${netMonthly >= 0 ? 'text-blue-700' : 'text-red-700'}`}>
                  ${netMonthly.toFixed(2)}
                </p>
              </div>
            </div>
          </div>

          {/* Budget by Item */}
          <div className="card">
            <div className="flex flex-wrap items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900">Budget by Item</h3>
              {/* Field visibility toggles */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-gray-600 font-medium">Show fields:</span>
                {ALL_BUDGET_FIELDS.map(field => (
                  <label
                    key={field}
                    className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-xs cursor-pointer select-none border ${
                      isFieldVisible(field)
                        ? 'bg-blue-50 border-blue-200 text-blue-700'
                        : 'bg-white border-gray-200 text-gray-500'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="form-checkbox h-3 w-3 rounded"
                      checked={isFieldVisible(field)}
                      onChange={() => toggleFieldVisibility(field)}
                    />
                    <span className="capitalize">{field === 'startDate' ? 'Start Date' : field}</span>
                  </label>
                ))}
                <button
                  type="button"
                  className="text-xs text-blue-600 hover:text-blue-800 underline ml-1"
                  onClick={resetVisibleFields}
                >
                  Reset
                </button>
              </div>
            </div>
            
            {/* Income Items Table */}
            <div className="mb-6">
              <h4 className="text-md font-medium text-gray-700 mb-2">Income Items</h4>
              <div>
                <table className="w-full border-collapse table-fixed">
                  <colgroup>{getColGroup()}</colgroup>
                  <thead>
                    <tr className="border-b-2 border-gray-200">
                      {isFieldVisible('transaction') && <th className="text-left py-2 px-3 text-sm font-medium text-gray-700">Transaction</th>}
                      {isFieldVisible('category') && <th className="text-left py-2 px-3 text-sm font-medium text-gray-700">Category</th>}
                      {isFieldVisible('startDate') && <th className="text-left py-2 px-3 text-sm font-medium text-gray-700">Start Date</th>}
                      {isFieldVisible('amount') && <th className="text-right py-2 px-3 text-sm font-medium text-gray-700">Amount</th>}
                      {isFieldVisible('frequency') && <th className="text-left py-2 px-3 text-sm font-medium text-gray-700">Frequency</th>}
                      {isFieldVisible('account') && <th className="text-left py-2 px-3 text-sm font-medium text-gray-700">Account</th>}
                      {isFieldVisible('monthly') && <th className="text-right py-2 px-3 text-sm font-medium text-gray-700">Monthly</th>}
                      {isFieldVisible('yearly') && <th className="text-right py-2 px-3 text-sm font-medium text-gray-700">Yearly</th>}
                      {isFieldVisible('actions') && <th className="text-center py-2 px-3 text-sm font-medium text-gray-700">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {transactions
                      .filter(t => t.type === 'income' && t.isActive && t.id)
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map(transaction => {
                        const category = categories.find(c => c.id === transaction.categoryId)
                        const monthlyAmount = getTransactionMonthlyAmount(transaction)
                        const yearlyAmount = monthlyAmount * 12
                        const isEditing = !!editingTransaction && editingTransaction === transaction.id
                        const now = new Date()
                        const isPaused = !!(transaction.pauseStartDate && transaction.pauseEndDate &&
                          now >= createSafeDate(transaction.pauseStartDate) &&
                          now <= createSafeDate(transaction.pauseEndDate))

                        return (
                          <tr key={transaction.id} className="border-b border-gray-100">
                            {isFieldVisible('transaction') && (
                              <td className="py-3 px-3">
                                {isEditing ? (
                                  <div className="space-y-2">
                                    <input
                                      type="text"
                                      value={editFormData.name}
                                      onChange={(e) => setEditFormData({...editFormData, name: e.target.value})}
                                      className="input-field text-sm w-full"
                                    />
                                    <div className="h-4"></div>
                                  </div>
                                ) : (
                                  <div className="flex items-center space-x-2">
                                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: category?.color || '#6B7280' }}></div>
                                    <span className="font-medium text-gray-900">{transaction.name}</span>
                                    {isPaused && <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 font-medium">⏸ Paused</span>}
                                  </div>
                                )}
                              </td>
                            )}
                            {isFieldVisible('category') && (
                              <td className="py-3 px-3">
                                {isEditing ? (
                                  <div className="space-y-2">
                                    <CategorySelector
                                      categories={categories}
                                      selectedCategoryId={editFormData.categoryId}
                                      onChange={(id: string) => setEditFormData({...editFormData, categoryId: id})}
                                      onCategoryAdded={(cat: Category) => {
                                        setCategories(prev => [...prev, cat])
                                        setEditFormData(prev => ({...prev!, categoryId: cat.id}))
                                      }}
                                      className="input-field text-sm w-full"
                                    />
                                    <div className="h-4"></div>
                                  </div>
                                ) : (
                                  <span className="text-sm text-gray-600">{transaction.categoryName || category?.name || 'Uncategorized'}</span>
                                )}
                              </td>
                            )}
                            {isFieldVisible('startDate') && (
                              <td className="py-3 px-3">
                                {isEditing ? (
                                  <input
                                    type="date"
                                    value={editFormData.startDate}
                                    onChange={(e) => setEditFormData({...editFormData, startDate: e.target.value})}
                                    className="input-field text-sm w-full"
                                  />
                                ) : (
                                  <span className="text-sm text-gray-900">
                                    {formatDateForDisplay(transaction.startDate)}
                                  </span>
                                )}
                              </td>
                            )}
                            {isFieldVisible('amount') && !isEditing && (
                              <td className="text-right py-3 px-3">
                                <span className={`font-medium ${
                                  transaction.type === 'income' ? 'text-green-600' : transaction.type === 'expense' ? 'text-red-600' : 'text-gray-600'
                                }`}>
                                  {transaction.type === 'income' ? '+' : transaction.type === 'expense' ? '-' : transaction.amount >= 0 ? '+' : ''}${Math.abs(transaction.amount).toFixed(2)}
                                </span>
                              </td>
                            )}
                            {isFieldVisible('frequency') && (
                              <td className="py-3 px-3">
                                {isEditing ? (
                                  <div className="space-y-2">
                                    <div className="flex items-center space-x-2">
                                      <span className="text-sm text-gray-600">Every</span>
                                      <input
                                        type="number"
                                        min="1"
                                        value={editFormData.frequency?.value || 1}
                                        onChange={(e) => setEditFormData({
                                          ...editFormData,
                                          frequency: {...editFormData.frequency, value: parseInt(e.target.value) || 1}
                                        })}
                                        className="input-field text-sm w-20"
                                      />
                                      <select
                                        value={editFormData.frequency?.unit || 'months'}
                                        onChange={(e) => {
                                          const newUnit = e.target.value as any
                                          if (newUnit === 'custom') {
                                            if (editFormData.startDate) {
                                              const date = createSafeDate(editFormData.startDate)
                                              const dayOfMonth = date.getDate()
                                              const month = date.getMonth()
                                              const dayOfWeek = date.getDay()
                                              setWeekDays(prev => {
                                                const newDays = [...prev]
                                                for (let i = 0; i < 7; i++) { newDays[i] = i === dayOfWeek }
                                                return newDays
                                              })
                                              setMonthDays(prev => {
                                                const newDays = [...prev]
                                                newDays[dayOfMonth - 1] = true
                                                return newDays
                                              })
                                              setYearMonthPattern({ months: [month], day: dayOfMonth })
                                              setMonthPatternType('specific')
                                              setShowMonthDates(false)
                                              setYearPatternType('month')
                                              setShowYearMonths(false)
                                            }
                                            setFrequencyCustomizeContext('add')
                                            setShowFrequencyCustomize(true)
                                          } else {
                                            setEditFormData({
                                              ...editFormData,
                                              frequency: {...editFormData.frequency, unit: newUnit}
                                            })
                                          }
                                        }}
                                        className="input-field text-sm"
                                      >
                                        <option value="days">day(s)</option>
                                        <option value="weeks">week(s)</option>
                                        <option value="months">month(s)</option>
                                        <option value="years">year(s)</option>
                                        <option value="custom">custom</option>
                                      </select>
                                    </div>
                                    {editFormData.frequency?.unit === 'custom' && editFormData.frequency?.customPattern && (
                                      <div className="text-xs text-gray-600 mt-1">
                                        {getFrequencyDescription(editFormData.frequency)}
                                      </div>
                                    )}
                                    <div className="h-4"></div>
                                  </div>
                                ) : (
                                  <span className="text-sm text-gray-900">
                                    {getFrequencyDescription(transaction.frequency)}
                                  </span>
                                )}
                              </td>
                            )}
                            {isFieldVisible('account') && (
                              <td className="py-3 px-3">
                                {isEditing ? (
                                  <select
                                    value={editFormData.accountId}
                                    onChange={(e) => setEditFormData({...editFormData, accountId: e.target.value})}
                                    className="input-field text-sm w-full"
                                  >
                                    <option value="">Select Account</option>
                                    {accounts.map(account => (
                                      <option key={account.id} value={account.id}>
                                        {account.name}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <span className="text-sm text-gray-900">
                                    {transaction.accountName || accounts.find(a => a.id === transaction.accountId)?.name || 'Unknown'}
                                  </span>
                                )}
                              </td>
                            )}
                            {isFieldVisible('monthly') && (
                              <td className="py-3 px-3" colSpan={isEditing && isFieldVisible('yearly') ? 2 : 1}>
                                {isEditing ? (
                                  <div className="space-y-2">
                                    <div>
                                      <label className="text-xs text-gray-600 font-medium">Transaction Amount</label>
                                      <input
                                        type="number"
                                        value={editFormData.amount}
                                        onChange={(e) => setEditFormData({...editFormData, amount: e.target.value})}
                                        className="input-field text-sm w-32 text-right"
                                      />
                                    </div>
                                    <div className="h-4"></div>
                                  </div>
                                ) : (
                                  <span className="font-medium text-green-600">+${monthlyAmount.toFixed(2)}</span>
                                )}
                              </td>
                            )}
                            {isFieldVisible('yearly') && !isEditing && (
                              <td className="text-right py-3 px-3">
                                <span className="font-medium text-green-600">+${yearlyAmount.toFixed(2)}</span>
                              </td>
                            )}
                            {isFieldVisible('actions') && (
                              <td className="text-center py-3 px-3">
                                {isEditing ? (
                                  <div className="flex justify-center space-x-1">
                                    <button
                                      onClick={cancelEdit}
                                      className="btn-secondary text-xs"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      onClick={() => saveEditTransaction(transaction.id)}
                                      disabled={!editFormData.name.trim() || !editFormData.amount || !editFormData.startDate || !editFormData.accountId || !editFormData.categoryId || !editFormData.type || (editFormData.isTransfer && !editFormData.transferToAccountId)}
                                      className="btn-primary text-xs disabled:opacity-50"
                                    >
                                      Save
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex gap-1">
                                    <button
                                      onClick={() => startEditTransaction(transaction)}
                                      className="btn-secondary text-xs"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      onClick={() => handleDeleteTransaction(transaction)}
                                      className="text-xs px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50"
                                      title="Delete transaction"
                                    >
                                      Delete
                                    </button>
                                  </div>
                                )}
                              </td>
                            )}
                          </tr>
                        )
                      })}
                    {/* Income Totals Row */}
                    <tr className="border-t-2 border-gray-200 bg-green-50">
                      {isFieldVisible('transaction') && <td className="py-3 px-3 font-bold text-gray-900">Income Total</td>}
                      {isFieldVisible('category') && <td className="py-3 px-3"></td>}
                      {isFieldVisible('startDate') && <td className="py-3 px-3"></td>}
                      {isFieldVisible('amount') && <td className="py-3 px-3"></td>}
                      {isFieldVisible('frequency') && <td className="py-3 px-3"></td>}
                      {isFieldVisible('account') && <td className="py-3 px-3"></td>}
                      {isFieldVisible('monthly') && (
                        <td className="text-right py-3 px-3 font-bold text-green-700">
                          +${monthlyIncome.toFixed(2)}
                        </td>
                      )}
                      {isFieldVisible('yearly') && (
                        <td className="text-right py-3 px-3 font-bold text-green-700">
                          +${(monthlyIncome * 12).toFixed(2)}
                        </td>
                      )}
                      {isFieldVisible('actions') && <td className="py-3 px-3"></td>}
                    </tr>
                  </tbody>
                </table>
                {transactions.filter(t => t.type === 'income' && t.isActive && t.id).length === 0 && (
                  <p className="text-gray-500 text-sm py-4">No income transactions found</p>
                )}
              </div>
            </div>

            {/* Expense Items Table */}
            <div>
              <h4 className="text-md font-medium text-gray-700 mb-2">Expense Items</h4>
              <div>
                <table className="w-full border-collapse table-fixed">
                  <colgroup>{getColGroup()}</colgroup>
                  <thead>
                    <tr className="border-b-2 border-gray-200">
                      {isFieldVisible('transaction') && <th className="text-left py-2 px-3 text-sm font-medium text-gray-700">Transaction</th>}
                      {isFieldVisible('category') && <th className="text-left py-2 px-3 text-sm font-medium text-gray-700">Category</th>}
                      {isFieldVisible('startDate') && <th className="text-left py-2 px-3 text-sm font-medium text-gray-700">Start Date</th>}
                      {isFieldVisible('amount') && <th className="text-right py-2 px-3 text-sm font-medium text-gray-700">Amount</th>}
                      {isFieldVisible('frequency') && <th className="text-left py-2 px-3 text-sm font-medium text-gray-700">Frequency</th>}
                      {isFieldVisible('account') && <th className="text-left py-2 px-3 text-sm font-medium text-gray-700">Account</th>}
                      {isFieldVisible('monthly') && <th className="text-right py-2 px-3 text-sm font-medium text-gray-700">Monthly</th>}
                      {isFieldVisible('yearly') && <th className="text-right py-2 px-3 text-sm font-medium text-gray-700">Yearly</th>}
                      {isFieldVisible('actions') && <th className="text-center py-2 px-3 text-sm font-medium text-gray-700">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {transactions
                      .filter(t => t.type === 'expense' && t.isActive && t.id)
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map(transaction => {
                        const category = categories.find(c => c.id === transaction.categoryId)
                        const monthlyAmount = getTransactionMonthlyAmount(transaction)
                        const yearlyAmount = monthlyAmount * 12
                        const isEditing = !!editingTransaction && editingTransaction === transaction.id
                        const now = new Date()
                        const isPaused = !!(transaction.pauseStartDate && transaction.pauseEndDate &&
                          now >= createSafeDate(transaction.pauseStartDate) &&
                          now <= createSafeDate(transaction.pauseEndDate))

                        return (
                          <tr key={transaction.id} className="border-b border-gray-100">
                            {isFieldVisible('transaction') && (
                              <td className="py-3 px-3">
                                {isEditing ? (
                                  <div className="space-y-2">
                                    <input
                                      type="text"
                                      value={editFormData.name}
                                      onChange={(e) => setEditFormData({...editFormData, name: e.target.value})}
                                      className="input-field text-sm w-full"
                                    />
                                    <div className="h-4"></div>
                                  </div>
                                ) : (
                                  <div className="flex items-center space-x-2">
                                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: category?.color || '#6B7280' }}></div>
                                    <span className="font-medium text-gray-900">{transaction.name}</span>
                                    {isPaused && <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 font-medium">⏸ Paused</span>}
                                  </div>
                                )}
                              </td>
                            )}
                            {isFieldVisible('category') && (
                              <td className="py-3 px-3">
                                {isEditing ? (
                                  <div className="space-y-2">
                                    <CategorySelector
                                      categories={categories}
                                      selectedCategoryId={editFormData.categoryId}
                                      onChange={(id: string) => setEditFormData({...editFormData, categoryId: id})}
                                      onCategoryAdded={(cat: Category) => {
                                        setCategories(prev => [...prev, cat])
                                        setEditFormData(prev => ({...prev!, categoryId: cat.id}))
                                      }}
                                      className="input-field text-sm w-full"
                                    />
                                    <div className="h-4"></div>
                                  </div>
                                ) : (
                                  <span className="text-sm text-gray-600">{transaction.categoryName || category?.name || 'Uncategorized'}</span>
                                )}
                              </td>
                            )}
                            {isFieldVisible('startDate') && (
                              <td className="py-3 px-3">
                                {isEditing ? (
                                  <input
                                    type="date"
                                    value={editFormData.startDate}
                                    onChange={(e) => setEditFormData({...editFormData, startDate: e.target.value})}
                                    className="input-field text-sm w-full"
                                  />
                                ) : (
                                  <span className="text-sm text-gray-900">
                                    {formatDateForDisplay(transaction.startDate)}
                                  </span>
                                )}
                              </td>
                            )}
                            {isFieldVisible('amount') && !isEditing && (
                              <td className="text-right py-3 px-3">
                                <span className={`font-medium ${
                                  transaction.type === 'income' ? 'text-green-600' : transaction.type === 'expense' ? 'text-red-600' : 'text-gray-600'
                                }`}>
                                  {transaction.type === 'income' ? '+' : transaction.type === 'expense' ? '-' : transaction.amount >= 0 ? '+' : ''}${Math.abs(transaction.amount).toFixed(2)}
                                </span>
                              </td>
                            )}
                            {isFieldVisible('frequency') && (
                              <td className="py-3 px-3">
                                {isEditing ? (
                                  <div className="space-y-2">
                                    <div className="flex items-center space-x-2">
                                      <span className="text-sm text-gray-600">Every</span>
                                      <input
                                        type="number"
                                        min="1"
                                        value={editFormData.frequency?.value || 1}
                                        onChange={(e) => setEditFormData({
                                          ...editFormData,
                                          frequency: {...editFormData.frequency, value: parseInt(e.target.value) || 1}
                                        })}
                                        className="input-field text-sm w-20"
                                      />
                                      <select
                                        value={editFormData.frequency?.unit || 'months'}
                                        onChange={(e) => {
                                          const newUnit = e.target.value as any
                                          if (newUnit === 'custom') {
                                            if (editFormData.startDate) {
                                              const date = createSafeDate(editFormData.startDate)
                                              const dayOfMonth = date.getDate()
                                              const month = date.getMonth()
                                              const dayOfWeek = date.getDay()
                                              setWeekDays(prev => {
                                                const newDays = [...prev]
                                                for (let i = 0; i < 7; i++) { newDays[i] = i === dayOfWeek }
                                                return newDays
                                              })
                                              setMonthDays(prev => {
                                                const newDays = [...prev]
                                                newDays[dayOfMonth - 1] = true
                                                return newDays
                                              })
                                              setYearMonthPattern({ months: [month], day: dayOfMonth })
                                              setMonthPatternType('specific')
                                              setShowMonthDates(false)
                                              setYearPatternType('month')
                                              setShowYearMonths(false)
                                            }
                                            setFrequencyCustomizeContext('add')
                                            setShowFrequencyCustomize(true)
                                          } else {
                                            setEditFormData({
                                              ...editFormData,
                                              frequency: {...editFormData.frequency, unit: newUnit}
                                            })
                                          }
                                        }}
                                        className="input-field text-sm"
                                      >
                                        <option value="days">day(s)</option>
                                        <option value="weeks">week(s)</option>
                                        <option value="months">month(s)</option>
                                        <option value="years">year(s)</option>
                                        <option value="custom">custom</option>
                                      </select>
                                    </div>
                                    {editFormData.frequency?.unit === 'custom' && editFormData.frequency?.customPattern && (
                                      <div className="text-xs text-gray-600 mt-1">
                                        {getFrequencyDescription(editFormData.frequency)}
                                      </div>
                                    )}
                                    <div className="h-4"></div>
                                  </div>
                                ) : (
                                  <span className="text-sm text-gray-900">
                                    {getFrequencyDescription(transaction.frequency)}
                                  </span>
                                )}
                              </td>
                            )}
                            {isFieldVisible('account') && (
                              <td className="py-3 px-3">
                                {isEditing ? (
                                  <select
                                    value={editFormData.accountId}
                                    onChange={(e) => setEditFormData({...editFormData, accountId: e.target.value})}
                                    className="input-field text-sm w-full"
                                  >
                                    <option value="">Select Account</option>
                                    {accounts.map(account => (
                                      <option key={account.id} value={account.id}>
                                        {account.name}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <span className="text-sm text-gray-900">
                                    {transaction.accountName || accounts.find(a => a.id === transaction.accountId)?.name || 'Unknown'}
                                  </span>
                                )}
                              </td>
                            )}
                            {isFieldVisible('monthly') && (
                              <td className="py-3 px-3" colSpan={isEditing && isFieldVisible('yearly') ? 2 : 1}>
                                {isEditing ? (
                                  <div className="space-y-2">
                                    <div>
                                      <label className="text-xs text-gray-600 font-medium">Transaction Amount</label>
                                      <input
                                        type="number"
                                        value={Math.abs(parseFloat(editFormData.amount))}
                                        onChange={(e) => setEditFormData({...editFormData, amount: e.target.value})}
                                        className="input-field text-sm w-32 text-right"
                                      />
                                    </div>
                                    <div className="h-4"></div>
                                  </div>
                                ) : (
                                  <span className="font-medium text-red-600">-${Math.abs(monthlyAmount).toFixed(2)}</span>
                                )}
                              </td>
                            )}
                            {isFieldVisible('yearly') && !isEditing && (
                              <td className="text-right py-3 px-3">
                                <span className="font-medium text-red-600">-${Math.abs(yearlyAmount).toFixed(2)}</span>
                              </td>
                            )}
                            {isFieldVisible('actions') && (
                              <td className="text-center py-3 px-3">
                                {isEditing ? (
                                  <div className="flex justify-center space-x-1">
                                    <button
                                      onClick={cancelEdit}
                                      className="btn-secondary text-xs"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      onClick={() => saveEditTransaction(transaction.id)}
                                      disabled={!editFormData.name.trim() || !editFormData.amount || !editFormData.startDate || !editFormData.accountId || !editFormData.categoryId || !editFormData.type || (editFormData.isTransfer && !editFormData.transferToAccountId)}
                                      className="btn-primary text-xs disabled:opacity-50"
                                    >
                                      Save
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex gap-1">
                                    <button
                                      onClick={() => startEditTransaction(transaction)}
                                      className="btn-secondary text-xs"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      onClick={() => handleDeleteTransaction(transaction)}
                                      className="text-xs px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50"
                                      title="Delete transaction"
                                    >
                                      Delete
                                    </button>
                                  </div>
                                )}
                              </td>
                            )}
                          </tr>
                        )
                      })}
                    {/* Expense Totals Row */}
                    <tr className="border-t-2 border-gray-200 bg-red-50">
                      {isFieldVisible('transaction') && <td className="py-3 px-3 font-bold text-gray-900">Expense Total</td>}
                      {isFieldVisible('category') && <td className="py-3 px-3"></td>}
                      {isFieldVisible('startDate') && <td className="py-3 px-3"></td>}
                      {isFieldVisible('amount') && <td className="py-3 px-3"></td>}
                      {isFieldVisible('frequency') && <td className="py-3 px-3"></td>}
                      {isFieldVisible('account') && <td className="py-3 px-3"></td>}
                      {isFieldVisible('monthly') && (
                        <td className="text-right py-3 px-3 font-bold text-red-700">
                          -${monthlyExpenses.toFixed(2)}
                        </td>
                      )}
                      {isFieldVisible('yearly') && (
                        <td className="text-right py-3 px-3 font-bold text-red-700">
                          -${(monthlyExpenses * 12).toFixed(2)}
                        </td>
                      )}
                      {isFieldVisible('actions') && <td className="py-3 px-3"></td>}
                    </tr>
                  </tbody>
                </table>
                {transactions.filter(t => t.type === 'expense' && t.isActive && t.id).length === 0 && (
                  <p className="text-gray-500 text-sm py-4">No expense transactions found</p>
                )}
              </div>
            </div>

            {/* Administrative Items Table */}
            <div>
              <h4 className="text-md font-medium text-gray-700 mb-2">Administrative Items</h4>
              <div>
                <table className="w-full border-collapse table-fixed">
                  <colgroup>{getColGroup()}</colgroup>
                  <thead>
                    <tr className="border-b-2 border-gray-200">
                      {isFieldVisible('transaction') && <th className="text-left py-2 px-3 text-sm font-medium text-gray-700">Transaction</th>}
                      {isFieldVisible('category') && <th className="text-left py-2 px-3 text-sm font-medium text-gray-700">Category</th>}
                      {isFieldVisible('startDate') && <th className="text-left py-2 px-3 text-sm font-medium text-gray-700">Start Date</th>}
                      {isFieldVisible('amount') && <th className="text-right py-2 px-3 text-sm font-medium text-gray-700">Amount</th>}
                      {isFieldVisible('frequency') && <th className="text-left py-2 px-3 text-sm font-medium text-gray-700">Frequency</th>}
                      {isFieldVisible('account') && <th className="text-left py-2 px-3 text-sm font-medium text-gray-700">Account</th>}
                      {isFieldVisible('monthly') && <th className="text-right py-2 px-3 text-sm font-medium text-gray-700">Monthly</th>}
                      {isFieldVisible('yearly') && <th className="text-right py-2 px-3 text-sm font-medium text-gray-700">Yearly</th>}
                      {isFieldVisible('actions') && <th className="text-center py-2 px-3 text-sm font-medium text-gray-700">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {transactions
                      .filter(t => t.type === 'administrative' && t.isActive && t.id)
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map(transaction => {
                        const category = categories.find(c => c.id === transaction.categoryId)
                        const monthlyAmount = getTransactionMonthlyAmount(transaction)
                        const yearlyAmount = monthlyAmount * 12
                        const isEditing = !!editingTransaction && editingTransaction === transaction.id
                        const now = new Date()
                        const isPaused = !!(transaction.pauseStartDate && transaction.pauseEndDate &&
                          now >= createSafeDate(transaction.pauseStartDate) &&
                          now <= createSafeDate(transaction.pauseEndDate))

                        return (
                          <tr key={transaction.id} className="border-b border-gray-100">
                            {isFieldVisible('transaction') && (
                              <td className="py-3 px-3">
                                {isEditing ? (
                                  <div className="space-y-2">
                                    <input
                                      type="text"
                                      value={editFormData.name}
                                      onChange={(e) => setEditFormData({...editFormData, name: e.target.value})}
                                      className="input-field text-sm w-full"
                                    />
                                    <div className="h-4"></div>
                                  </div>
                                ) : (
                                  <div className="flex items-center space-x-2">
                                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: category?.color || '#6B7280' }}></div>
                                    <span className="font-medium text-gray-900">{transaction.name}</span>
                                    {isPaused && <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 font-medium">⏸ Paused</span>}
                                  </div>
                                )}
                              </td>
                            )}
                            {isFieldVisible('category') && (
                              <td className="py-3 px-3">
                                {isEditing ? (
                                  <div className="space-y-2">
                                    <CategorySelector
                                      categories={categories}
                                      selectedCategoryId={editFormData.categoryId}
                                      onChange={(id: string) => setEditFormData({...editFormData, categoryId: id})}
                                      onCategoryAdded={(cat: Category) => {
                                        setCategories(prev => [...prev, cat])
                                        setEditFormData(prev => ({...prev!, categoryId: cat.id}))
                                      }}
                                      className="input-field text-sm w-full"
                                    />
                                    <div className="h-4"></div>
                                  </div>
                                ) : (
                                  <span className="text-sm text-gray-600">{transaction.categoryName || category?.name || 'Uncategorized'}</span>
                                )}
                              </td>
                            )}
                            {isFieldVisible('startDate') && (
                              <td className="py-3 px-3">
                                {isEditing ? (
                                  <input
                                    type="date"
                                    value={editFormData.startDate}
                                    onChange={(e) => setEditFormData({...editFormData, startDate: e.target.value})}
                                    className="input-field text-sm w-full"
                                  />
                                ) : (
                                  <span className="text-sm text-gray-900">
                                    {formatDateForDisplay(transaction.startDate)}
                                  </span>
                                )}
                              </td>
                            )}
                            {isFieldVisible('amount') && !isEditing && (
                              <td className="text-right py-3 px-3">
                                <span className={`font-medium ${
                                  transaction.type === 'income' ? 'text-green-600' : transaction.type === 'expense' ? 'text-red-600' : 'text-gray-600'
                                }`}>
                                  {transaction.type === 'income' ? '+' : transaction.type === 'expense' ? '-' : transaction.amount >= 0 ? '+' : ''}${Math.abs(transaction.amount).toFixed(2)}
                                </span>
                              </td>
                            )}
                            {isFieldVisible('frequency') && (
                              <td className="py-3 px-3">
                                {isEditing ? (
                                  <div className="space-y-2">
                                    <div className="flex items-center space-x-2">
                                      <span className="text-sm text-gray-600">Every</span>
                                      <input
                                        type="number"
                                        min="1"
                                        value={editFormData.frequency?.value || 1}
                                        onChange={(e) => setEditFormData({
                                          ...editFormData,
                                          frequency: {...editFormData.frequency, value: parseInt(e.target.value) || 1}
                                        })}
                                        className="input-field text-sm w-20"
                                      />
                                      <select
                                        value={editFormData.frequency?.unit || 'months'}
                                        onChange={(e) => {
                                          const newUnit = e.target.value as any
                                          if (newUnit === 'custom') {
                                            setFrequencyCustomizeContext('add')
                                            setShowFrequencyCustomize(true)
                                          } else {
                                            setEditFormData({
                                              ...editFormData,
                                              frequency: {...editFormData.frequency, unit: newUnit}
                                            })
                                          }
                                        }}
                                        className="input-field text-sm"
                                      >
                                        <option value="days">day(s)</option>
                                        <option value="weeks">week(s)</option>
                                        <option value="months">month(s)</option>
                                        <option value="years">year(s)</option>
                                        <option value="custom">custom</option>
                                      </select>
                                    </div>
                                    {editFormData.frequency?.unit === 'custom' && editFormData.frequency?.customPattern && (
                                      <div className="text-xs text-gray-600 mt-1">
                                        {getFrequencyDescription(editFormData.frequency)}
                                      </div>
                                    )}
                                    <div className="h-4"></div>
                                  </div>
                                ) : (
                                  <span className="text-sm text-gray-900">
                                    {getFrequencyDescription(transaction.frequency)}
                                  </span>
                                )}
                              </td>
                            )}
                            {isFieldVisible('account') && (
                              <td className="py-3 px-3">
                                {isEditing ? (
                                  <select
                                    value={editFormData.accountId}
                                    onChange={(e) => setEditFormData({...editFormData, accountId: e.target.value})}
                                    className="input-field text-sm w-full"
                                  >
                                    <option value="">Select Account</option>
                                    {accounts.map(account => (
                                      <option key={account.id} value={account.id}>
                                        {account.name}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <span className="text-sm text-gray-900">
                                    {transaction.accountName || accounts.find(a => a.id === transaction.accountId)?.name || 'Unknown'}
                                  </span>
                                )}
                              </td>
                            )}
                            {isFieldVisible('monthly') && (
                              <td className="py-3 px-3" colSpan={isEditing && isFieldVisible('yearly') ? 2 : 1}>
                                {isEditing ? (
                                  <div className="space-y-2">
                                    <div>
                                      <label className="text-xs text-gray-600 font-medium">Transaction Amount</label>
                                      <input
                                        type="number"
                                        value={editFormData.amount}
                                        onChange={(e) => setEditFormData({...editFormData, amount: e.target.value})}
                                        className="input-field text-sm w-32 text-right"
                                      />
                                    </div>
                                    <div className="h-4"></div>
                                  </div>
                                ) : (
                                  <span className={`font-medium ${monthlyAmount >= 0 ? 'text-gray-600' : 'text-gray-600'}`}>
                                    {monthlyAmount >= 0 ? '+' : ''}${monthlyAmount.toFixed(2)}
                                  </span>
                                )}
                              </td>
                            )}
                            {isFieldVisible('yearly') && !isEditing && (
                              <td className="text-right py-3 px-3">
                                <span className="font-medium text-gray-600">{yearlyAmount >= 0 ? '+' : ''}${yearlyAmount.toFixed(2)}</span>
                              </td>
                            )}
                            {isFieldVisible('actions') && (
                              <td className="text-center py-3 px-3">
                                {isEditing ? (
                                  <div className="flex justify-center space-x-1">
                                    <button
                                      onClick={cancelEdit}
                                      className="btn-secondary text-xs"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      onClick={() => saveEditTransaction(transaction.id)}
                                      disabled={!editFormData.name.trim() || !editFormData.amount || !editFormData.startDate || !editFormData.accountId || !editFormData.categoryId || !editFormData.type || (editFormData.isTransfer && !editFormData.transferToAccountId)}
                                      className="btn-primary text-xs disabled:opacity-50"
                                    >
                                      Save
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex gap-1">
                                    <button
                                      onClick={() => startEditTransaction(transaction)}
                                      className="btn-secondary text-xs"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      onClick={() => handleDeleteTransaction(transaction)}
                                      className="text-xs px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50"
                                      title="Delete transaction"
                                    >
                                      Delete
                                    </button>
                                  </div>
                                )}
                              </td>
                            )}
                          </tr>
                        )
                      })}
                    {/* Administrative Totals Row */}
                    <tr className="border-t-2 border-gray-200 bg-gray-50">
                      {isFieldVisible('transaction') && <td className="py-3 px-3 font-bold text-gray-900">Administrative Total</td>}
                      {isFieldVisible('category') && <td className="py-3 px-3"></td>}
                      {isFieldVisible('startDate') && <td className="py-3 px-3"></td>}
                      {isFieldVisible('amount') && <td className="py-3 px-3"></td>}
                      {isFieldVisible('frequency') && <td className="py-3 px-3"></td>}
                      {isFieldVisible('account') && <td className="py-3 px-3"></td>}
                      {isFieldVisible('monthly') && (
                        <td className="text-right py-3 px-3 font-bold text-gray-700">
                          {monthlyAdministrative >= 0 ? '+' : ''}${monthlyAdministrative.toFixed(2)}
                        </td>
                      )}
                      {isFieldVisible('yearly') && (
                        <td className="text-right py-3 px-3 font-bold text-gray-700">
                          {(monthlyAdministrative * 12) >= 0 ? '+' : ''}${(monthlyAdministrative * 12).toFixed(2)}
                        </td>
                      )}
                      {isFieldVisible('actions') && <td className="py-3 px-3"></td>}
                    </tr>
                  </tbody>
                </table>
                {transactions.filter(t => t.type === 'administrative' && t.isActive && t.id).length === 0 && (
                  <p className="text-gray-500 text-sm py-4">No administrative transactions found</p>
                )}
              </div>
            </div>

            {/* Overall Summary */}
            <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-sm text-blue-600 font-medium">Monthly Net</p>
                  <p className={`text-lg font-bold ${netMonthly >= 0 ? 'text-blue-700' : 'text-red-700'}`}>
                    ${netMonthly.toFixed(2)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-blue-600 font-medium">Yearly Net</p>
                  <p className={`text-lg font-bold ${netMonthly >= 0 ? 'text-blue-700' : 'text-red-700'}`}>
                    ${(netMonthly * 12).toFixed(2)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-blue-600 font-medium">Savings Rate</p>
                  <p className="text-lg font-bold text-blue-700">
                    {monthlyIncome > 0 ? ((netMonthly / monthlyIncome) * 100).toFixed(1) : '0'}%
                  </p>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {activeTab === 'analytics' && (
        <>
          {/* Budget Analytics Section */}
          <div className="space-y-6">
            {/* Sticky Period Selector + Title */}
            <div className="sticky top-0 z-10 bg-white border-b border-gray-100 shadow-sm -mx-4 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Budget Analytics</h2>
                <p className="text-gray-500 text-xs">
                  {historyData.length === 0
                    ? 'Import bank data to see actual spending vs budget'
                    : 'Real spending vs budgeted — based on imported history'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">Period:</span>
                <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
                  {(['current-month', 'last-3', 'ytd'] as const).map(p => (
                    <button
                      key={p}
                      onClick={() => { setAnalyticsPeriod(p); setBvaSelectedParent(null); setBvaTableExpanded(false) }}
                      className={`px-3 py-1.5 transition-colors ${
                        analyticsPeriod === p
                          ? 'bg-blue-600 text-white'
                          : 'bg-white text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {p === 'current-month' ? 'This Month' : p === 'last-3' ? 'Last 3 Mo.' : 'YTD'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Budget Summary — with inline month navigation */}
            <BudgetSummaryWidget
              {...getCurrentMonthInfo()}
              onPrevMonth={() => setSummaryMonthOffset(o => o - 1)}
              onNextMonth={() => setSummaryMonthOffset(o => Math.min(o + 1, 0))}
              canGoNext={summaryMonthOffset < 0}
              monthContextLabel={
                summaryMonthOffset === 0 ? 'Current month' :
                summaryMonthOffset === -1 ? 'Previous month' :
                `${Math.abs(summaryMonthOffset)} months ago`
              }
            />

            {/* Budget vs Actual — full width with drilldown */}
            <BudgetVsActualWidget
              title="Budget vs Actual"
              data={getBudgetVsActualForDisplay()}
              showVariance={true}
              onCategoryClick={name => { setBvaSelectedParent(name); setBvaTableExpanded(false) }}
              onLeafClick={name => navigateToHistory(name)}
              isChildView={bvaSelectedParent !== null}
              parentCategoryName={bvaSelectedParent ?? undefined}
              onBack={() => { setBvaSelectedParent(null); setBvaTableExpanded(false) }}
              tableExpanded={bvaTableExpanded}
              onToggleExpand={() => setBvaTableExpanded(e => !e)}
            />

            {/* Spending by Category (pie) + Budget Progress side-by-side */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Spending by Category — inline card with parent/child toggle + drilldown */}
              <div className="card">
                <div className="flex flex-wrap justify-between items-center gap-2 mb-4">
                  <div className="flex items-center gap-2">
                    {spendingSelectedParent !== null && (
                      <button
                        onClick={() => setSpendingSelectedParent(null)}
                        className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                      >← Back</button>
                    )}
                    <h3 className="text-lg font-medium text-gray-900">
                      {spendingSelectedParent !== null ? spendingSelectedParent : 'Spending by Category'}
                    </h3>
                    {spendingSelectedParent !== null && (
                      <span className="text-xs text-gray-500">subcategories</span>
                    )}
                  </div>
                  {spendingSelectedParent === null && (
                    <div className="flex bg-gray-100 rounded-lg p-0.5">
                      <button
                        onClick={() => setSpendingMode('parent')}
                        className={`px-3 py-1 text-xs rounded-md transition-colors ${spendingMode === 'parent' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                      >Parent</button>
                      <button
                        onClick={() => setSpendingMode('child')}
                        className={`px-3 py-1 text-xs rounded-md transition-colors ${spendingMode === 'child' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                      >Child</button>
                    </div>
                  )}
                </div>
                <AnalyticsWidget
                  title=""
                  type="pie"
                  data={getSpendingByCategoryForDisplay()}
                  showLegend={true}
                  onSliceClick={name => {
                    if (spendingSelectedParent !== null) {
                      navigateToHistory(name)
                    } else {
                      const cat = categories.find(c => c.name === name && !c.parentId)
                      const hasChildren = cat ? categories.some(c => c.parentId === cat.id) : false
                      if (hasChildren) setSpendingSelectedParent(name)
                      else navigateToHistory(name)
                    }
                  }}
                />
                {spendingSelectedParent === null && spendingMode === 'parent' && (
                  <p className="text-xs text-gray-400 text-center mt-2">Click a category to view subcategories</p>
                )}
                {spendingSelectedParent !== null && (
                  <p className="text-xs text-gray-400 text-center mt-2">Click a subcategory to view its history</p>
                )}
              </div>

              {/* Budget Progress by Category — drilldown with History navigation */}
              <div className="card">
                <div className="flex flex-wrap justify-between items-center gap-2 mb-4">
                  <div className="flex items-center gap-2">
                    {progressSelectedParent !== null && (
                      <button
                        onClick={() => { setProgressSelectedParent(null); setProgressExpanded(false) }}
                        className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                      >← Back</button>
                    )}
                    <h3 className="text-lg font-medium text-gray-900">
                      {progressSelectedParent !== null ? progressSelectedParent : 'Budget Progress by Category'}
                    </h3>
                    {progressSelectedParent !== null && (
                      <span className="text-xs text-gray-500">subcategories</span>
                    )}
                  </div>
                </div>
                {(() => {
                  const allProgress = getBudgetProgressForDisplay()
                  const display = progressExpanded ? allProgress : allProgress.slice(0, 3)
                  if (allProgress.length === 0) {
                    return (
                      <div className="text-center py-8 text-gray-500">
                        <p>No budget data available</p>
                        <p className="text-sm mt-1">Set up budgets to see progress tracking</p>
                      </div>
                    )
                  }
                  return (
                    <>
                      <div className="space-y-4">
                        {display.map((item, index) => {
                          const pct = item.budget > 0 ? Math.min((item.actual / item.budget) * 100, 999) : 0
                          const isOver = item.actual > item.budget
                          // For credit payments, over = good; for regular, under = good
                          const isGood = item.isCredit ? isOver : !isOver
                          const barColor = pct >= 100
                            ? (item.isCredit ? 'bg-green-500' : 'bg-red-500')
                            : pct >= 80
                              ? (item.isCredit ? 'bg-green-400' : 'bg-yellow-500')
                              : (item.isCredit ? 'bg-yellow-400' : 'bg-green-500')
                          const textColor = isGood ? 'text-green-600' : (pct >= 80 ? 'text-yellow-600' : 'text-red-600')
                          const isParentMode = progressSelectedParent === null
                          const hasChildren = isParentMode
                            ? categories.some(c => c.parentId === categories.find(p => p.name === item.category)?.id)
                            : false
                          return (
                            <div
                              key={index}
                              className="space-y-1.5 cursor-pointer group"
                              onClick={() => {
                                if (isParentMode && hasChildren) {
                                  setProgressSelectedParent(item.category)
                                  setProgressExpanded(false)
                                } else if (!isParentMode) {
                                  navigateToHistory(item.category)
                                }
                              }}
                            >
                              <div className="flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                                  <span className="font-medium text-gray-900 text-sm group-hover:text-blue-700 transition-colors">
                                    {item.category}
                                    {item.isCredit && <span className="text-xs text-blue-500 bg-blue-50 px-1 rounded ml-1">credit</span>}
                                    {isParentMode && hasChildren && <span className="text-gray-400 text-xs ml-1">▸</span>}
                                  </span>
                                </div>
                                <div className="text-right">
                                  <p className={`font-medium text-sm ${textColor}`}>
                                    ${item.actual.toFixed(0)} / ${item.budget.toFixed(0)}
                                  </p>
                                  <p className="text-xs text-gray-500">{pct >= 999 ? '999+' : pct.toFixed(0)}% of target</p>
                                </div>
                              </div>
                              <div className="w-full bg-gray-200 rounded-full h-2">
                                <div className={`h-2 rounded-full transition-all duration-300 ${barColor}`}
                                  style={{ width: `${Math.min(pct, 100)}%` }} />
                              </div>
                              <div className="flex justify-between text-xs">
                                <span className="text-gray-500">
                                  {item.isCredit
                                    ? (isOver ? 'Above target — extra payment' : 'Below target')
                                    : (isOver ? 'Over budget' : 'Under budget')}
                                </span>
                                <span className={`font-medium ${isGood ? 'text-green-600' : 'text-red-600'}`}>
                                  {isOver
                                    ? `+$${Math.abs(item.budget - item.actual).toFixed(0)} ${item.isCredit ? 'extra' : 'over'}`
                                    : `$${(item.budget - item.actual).toFixed(0)} ${item.isCredit ? 'short' : 'remaining'}`}
                                </span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                      {allProgress.length > 3 && (
                        <button
                          onClick={e => { e.stopPropagation(); setProgressExpanded(v => !v) }}
                          className="mt-4 w-full py-2 text-sm text-blue-600 hover:text-blue-800 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
                        >
                          {progressExpanded ? 'Show fewer' : `Show all ${allProgress.length} categories`}
                        </button>
                      )}
                      {progressSelectedParent !== null && (
                        <p className="text-xs text-gray-400 text-center mt-2">Click a subcategory to view its history</p>
                      )}
                    </>
                  )
                })()}
              </div>
            </div>

            {/* Spending Trend — daily chart driven by period selector */}
            <div className="card">
              <div className="flex flex-wrap justify-between items-center gap-3 mb-1">
                <h3 className="text-lg font-medium text-gray-900">Spending Trend</h3>
                <span className="text-xs text-gray-500">
                  {analyticsPeriod === 'current-month' ? 'This month, daily' :
                   analyticsPeriod === 'last-3' ? 'Last 3 months, daily' : 'Year to date, daily'}
                </span>
              </div>
              <p className="text-sm text-gray-500 mb-4">Actual expense spending by day — based on the selected period</p>
              {getSpendingTrendData().some(d => d.value > 0) ? (
                <SpendingTrendChart data={getSpendingTrendData()} height={320} />
              ) : (
                <div className="h-48 flex items-center justify-center bg-gray-50 rounded-lg">
                  <p className="text-gray-500 text-sm">No spending history for the selected period</p>
                </div>
              )}
            </div>

            {/* Insights + Category Performance */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Computed Insights */}
              {(() => {
                const { overBudget, underBudget, momChange, currentSpend } = getComputedInsights()
                const noData = historyData.length === 0
                return (
                  <div className="card">
                    <h3 className="text-lg font-medium text-gray-900 mb-4">Performance Insights</h3>
                    {noData ? (
                      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
                        Import bank data to generate spending insights.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {momChange !== null && (
                          <div className={`p-3 rounded-lg border ${momChange > 0 ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
                            <p className={`font-medium ${momChange > 0 ? 'text-red-900' : 'text-green-900'}`}>
                              {momChange > 0 ? '↑' : '↓'} Month-over-Month Spending
                            </p>
                            <p className={`text-sm mt-1 ${momChange > 0 ? 'text-red-700' : 'text-green-700'}`}>
                              {Math.abs(momChange).toFixed(1)}% {momChange > 0 ? 'more' : 'less'} than last month
                              {' '}(${currentSpend.toFixed(0)} this period)
                            </p>
                          </div>
                        )}
                        {overBudget.length > 0 && (
                          <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                            <p className="font-medium text-red-900">Over Budget</p>
                            <ul className="mt-1 space-y-0.5">
                              {overBudget.map(i => (
                                <li key={i.category} className="text-sm text-red-700 flex justify-between">
                                  <span>{i.category}</span>
                                  <span>+${(i.actual - i.budget).toFixed(0)} ({((i.actual / i.budget - 1) * 100).toFixed(0)}% over)</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {underBudget.length > 0 && (
                          <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                            <p className="font-medium text-green-900">Under Budget</p>
                            <ul className="mt-1 space-y-0.5">
                              {underBudget.map(i => (
                                <li key={i.category} className="text-sm text-green-700 flex justify-between">
                                  <span>{i.category}</span>
                                  <span>${(i.budget - i.actual).toFixed(0)} remaining</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {overBudget.length === 0 && underBudget.length === 0 && (
                          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
                            All categories are within budget for this period.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* Category Performance Comparison */}
              <div className="card">
                <h3 className="text-lg font-medium text-gray-900 mb-1">Category Performance</h3>
                <p className="text-sm text-gray-500 mb-4">This month vs last month vs 3-mo. avg</p>
                {getCategoryPerformanceData().length === 0 ? (
                  <div className="p-4 bg-gray-50 rounded-lg text-sm text-gray-500">
                    No category data available. Set up budget items or import history to see performance.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left py-2 font-medium text-gray-600">Category</th>
                          <th className="text-right py-2 font-medium text-gray-600 whitespace-nowrap">This Mo.</th>
                          <th className="text-right py-2 font-medium text-gray-600 whitespace-nowrap">Last Mo.</th>
                          <th className="text-right py-2 font-medium text-gray-600 whitespace-nowrap">3-Mo. Avg</th>
                          <th className="text-right py-2 font-medium text-gray-600 whitespace-nowrap">Budgeted</th>
                          <th className="text-center py-2 font-medium text-gray-600">Trend</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {getCategoryPerformanceData().map(row => (
                          <tr key={row.category} className="hover:bg-gray-50">
                            <td className="py-2">
                              <div className="flex items-center gap-2">
                                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: row.color }} />
                                <span className="font-medium text-gray-900 truncate">{row.category}</span>
                              </div>
                            </td>
                            <td className={`py-2 text-right font-mono whitespace-nowrap ${row.budgeted > 0 && row.thisMonth > row.budgeted ? 'text-red-600' : 'text-gray-900'}`}>
                              ${row.thisMonth.toFixed(0)}
                            </td>
                            <td className="py-2 text-right font-mono text-gray-500 whitespace-nowrap">${row.lastMonth.toFixed(0)}</td>
                            <td className="py-2 text-right font-mono text-gray-500 whitespace-nowrap">${row.threeMonthAvg.toFixed(0)}</td>
                            <td className="py-2 text-right font-mono text-blue-600 whitespace-nowrap">${row.budgeted.toFixed(0)}</td>
                            <td className="py-2 text-center">
                              <span className={`text-base ${row.trend === 'up' ? 'text-red-500' : row.trend === 'down' ? 'text-green-500' : 'text-gray-400'}`}>
                                {row.trend === 'up' ? '↑' : row.trend === 'down' ? '↓' : '→'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Add Transaction Form */}
      <div id="add-transaction-form" className="card">
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-gray-900">Add Transaction</h2>
          <p className="text-gray-600 mt-1">Add a new transaction to your budget</p>
        </div>

        {formErrors.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-6">
            <p className="text-sm text-red-800 font-medium mb-2">Please fix the following errors:</p>
            <ul className="text-sm text-red-700 list-disc list-inside">
              {formErrors.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
              <div>
                <label className="form-label text-sm">Name <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  className="form-input text-sm"
                  placeholder="Transaction name"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  disabled={addingTransaction}
                />
              </div>

              <div>
                <label className="form-label text-sm">Amount <span className="text-red-500">*</span></label>
                <input
                  type="number"
                  className="form-input text-sm"
                  placeholder="0.00"
                  step="0.01"
                  value={formData.amount}
                  onChange={(e) => setFormData(prev => ({ ...prev, amount: e.target.value }))}
                  disabled={addingTransaction}
                />
              </div>

              <div>
                <label className="form-label text-sm">Type <span className="text-red-500">*</span></label>
                <select
                  className="form-input text-sm"
                  value={formData.type}
                  onChange={(e) => setFormData(prev => ({ ...prev, type: e.target.value as 'income' | 'expense' | 'administrative' | '' }))}
                  disabled={addingTransaction}
                >
                  <option value="">-- Select --</option>
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                  <option value="administrative">Administrative</option>
                </select>
              </div>

              <div>
                <label className="form-label text-sm">Start Date <span className="text-red-500">*</span></label>
                <input
                  type="date"
                  className="form-input text-sm"
                  value={formData.startDate}
                  onChange={(e) => setFormData(prev => ({ ...prev, startDate: e.target.value }))}
                  disabled={addingTransaction}
                />
              </div>

              <div>
                <label className="form-label text-sm">Category <span className="text-red-500">*</span></label>
                <CategorySelector
                  categories={categories}
                  selectedCategoryId={formData.categoryId}
                  onChange={(id: string) => setFormData({ ...formData, categoryId: id })}
                  onCategoryAdded={(cat: Category) => {
                    setCategories(prev => [...prev, cat])
                    setFormData(prev => ({ ...prev, categoryId: cat.id }))
                  }}
                  className="form-input text-sm"
                />
              </div>

              <div>
                <label className="form-label text-sm">Account <span className="text-red-500">*</span></label>
                <select
                  className="form-input text-sm"
                  value={formData.accountId}
                  onChange={(e) => setFormData(prev => ({ ...prev, accountId: e.target.value }))}
                  disabled={addingTransaction}
                >
                  <option value="">Select account</option>
                  {accounts.map(account => (
                    <option key={account.id} value={account.id}>
                      {account.name} (${account.currentBalance.toFixed(2)})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center lg:col-span-2 xl:col-span-3">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="form-checkbox"
                    checked={formData.isTransfer}
                    onChange={(e) => setFormData(prev => ({ ...prev, isTransfer: e.target.checked, transferToAccountId: e.target.checked ? prev.transferToAccountId : '' }))}
                    disabled={addingTransaction}
                  />
                  <span className="text-sm font-medium text-gray-700">Transfer</span>
                </label>
              </div>

              {formData.isTransfer && (
                <div>
                  <label className="form-label text-sm">Transfer To Account <span className="text-red-500">*</span></label>
                  <select
                    className="form-input text-sm"
                    value={formData.transferToAccountId}
                    onChange={(e) => setFormData(prev => ({ ...prev, transferToAccountId: e.target.value }))}
                    disabled={addingTransaction}
                  >
                    <option value="">Select destination account</option>
                    {accounts.filter(a => a.id !== formData.accountId).map(account => (
                      <option key={account.id} value={account.id}>
                        {account.name} (${account.currentBalance.toFixed(2)})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="mt-3">
              <label className="form-label text-sm">Frequency <span className="text-red-500">*</span></label>
              <FrequencySelector
                value={formData.frequency}
                onChange={(frequency) => setFormData(prev => ({ ...prev, frequency: { unit: frequency.unit, value: frequency.value, customPattern: frequency.customPattern } }))}
                startDate={formData.startDate}
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row justify-between items-center mt-6 space-y-3 sm:space-y-0 sm:space-x-4">
            <button
              type="button"
              className="btn-secondary w-full sm:w-auto"
              onClick={() => {
                setAddingTransaction(false)
                setFormData({
                  name: '',
                  amount: '',
                  frequency: {
                    unit: 'months',
                    value: 1,
                    customPattern: undefined
                  },
                  startDate: formatDateForStorage(new Date()),
                  categoryId: formData.categoryId,
                  accountId: formData.accountId,
                  type: formData.type,
                  isTransfer: false,
                  transferToAccountId: ''
                })
                setFormErrors([])
              }}
              disabled={addingTransaction}
            >
              Cancel
            </button>

            <div className="flex space-x-3 w-full sm:w-auto">
              <button
                type="button"
                className="btn-secondary w-full sm:w-auto"
                onClick={() => {
                  setFormData({
                    name: '',
                    amount: '',
                    frequency: {
                      unit: 'months',
                      value: 1,
                      customPattern: undefined
                    },
                    startDate: formatDateForStorage(new Date()),
                    categoryId: formData.categoryId,
                    accountId: formData.accountId,
                    type: formData.type,
                    isTransfer: false,
                    transferToAccountId: ''
                  })
                  setFormErrors([])
                }}
                disabled={addingTransaction}
              >
                Clear
              </button>
              <button
                type="submit"
                className="btn-primary w-full sm:w-auto disabled:opacity-50"
                disabled={addingTransaction || !formData.name.trim() || !formData.amount || !formData.startDate || !formData.accountId || !formData.categoryId || !formData.type || !formData.frequency || formData.frequency.value <= 0 || ((formData.frequency.unit as any) === 'custom' && !formData.frequency.customPattern?.trim()) || (formData.isTransfer && !formData.transferToAccountId)}
              >
                {addingTransaction ? 'Adding...' : 'Add Transaction'}
              </button>
            </div>
          </div>
        </form>
      </div>
      
      {/* Frequency Customization Modal - Only for Add Transaction */}
      {showFrequencyCustomize && frequencyCustomizeContext === 'add' && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium text-gray-900">Customize Frequency</h3>
              <button
                type="button"
                className="text-gray-400 hover:text-gray-600"
                onClick={() => {
                    setShowFrequencyCustomize(false)
                    setFrequencyCustomizeContext(null)
                  }}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <span>Every</span>
                <input
                  type="number"
                  min="1"
                  className="form-input w-20"
                  value={editFormData.frequency?.value || 1}
                  onChange={(e) => setEditFormData({ 
                    ...editFormData, 
                    frequency: { ...editFormData.frequency, value: parseInt(e.target.value) || 1, customPattern: undefined }
                  })}
                />
                <select
                  className="form-input"
                  value={editFormData.frequency?.unit === 'custom' ? 'months' : editFormData.frequency?.unit || 'months'}
                  onChange={(e) => {
                    const newUnit = e.target.value as any
                    setEditFormData({ 
                      ...editFormData, 
                      frequency: { ...editFormData.frequency, unit: newUnit, customPattern: undefined }
                    })
                    setMonthPatternType('specific')
                    setShowMonthDates(false)
                    setShowYearMonths(false)
                  }}
                >
                  <option value="days">day(s)</option>
                  <option value="weeks">week(s)</option>
                  <option value="months">month(s)</option>
                  <option value="years">year(s)</option>
                </select>
              </div>

              {(editFormData.frequency?.unit === 'custom' ? 'months' : editFormData.frequency?.unit) === 'weeks' && (
                <div className="space-y-3">
                  <p className="text-sm text-gray-600">Select day(s) of week:</p>
                  <div className="flex space-x-2">
                    {weekDayShortNames.map((day, index) => (
                      <button
                        key={index}
                        type="button"
                        className={`w-10 h-10 rounded border-2 text-sm font-medium transition-colors ${
                          weekDays[index]
                            ? 'border-blue-500 bg-blue-500 text-white'
                            : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                        }`}
                        onClick={() => handleWeekDayToggle(index)}
                      >
                        {day}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {(editFormData.frequency?.unit === 'custom' ? 'months' : editFormData.frequency?.unit) === 'months' && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="flex items-center">
                      <input
                        type="radio"
                        className="mr-2"
                        name="monthPattern"
                        checked={monthPatternType === 'specific' && !showMonthDates}
                        onChange={() => {
                          setMonthPatternType('specific')
                          setShowMonthDates(false)
                          setEditFormData({ ...editFormData, frequency: { ...editFormData.frequency, customPattern: undefined } })
                        }}
                      />
                      Repeat on the {editFormData.startDate ? getOrdinal(createSafeDate(editFormData.startDate).getDate()) : '1st'}
                    </label>
                    
                    <label className="flex items-center">
                      <input
                        type="radio"
                        className="mr-2"
                        name="monthPattern"
                        checked={monthPatternType === 'week'}
                        onChange={() => {
                          setMonthPatternType('week')
                          setShowMonthDates(false)
                          if (editFormData.startDate) {
                            const date = createSafeDate(editFormData.startDate)
                            const dayOfMonth = date.getDate()
                            const week = Math.ceil(dayOfMonth / 7)
                            const dayOfWeek = date.getDay()
                            setEditFormData({
                              ...editFormData,
                              frequency: {
                                ...editFormData.frequency,
                                customPattern: `week:${week},day:${dayOfWeek}`
                              }
                            })
                          }
                        }}
                      />
                      Repeat on the {editFormData.startDate ? getOrdinal(Math.ceil(createSafeDate(editFormData.startDate).getDate() / 7)) : '1st'} {editFormData.startDate ? weekDayNames[createSafeDate(editFormData.startDate).getDay()] : 'Sunday'}
                    </label>
                    
                    <label className="flex items-center">
                      <input
                        type="radio"
                        className="mr-2"
                        name="monthPattern"
                        checked={showMonthDates}
                        onChange={() => {
                          setShowMonthDates(!showMonthDates)
                          setMonthPatternType('specific')
                        }}
                      />
                      Select dates to repeat
                    </label>
                  </div>
                  
                  {showMonthDates && (
                    <div className="ml-6 space-y-2">
                      <p className="text-sm text-gray-600">Select date(s) to repeat:</p>
                      <div className="grid grid-cols-7 gap-1">
                        {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                          <button
                            key={day}
                            type="button"
                            className={`w-8 h-8 text-xs rounded border transition-colors ${
                              monthDays[day - 1]
                                ? 'border-blue-500 bg-blue-500 text-white'
                                : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                            }`}
                            onClick={() => handleMonthDayToggle(day)}
                          >
                            {day}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {(editFormData.frequency?.unit === 'custom' ? 'months' : editFormData.frequency?.unit) === 'years' && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="flex items-center">
                      <input
                        type="radio"
                        className="mr-2"
                        name="yearPattern"
                        checked={yearPatternType === 'month' && !showYearMonths}
                        onChange={() => {
                          setYearPatternType('month')
                          setShowYearMonths(false)
                          if (editFormData.startDate) {
                            const date = createSafeDate(editFormData.startDate)
                            const dayOfMonth = date.getDate()
                            const month = date.getMonth()
                            setYearMonthPattern({ months: [month], day: dayOfMonth })
                            setEditFormData({
                              ...editFormData,
                              frequency: {
                                ...editFormData.frequency,
                                customPattern: `months:${month},day:${dayOfMonth}`
                              }
                            })
                          }
                        }}
                      />
                      Repeat on {editFormData.startDate ? getOrdinal(createSafeDate(editFormData.startDate).getDate()) : '1st'} of {editFormData.startDate ? monthNames[createSafeDate(editFormData.startDate).getMonth()] : 'January'}
                    </label>
                    
                    <label className="flex items-center">
                      <input
                        type="radio"
                        className="mr-2"
                        name="yearPattern"
                        checked={yearPatternType === 'week'}
                        onChange={() => {
                          setYearPatternType('week')
                          setShowYearMonths(false)
                          if (editFormData.startDate) {
                            const date = createSafeDate(editFormData.startDate)
                            const dayOfMonth = date.getDate()
                            const month = date.getMonth()
                            const week = Math.ceil(dayOfMonth / 7)
                            const dayOfWeek = date.getDay()
                            setEditFormData({
                              ...editFormData,
                              frequency: {
                                ...editFormData.frequency,
                                customPattern: `months:${month},week:${week},day:${dayOfWeek}`
                              }
                            })
                          }
                        }}
                      />
                      Repeat on the {editFormData.startDate ? getOrdinal(Math.ceil(createSafeDate(editFormData.startDate).getDate() / 7)) : '1st'} {editFormData.startDate ? weekDayNames[createSafeDate(editFormData.startDate).getDay()] : 'Sunday'} of {editFormData.startDate ? monthNames[createSafeDate(editFormData.startDate).getMonth()] : 'January'}
                    </label>
                    
                    <label className="flex items-center">
                      <input
                        type="radio"
                        className="mr-2"
                        name="yearPattern"
                        checked={showYearMonths}
                        onChange={() => {
                          setShowYearMonths(!showYearMonths)
                          setYearPatternType('month')
                        }}
                      />
                      Select months to repeat on the {editFormData.startDate ? getOrdinal(createSafeDate(editFormData.startDate).getDate()) : '1st'}
                    </label>
                  </div>
                  
                  {showYearMonths && (
                    <div className="ml-6 space-y-2">
                      <p className="text-sm text-gray-600">Select months:</p>
                      <div className="grid grid-cols-4 gap-2">
                        {monthNames.map((month, index) => (
                          <label key={index} className="flex items-center">
                            <input
                              type="checkbox"
                              className="mr-1"
                              checked={yearMonthPattern.months.includes(index)}
                              onChange={() => handleYearMonthToggle(index)}
                            />
                            <span className="text-sm">{month}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            
            <div className="flex justify-end mt-6">
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  setEditFormData({
                    ...editFormData,
                    frequency: {
                      ...editFormData.frequency,
                      unit: 'custom'
                    }
                  })
                  setShowFrequencyCustomize(false)
                  setFrequencyCustomizeContext(null)
                }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Transaction Modal */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium text-gray-900">Edit Transaction</h3>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Transaction Name <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Enter transaction name"
                    value={editFormData.name}
                    onChange={(e) => setEditFormData(prev => ({ ...prev, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Amount <span className="text-red-500">*</span></label>
                  <input
                    type="number"
                    className="form-input"
                    placeholder="0.00"
                    step="0.01"
                    value={editFormData.amount}
                    onChange={(e) => setEditFormData(prev => ({ ...prev, amount: e.target.value }))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                  <select
                    className="form-input"
                    value={editFormData.type}
                    onChange={(e) => setEditFormData(prev => ({ ...prev, type: e.target.value as 'income' | 'expense' | 'administrative' }))}
                  >
                    <option value="expense">Expense</option>
                    <option value="income">Income</option>
                    <option value="administrative">Administrative</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Date <span className="text-red-500">*</span></label>
                  <input
                    type="date"
                    className="form-input"
                    value={editFormData.startDate}
                    onChange={(e) => setEditFormData(prev => ({ ...prev, startDate: e.target.value }))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Account <span className="text-red-500">*</span></label>
                  <select
                    className="form-input"
                    value={editFormData.accountId}
                    onChange={(e) => setEditFormData(prev => ({ ...prev, accountId: e.target.value }))}
                  >
                    <option value="">Select account</option>
                    {accounts.map(account => (
                      <option key={account.id} value={account.id}>{account.name}</option>
                    ))}
                  </select>
                </div>

                {/* Transfer controls */}
                <div className="flex items-center">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="form-checkbox h-4 w-4 text-blue-600"
                      checked={editFormData.isTransfer}
                      onChange={(e) => setEditFormData(prev => ({ ...prev, isTransfer: e.target.checked, transferToAccountId: e.target.checked ? prev.transferToAccountId : '' }))}
                    />
                    <span className="text-sm font-medium text-gray-700">Transfer</span>
                  </label>
                </div>
                {editFormData.isTransfer && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Transfer To Account <span className="text-red-500">*</span></label>
                    <select
                      className="form-input"
                      value={editFormData.transferToAccountId}
                      onChange={(e) => setEditFormData(prev => ({ ...prev, transferToAccountId: e.target.value }))}
                    >
                      <option value="">Select destination account</option>
                      {accounts
                        .filter(account => account.id !== editFormData.accountId)
                        .map(account => (
                          <option key={account.id} value={account.id}>{account.name}</option>
                        ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Category <span className="text-red-500">*</span></label>
                  <CategorySelector
                    categories={categories}
                    selectedCategoryId={editFormData.categoryId}
                    onChange={(id: string) => setEditFormData(prev => ({ ...prev, categoryId: id }))}
                    onCategoryAdded={(cat: Category) => {
                      setCategories(prev => [...prev, cat])
                      setEditFormData(prev => ({ ...prev, categoryId: cat.id }))
                    }}
                    className="form-input"
                  />
                </div>
              </div>

              {/* Pause Window Section */}
              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-md font-medium text-gray-900">Pause Window <span className="text-sm font-normal text-gray-500">(optional — for seasonal expenses)</span></h4>
                  {editFormData.pauseStartDate && editFormData.pauseEndDate && (() => {
                    const now = new Date()
                    const ps = createSafeDate(editFormData.pauseStartDate)
                    const pe = createSafeDate(editFormData.pauseEndDate)
                    const isPaused = now >= ps && now <= pe
                    return isPaused
                      ? <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800">⏸ Currently Paused</span>
                      : <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">▶ Active</span>
                  })()}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Pause From</label>
                    <input
                      type="date"
                      className="form-input"
                      value={editFormData.pauseStartDate}
                      onChange={(e) => setEditFormData(prev => ({ ...prev, pauseStartDate: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Resume On</label>
                    <input
                      type="date"
                      className="form-input"
                      value={editFormData.pauseEndDate}
                      min={editFormData.pauseStartDate || undefined}
                      onChange={(e) => setEditFormData(prev => ({ ...prev, pauseEndDate: e.target.value }))}
                    />
                  </div>
                </div>
                {(editFormData.pauseStartDate || editFormData.pauseEndDate) && (
                  <button
                    type="button"
                    className="mt-2 text-xs text-red-500 hover:text-red-700 underline"
                    onClick={() => setEditFormData(prev => ({ ...prev, pauseStartDate: '', pauseEndDate: '' }))}
                  >
                    Clear pause window
                  </button>
                )}
              </div>

              {/* Frequency Section */}
              <div className="border-t pt-4">
                <h4 className="text-md font-medium text-gray-900 mb-4">Frequency</h4>
                
                <div className="grid grid-cols-1 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Frequency</label>
                    <div className="text-gray-900 font-medium">
                      {getFrequencyDescription(editFormData.frequency)}
                    </div>
                  </div>
                  <div>
                    <button
                      type="button"
                      className="btn-secondary w-full"
                      onClick={() => {
                        // Set context to edit
                        setFrequencyCustomizeContext('edit')
                        
                        // Initialize state based on start date and current frequency before opening modal
                        if (editFormData.startDate) {
                          const date = createSafeDate(editFormData.startDate)
                          const dayOfMonth = date.getDate()
                          const month = date.getMonth()
                          const dayOfWeek = date.getDay()
                          
                          // Get current frequency unit
                          const currentUnit = editFormData.frequency?.unit === 'custom' ? 'months' : editFormData.frequency?.unit || 'months'
                          
                          // Initialize week days
                          setWeekDays(prev => {
                            const newDays = [...prev]
                            for (let i = 0; i < 7; i++) {
                              newDays[i] = i === dayOfWeek
                            }
                            return newDays
                          })
                          
                          // Initialize month days
                          setMonthDays(prev => {
                            const newDays = [...prev]
                            newDays[dayOfMonth - 1] = true
                            return newDays
                          })
                          
                          // Initialize year patterns
                          setYearMonthPattern({ months: [month], day: dayOfMonth })
                          
                          // Reset pattern types based on current unit
                          if (currentUnit === 'weeks') {
                            setMonthPatternType('week')
                            setShowMonthDates(false)
                            setYearPatternType('month')
                            setShowYearMonths(false)
                          } else if (currentUnit === 'months') {
                            setMonthPatternType('specific')
                            setShowMonthDates(false)
                            setYearPatternType('month')
                            setShowYearMonths(false)
                          } else if (currentUnit === 'years') {
                            setMonthPatternType('specific')
                            setShowMonthDates(false)
                            setYearPatternType('month')
                            setShowYearMonths(false)
                          } else {
                            // Default for days or other units
                            setMonthPatternType('specific')
                            setShowMonthDates(false)
                            setYearPatternType('month')
                            setShowYearMonths(false)
                          }
                        }
                          
                        // Open modal
                        setShowFrequencyCustomize(true)
                      }}
                    >
                      Customize Frequency
                    </button>
                  </div>
                </div>

                
                {/* Integrated Frequency Customization */}
                {showFrequencyCustomize && (
                  <div className="border rounded-lg p-4 bg-gray-50">
                    <div className="flex justify-between items-center mb-4">
                      <h4 className="text-md font-medium text-gray-900">Custom Frequency</h4>
                      <button
                        type="button"
                        className="btn-secondary text-sm"
                        onClick={() => {
                          setShowFrequencyCustomize(false)
                          setFrequencyCustomizeContext(null)
                        }}
                      >
                        Close
                      </button>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center space-x-2">
                        <span>Every</span>
                        <input
                          type="number"
                          min="1"
                          className="form-input w-20"
                          value={editFormData.frequency?.value || 1}
                          onChange={(e) => setEditFormData({ 
                            ...editFormData, 
                            frequency: { ...editFormData.frequency, value: parseInt(e.target.value) || 1, customPattern: undefined }
                          })}
                        />
                        <select
                          className="form-input"
                          value={editFormData.frequency?.unit === 'custom' ? 'months' : editFormData.frequency?.unit || 'months'}
                          onChange={(e) => {
                            const newUnit = e.target.value as any
                            setEditFormData({ 
                              ...editFormData, 
                              frequency: { ...editFormData.frequency, unit: newUnit, customPattern: undefined }
                            })
                            // Reset all pattern states when changing units
                            setMonthPatternType('specific')
                            setShowMonthDates(false)
                            setYearPatternType('month')
                            setShowYearMonths(false)
                            // Reset weekDays and monthDays arrays
                            setWeekDays([false, false, false, false, false, false, false])
                            setMonthDays(Array.from({ length: 31 }, () => false))
                            
                            // Re-initialize year pattern when switching to years
                            if (newUnit === 'years' && editFormData.startDate) {
                              const date = createSafeDate(editFormData.startDate)
                              const dayOfMonth = date.getDate()
                              const month = date.getMonth()
                              setYearMonthPattern({ months: [month], day: dayOfMonth })
                            }
                          }}
                        >
                          <option value="days">day(s)</option>
                          <option value="weeks">week(s)</option>
                          <option value="months">month(s)</option>
                          <option value="years">year(s)</option>
                        </select>
                      </div>

                      {(editFormData.frequency?.unit === 'custom' ? 'months' : editFormData.frequency?.unit) === 'weeks' && (
                        <div className="space-y-3">
                          <p className="text-sm text-gray-600">Select day(s) of week:</p>
                          <div className="flex space-x-2">
                            {weekDayShortNames.map((day, index) => (
                              <button
                                key={index}
                                type="button"
                                className={`w-10 h-10 rounded border-2 text-sm font-medium transition-colors ${
                                  weekDays[index]
                                    ? 'border-blue-500 bg-blue-500 text-white'
                                    : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                                }`}
                                onClick={() => handleWeekDayToggle(index)}
                              >
                                {day}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {(editFormData.frequency?.unit === 'custom' ? 'months' : editFormData.frequency?.unit) === 'months' && (
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <label className="flex items-center">
                              <input
                                type="radio"
                                className="mr-2"
                                name="monthPattern"
                                checked={monthPatternType === 'specific' && !showMonthDates}
                                onChange={() => {
                                  setMonthPatternType('specific')
                                  setShowMonthDates(false)
                                  setEditFormData({ ...editFormData, frequency: { ...editFormData.frequency, customPattern: undefined } })
                                }}
                              />
                              Repeat on the {editFormData.startDate ? getOrdinal(createSafeDate(editFormData.startDate).getDate()) : '1st'}
                            </label>
                            
                            <label className="flex items-center">
                              <input
                                type="radio"
                                className="mr-2"
                                name="monthPattern"
                                checked={monthPatternType === 'week'}
                                onChange={() => {
                                  setMonthPatternType('week')
                                  setShowMonthDates(false)
                                  if (editFormData.startDate) {
                                    const date = createSafeDate(editFormData.startDate)
                                    const dayOfMonth = date.getDate()
                                    const week = Math.ceil(dayOfMonth / 7)
                                    const dayOfWeek = date.getDay()
                                    setEditFormData({
                                      ...editFormData,
                                      frequency: {
                                        ...editFormData.frequency,
                                        customPattern: `week:${week},day:${dayOfWeek}`
                                      }
                                    })
                                  }
                                }}
                              />
                              Repeat on the {editFormData.startDate ? getOrdinal(Math.ceil(createSafeDate(editFormData.startDate).getDate() / 7)) : '1st'} {editFormData.startDate ? weekDayNames[createSafeDate(editFormData.startDate).getDay()] : 'Sunday'}
                            </label>
                            
                            <label className="flex items-center">
                              <input
                                type="radio"
                                className="mr-2"
                                name="monthPattern"
                                checked={showMonthDates}
                                onChange={() => {
                                  setShowMonthDates(!showMonthDates)
                                  setMonthPatternType('specific')
                                }}
                              />
                              Select dates to repeat
                            </label>
                          </div>
                          
                          {showMonthDates && (
                            <div className="ml-6 space-y-2">
                              <p className="text-sm text-gray-600">Select date(s) to repeat:</p>
                              <div className="grid grid-cols-7 gap-1">
                                {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                                  <button
                                    key={day}
                                    type="button"
                                    className={`w-8 h-8 text-xs rounded border transition-colors ${
                                      monthDays[day - 1]
                                        ? 'border-blue-500 bg-blue-500 text-white'
                                        : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                                    }`}
                                    onClick={() => handleMonthDayToggle(day)}
                                  >
                                    {day}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {(editFormData.frequency?.unit === 'custom' ? 'months' : editFormData.frequency?.unit) === 'years' && (
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <label className="flex items-center">
                              <input
                                type="radio"
                                className="mr-2"
                                name="yearPattern"
                                checked={yearPatternType === 'month' && !showYearMonths}
                                onChange={() => {
                                  setYearPatternType('month')
                                  setShowYearMonths(false)
                                  if (editFormData.startDate) {
                                    const date = createSafeDate(editFormData.startDate)
                                    const dayOfMonth = date.getDate()
                                    const month = date.getMonth()
                                    setYearMonthPattern({ months: [month], day: dayOfMonth })
                                    setEditFormData({
                                      ...editFormData,
                                      frequency: {
                                        ...editFormData.frequency,
                                        customPattern: `months:${month},day:${dayOfMonth}`
                                      }
                                    })
                                  }
                                }}
                              />
                              Repeat on {editFormData.startDate ? monthNames[createSafeDate(editFormData.startDate).getMonth()] : 'January'} {editFormData.startDate ? getOrdinal(createSafeDate(editFormData.startDate).getDate()) : '1st'}
                            </label>
                            
                            <label className="flex items-center">
                              <input
                                type="radio"
                                className="mr-2"
                                name="yearPattern"
                                checked={yearPatternType === 'week'}
                                onChange={() => {
                                  setYearPatternType('week')
                                  setShowYearMonths(false)
                                  if (editFormData.startDate) {
                                    const date = createSafeDate(editFormData.startDate)
                                    const dayOfMonth = date.getDate()
                                    const month = date.getMonth()
                                    const week = Math.ceil(dayOfMonth / 7)
                                    const dayOfWeek = date.getDay()
                                    setEditFormData({
                                      ...editFormData,
                                      frequency: {
                                        ...editFormData.frequency,
                                        customPattern: `months:${month},week:${week},day:${dayOfWeek}`
                                      }
                                    })
                                  }
                                }}
                              />
                              Repeat on the {editFormData.startDate ? getOrdinal(Math.ceil(createSafeDate(editFormData.startDate).getDate() / 7)) : '1st'} {editFormData.startDate ? weekDayNames[createSafeDate(editFormData.startDate).getDay()] : 'Sunday'} of {editFormData.startDate ? monthNames[createSafeDate(editFormData.startDate).getMonth()] : 'January'}
                            </label>
                            
                            <label className="flex items-center">
                              <input
                                type="radio"
                                className="mr-2"
                                name="yearPattern"
                                checked={showYearMonths}
                                onChange={() => {
                                  setShowYearMonths(!showYearMonths)
                                  setYearPatternType('month')
                                }}
                              />
                              Select specific months
                            </label>
                          </div>
                          
                          {showYearMonths && (
                            <div className="ml-6 space-y-2">
                              <p className="text-sm text-gray-600">Select month(s):</p>
                              <div className="grid grid-cols-3 gap-2">
                                {monthNames.map((month, index) => (
                                  <button
                                    key={index}
                                    type="button"
                                    className={`px-3 py-2 text-sm rounded border transition-colors ${
                                      yearMonthPattern.months.includes(index)
                                        ? 'border-blue-500 bg-blue-500 text-white'
                                        : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                                    }`}
                                    onClick={() => handleYearMonthToggle(index)}
                                  >
                                    {month}
                                  </button>
                                ))}
                              </div>
                              <p className="text-sm text-gray-600 mt-2">
                                Repeat on the {getOrdinal(yearMonthPattern.day)} of selected months
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button
                type="button"
                className="btn-secondary"
                onClick={cancelEdit}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary disabled:opacity-50"
                disabled={!editFormData.name.trim() || !editFormData.amount || !editFormData.startDate || !editFormData.accountId || !editFormData.categoryId || !editFormData.type || !editFormData.frequency || editFormData.frequency.value <= 0 || ((editFormData.frequency.unit as any) === 'custom' && !editFormData.frequency.customPattern?.trim()) || (editFormData.isTransfer && !editFormData.transferToAccountId)}
                onClick={() => editingTransaction && saveEditTransaction(editingTransaction)}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Balance Update Modal */}
      {showBalanceModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-lg">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Update Current Balances</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead>
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Account</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Current Balance</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">New Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {accounts.map(account => (
                    <tr key={account.id}>
                      <td className="px-4 py-2 text-sm text-gray-900">{account.name}</td>
                      <td className="px-4 py-2 text-sm text-right text-gray-600">
                        ${account.currentBalance.toFixed(2)}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <input
                          type="number"
                          step="0.01"
                          className="w-28 text-sm px-2 py-1 border rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-right"
                          value={balanceEdits[account.id] ?? account.currentBalance.toFixed(2)}
                          onChange={e => setBalanceEdits(prev => ({ ...prev, [account.id]: e.target.value }))}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end space-x-3 mt-6">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowBalanceModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleSaveBalances}
              >
                Save Balances
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Budget
