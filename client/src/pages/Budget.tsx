import React, { useState, useEffect } from 'react'
import { Transaction, Category, Account } from '../types'
import { transactionsApi, categoriesApi, accountsApi } from '../services/api'
import { createSafeDate, formatDateForStorage, formatDateForDisplay, formatDateForInput } from '../utils/dateUtils'
import FrequencySelector from '../components/FrequencySelector'
import BalanceAdjustment from '../components/BalanceAdjustment'
import CategorySelector from '../components/CategorySelector'
import { 
  BudgetVsActualWidget, 
  BudgetProgressWidget, 
  BudgetSummaryWidget,
  AnalyticsWidget 
} from '../components/analytics'

const Budget: React.FC = () => {
  const [categories, setCategories] = useState<Category[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
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
  const [monthWeekPattern, setMonthWeekPattern] = useState({
    week: 1,
    dayOfWeek: 0
  })
  const [yearWeekPattern, setYearWeekPattern] = useState({
    week: 1,
    dayOfWeek: 0,
    months: [] as number[]
  })
  const [yearMonthPattern, setYearMonthPattern] = useState({
    months: [] as number[],
    day: 1
  })
  const [monthPatternType, setMonthPatternType] = useState<'specific' | 'week'>('specific')
  const [showMonthDates, setShowMonthDates] = useState(false)
  const [yearPatternType, setYearPatternType] = useState<'month' | 'week'>('month')
  const [showYearMonths, setShowYearMonths] = useState(false)

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

  const handleMonthWeekPatternChange = () => {
    setEditFormData({
      ...editFormData,
      frequency: {
        ...editFormData.frequency,
        unit: 'months',
        value: editFormData.frequency?.value || 1,
        customPattern: `week:${monthWeekPattern.week},day:${monthWeekPattern.dayOfWeek}`
      }
    })
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

  const handleYearWeekPatternChange = () => {
    if (yearWeekPattern.months.length > 0) {
      setEditFormData({
        ...editFormData,
        frequency: {
          ...editFormData.frequency,
          unit: 'years',
          value: editFormData.frequency?.value || 1,
          customPattern: `months:${yearWeekPattern.months.join(',')},week:${yearWeekPattern.week},day:${yearWeekPattern.dayOfWeek}`
        }
      })
    }
  }
  const [editFormData, setEditFormData] = useState({
    name: '',
    amount: '',
    categoryId: '',
    accountId: '',
    type: 'expense' as 'income' | 'expense' | 'administrative',
    startDate: '',
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
    type: 'expense' as 'income' | 'expense' | 'administrative'
  })
  const [manualForm, setManualForm] = useState({
    description: '',
  })

  const scrollToTransactionForm = () => {
    const formElement = document.getElementById('add-transaction-form')
    if (formElement) {
      formElement.scrollIntoView({ behavior: 'smooth' })
    }
  }

  const loadData = async () => {
    try {
      const [categoriesData, transactionsData, accountsData] = await Promise.all([
        categoriesApi.getAll(),
        transactionsApi.getAll(),
        accountsApi.getAll(),
      ])
      setCategories(categoriesData)
      setTransactions(transactionsData)
      setAccounts(accountsData)

      // Set default values for form
      if (categoriesData.length > 0) {
        const firstCategory = categoriesData.find(c => !c.parentId)
        if (firstCategory) {
          setFormData(prev => ({ ...prev, categoryId: firstCategory.id }))
        }
      }
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
    if (Number(formData.amount) === 0) errors.push('Amount cannot be zero')
    if (!formData.categoryId) errors.push('Category is required')
    if (!formData.accountId) errors.push('Account is required')
    if (!formData.startDate) errors.push('Start date is required')
    
    setFormErrors(errors)
    return errors.length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!validateForm()) return
    
    setAddingTransaction(true)
    try {
      const transactionData = {
        name: formData.name,
        amount: formData.type === 'expense' ? -Math.abs(Number(formData.amount)) : Math.abs(Number(formData.amount)),
        frequency: formData.frequency,
        startDate: createSafeDate(formData.startDate),
        categoryId: formData.categoryId,
        accountId: formData.accountId,
        type: formData.type,
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
        categoryId: formData.categoryId,
        accountId: formData.accountId,
        type: formData.type
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
      .filter(t => t.type === 'income' && t.isActive)
      .reduce((sum, t) => sum + t.amount, 0)
    
    const monthlyExpenses = transactions
      .filter(t => t.type === 'expense' && t.isActive)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0)
    
    const netMonthly = monthlyIncome - monthlyExpenses
    
    return { monthlyIncome, monthlyExpenses, netMonthly }
  }

  // Analytics data processing functions
  const getBudgetVsActualData = () => {
    return categories
      .filter(cat => !cat.parentId)
      .map(category => {
        const categoryTransactions = transactions.filter(t => 
          t.categoryId === category.id && t.type === 'expense' && t.isActive
        )
        const actualSpending = categoryTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0)
        
        // For demo purposes, use a simple budget calculation (could be enhanced with actual budget data)
        const estimatedBudget = actualSpending * 1.1 // Assume budget is 10% higher than current spending
        
        return {
          category: category.name,
          budget: estimatedBudget,
          actual: actualSpending,
          color: category.color || '#6B7280'
        }
      })
      .filter(item => item.actual > 0)
  }

  const getBudgetProgressData = () => {
    return getBudgetVsActualData().map(item => ({
      category: item.category,
      budget: item.budget,
      actual: item.actual,
      color: item.color
    }))
  }

  const getCurrentMonthInfo = () => {
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const daysPassed = now.getDate()
    const monthName = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    
    const budgetData = getBudgetVsActualData()
    const totalBudget = budgetData.reduce((sum, item) => sum + item.budget, 0)
    const totalSpent = budgetData.reduce((sum, item) => sum + item.actual, 0)
    const totalRemaining = totalBudget - totalSpent
    
    return {
      totalBudget,
      totalSpent,
      totalRemaining,
      monthName,
      daysInMonth,
      daysPassed
    }
  }

  const getSpendingByCategory = () => {
    return categories
      .filter(cat => !cat.parentId)
      .map(category => {
        const categoryTransactions = transactions.filter(t => 
          t.categoryId === category.id && t.type === 'expense'
        )
        const total = categoryTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0)
        
        return {
          label: category.name,
          value: total,
          color: category.color || '#6B7280'
        }
      })
      .filter(item => item.value > 0)
  }

  const { monthlyIncome, monthlyExpenses, netMonthly } = calculateBudgetSummary()

  // Edit transaction functions
  const startEditTransaction = (transaction: Transaction) => {
    setEditingTransaction(transaction.id)
    setEditFormData({
      name: transaction.name,
      amount: transaction.amount.toString(),
      categoryId: transaction.categoryId,
      accountId: transaction.accountId,
      type: transaction.type,
      startDate: formatDateForInput(transaction.startDate), // Use formatDateForInput to avoid timezone issues
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
      startDate: '',
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
    try {
      console.log('Saving transaction with ID:', transactionId)
      console.log('Edit form data:', editFormData)
      
      const updateData = {
        name: editFormData.name,
        amount: editFormData.type === 'expense' ? -Math.abs(Number(editFormData.amount)) : Math.abs(Number(editFormData.amount)),
        categoryId: editFormData.categoryId,
        accountId: editFormData.accountId,
        type: editFormData.type,
        startDate: createSafeDate(editFormData.startDate),
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
              <BalanceAdjustment onAdjustmentComplete={loadData} />
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
              <h4 className="text-md font-medium text-gray-700 mb-2">Income</h4>
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
                      .filter(cat => !cat.parentId && transactions.some(t => t.categoryId === cat.id && t.type === 'income'))
                      .map(category => {
                        const categoryTransactions = transactions.filter(t => t.categoryId === category.id && t.type === 'income' && t.isActive)
                        const monthlyTotal = categoryTransactions.reduce((sum, t) => sum + t.amount, 0)
                        const yearlyTotal = monthlyTotal * 12
                        
                        return (
                          <tr key={category.id} className="border-b border-gray-100">
                            <td className="py-3 px-3">
                              <div className="flex items-center space-x-2">
                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: category.color }}></div>
                                <span className="font-medium text-gray-900">{category.name}</span>
                              </div>
                            </td>
                            <td className="text-right py-3 px-3">
                              <span className="font-medium text-green-600">+${monthlyTotal.toFixed(2)}</span>
                            </td>
                            <td className="text-right py-3 px-3">
                              <span className="font-medium text-green-600">+${yearlyTotal.toFixed(2)}</span>
                            </td>
                          </tr>
                        )
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
                {categories.filter(cat => !cat.parentId && transactions.some(t => t.categoryId === cat.id && t.type === 'income')).length === 0 && (
                  <p className="text-gray-500 text-sm py-4">No income categories found</p>
                )}
              </div>
            </div>

            {/* Expense Categories Table */}
            <div>
              <h4 className="text-md font-medium text-gray-700 mb-2">Expenses</h4>
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
                      .filter(cat => !cat.parentId && transactions.some(t => t.categoryId === cat.id && t.type === 'expense'))
                      .map(category => {
                        const categoryTransactions = transactions.filter(t => t.categoryId === category.id && t.type === 'expense' && t.isActive)
                        const monthlyTotal = categoryTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0)
                        const yearlyTotal = monthlyTotal * 12
                        
                        return (
                          <tr key={category.id} className="border-b border-gray-100">
                            <td className="py-3 px-3">
                              <div className="flex items-center space-x-2">
                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: category.color }}></div>
                                <span className="font-medium text-gray-900">{category.name}</span>
                              </div>
                            </td>
                            <td className="text-right py-3 px-3">
                              <span className="font-medium text-red-600">-${monthlyTotal.toFixed(2)}</span>
                            </td>
                            <td className="text-right py-3 px-3">
                              <span className="font-medium text-red-600">-${yearlyTotal.toFixed(2)}</span>
                            </td>
                          </tr>
                        )
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
                {categories.filter(cat => !cat.parentId && transactions.some(t => t.categoryId === cat.id && t.type === 'expense')).length === 0 && (
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
              <BalanceAdjustment onAdjustmentComplete={loadData} />
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
            <h3 className="text-lg font-medium text-gray-900 mb-4">Budget by Item</h3>
            
            {/* Income Items Table */}
            <div className="mb-6">
              <h4 className="text-md font-medium text-gray-700 mb-2">Income Items</h4>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse table-fixed" style={{ minWidth: '1230px' }}>
                  {/* Lock column widths so view/edit swaps don't reflow the row. */}
                  <colgroup>
                    <col style={{ width: '200px' }} />
                    <col style={{ width: '140px' }} />
                    <col style={{ width: '100px' }} />
                    <col style={{ width: '100px' }} />
                    <col style={{ width: '120px' }} />
                    <col style={{ width: '200px' }} />
                    <col style={{ width: '90px' }} />
                    <col style={{ width: '140px' }} />
                    <col style={{ width: '140px' }} />
                  </colgroup>
                  <thead>
                    <tr className="border-b-2 border-gray-200">
                      <th className="text-left py-2 px-3 text-sm font-medium text-gray-700">Transaction</th>
                      <th className="text-left py-2 px-3 text-sm font-medium text-gray-700">Category</th>
                      <th className="text-right py-2 px-3 text-sm font-medium text-gray-700">Monthly</th>
                      <th className="text-right py-2 px-3 text-sm font-medium text-gray-700">Yearly</th>
                      <th className="text-left py-2 px-3 text-sm font-medium text-gray-700">Start Date</th>
                      <th className="text-left py-2 px-3 text-sm font-medium text-gray-700">Frequency</th>
                      <th className="text-left py-2 px-3 text-sm font-medium text-gray-700">Type</th>
                      <th className="text-left py-2 px-3 text-sm font-medium text-gray-700">Account</th>
                      <th className="text-center py-2 px-3 text-sm font-medium text-gray-700">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions
                      .filter(t => t.type === 'income' && t.isActive)
                      .map(transaction => {
                        const category = categories.find(c => c.id === transaction.categoryId)
                        const monthlyAmount = transaction.amount
                        const yearlyAmount = monthlyAmount * 12
                        const isEditing = editingTransaction === transaction.id
                        
                        return (
                          <tr key={transaction.id} className="border-b border-gray-100">
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
                                </div>
                              )}
                            </td>
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
                                <span className="text-sm text-gray-600">{category?.name || 'Uncategorized'}</span>
                              )}
                            </td>
                            <td className="py-3 px-3" colSpan={isEditing ? 2 : 1}>
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
                            {!isEditing && (
                              <td className="text-right py-3 px-3">
                                <span className="font-medium text-green-600">+${yearlyAmount.toFixed(2)}</span>
                              </td>
                            )}
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
                                        // Auto-launch modal when custom is selected
                                        if (newUnit === 'custom') {
                                          // Initialize state based on start date before opening modal
                                          if (editFormData.startDate) {
                                            const date = createSafeDate(editFormData.startDate)
                                            const dayOfMonth = date.getDate()
                                            const month = date.getMonth()
                                            const dayOfWeek = date.getDay()
                                            const week = Math.ceil(dayOfMonth / 7)
                                            
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
                                            
                                            // Initialize month pattern
                                            setMonthWeekPattern({ week, dayOfWeek })
                                            
                                            // Initialize year patterns
                                            setYearMonthPattern({ months: [month], day: dayOfMonth })
                                            setYearWeekPattern({ months: [month], week, dayOfWeek })
                                            
                                            // Reset pattern types
                                            setMonthPatternType('specific')
                                            setShowMonthDates(false)
                                            setYearPatternType('month')
                                            setShowYearMonths(false)
                                          }
                                          
                                          // Open modal
                                          setFrequencyCustomizeContext('add')
                                          setShowFrequencyCustomize(true)
                                          // Don't change the dropdown value - keep it as 'custom'
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
                            <td className="py-3 px-3">
                              {isEditing ? (
                                <select
                                  value={editFormData.type}
                                  onChange={(e) => setEditFormData({...editFormData, type: e.target.value as 'income' | 'expense' | 'administrative'})}
                                  className="input-field text-sm w-full"
                                >
                                  <option value="income">Income</option>
                                  <option value="expense">Expense</option>
                                  <option value="administrative">Administrative</option>
                                </select>
                              ) : (
                                <span className={`text-sm font-medium ${
                                  transaction.type === 'income' ? 'text-green-600' : transaction.type === 'expense' ? 'text-red-600' : 'text-gray-600'
                                }`}>
                                  {transaction.type === 'income' ? 'Income' : transaction.type === 'expense' ? 'Expense' : 'Administrative'}
                                </span>
                              )}
                            </td>
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
                                  {accounts.find(a => a.id === transaction.accountId)?.name || 'Unknown'}
                                </span>
                              )}
                            </td>
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
                                    className="btn-primary text-xs"
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
                          </tr>
                        )
                      })}
                    {/* Income Totals Row */}
                    <tr className="border-t-2 border-gray-200 bg-green-50">
                      <td className="py-3 px-3 font-bold text-gray-900">Income Total</td>
                      <td className="py-3 px-3"></td>
                      <td className="text-right py-3 px-3 font-bold text-green-700">
                        +${monthlyIncome.toFixed(2)}
                      </td>
                      <td className="text-right py-3 px-3 font-bold text-green-700">
                        +${(monthlyIncome * 12).toFixed(2)}
                      </td>
                      <td className="py-3 px-3"></td>
                      <td className="py-3 px-3"></td>
                      <td className="py-3 px-3"></td>
                      <td className="py-3 px-3"></td>
                      <td className="py-3 px-3"></td>
                    </tr>
                  </tbody>
                </table>
                {transactions.filter(t => t.type === 'income' && t.isActive).length === 0 && (
                  <p className="text-gray-500 text-sm py-4">No income transactions found</p>
                )}
              </div>
            </div>

            {/* Expense Items Table */}
            <div>
              <h4 className="text-md font-medium text-gray-700 mb-2">Expense Items</h4>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse table-fixed" style={{ minWidth: '1230px' }}>
                  {/* Lock column widths so view/edit swaps don't reflow the row. */}
                  <colgroup>
                    <col style={{ width: '200px' }} />
                    <col style={{ width: '140px' }} />
                    <col style={{ width: '100px' }} />
                    <col style={{ width: '100px' }} />
                    <col style={{ width: '120px' }} />
                    <col style={{ width: '200px' }} />
                    <col style={{ width: '90px' }} />
                    <col style={{ width: '140px' }} />
                    <col style={{ width: '140px' }} />
                  </colgroup>
                  <thead>
                    <tr className="border-b-2 border-gray-200">
                      <th className="text-left py-2 px-3 text-sm font-medium text-gray-700">Transaction</th>
                      <th className="text-left py-2 px-3 text-sm font-medium text-gray-700">Category</th>
                      <th className="text-right py-2 px-3 text-sm font-medium text-gray-700">Monthly</th>
                      <th className="text-right py-2 px-3 text-sm font-medium text-gray-700">Yearly</th>
                      <th className="text-left py-2 px-3 text-sm font-medium text-gray-700">Start Date</th>
                      <th className="text-left py-2 px-3 text-sm font-medium text-gray-700">Frequency</th>
                      <th className="text-left py-2 px-3 text-sm font-medium text-gray-700">Type</th>
                      <th className="text-left py-2 px-3 text-sm font-medium text-gray-700">Account</th>
                      <th className="text-center py-2 px-3 text-sm font-medium text-gray-700">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions
                      .filter(t => t.type === 'expense' && t.isActive)
                      .map(transaction => {
                        const category = categories.find(c => c.id === transaction.categoryId)
                        const monthlyAmount = Math.abs(transaction.amount)
                        const yearlyAmount = monthlyAmount * 12
                        const isEditing = editingTransaction === transaction.id
                        
                        return (
                          <tr key={transaction.id} className="border-b border-gray-100">
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
                                </div>
                              )}
                            </td>
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
                                <span className="text-sm text-gray-600">{category?.name || 'Uncategorized'}</span>
                              )}
                            </td>
                            <td className="py-3 px-3" colSpan={isEditing ? 2 : 1}>
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
                                <span className="font-medium text-red-600">-${monthlyAmount.toFixed(2)}</span>
                              )}
                            </td>
                            {!isEditing && (
                              <td className="text-right py-3 px-3">
                                <span className="font-medium text-red-600">-${yearlyAmount.toFixed(2)}</span>
                              </td>
                            )}
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
                                        // Auto-launch modal when custom is selected
                                        if (newUnit === 'custom') {
                                          // Initialize state based on start date before opening modal
                                          if (editFormData.startDate) {
                                            const date = createSafeDate(editFormData.startDate)
                                            const dayOfMonth = date.getDate()
                                            const month = date.getMonth()
                                            const dayOfWeek = date.getDay()
                                            const week = Math.ceil(dayOfMonth / 7)
                                            
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
                                            
                                            // Initialize month pattern
                                            setMonthWeekPattern({ week, dayOfWeek })
                                            
                                            // Initialize year patterns
                                            setYearMonthPattern({ months: [month], day: dayOfMonth })
                                            setYearWeekPattern({ months: [month], week, dayOfWeek })
                                            
                                            // Reset pattern types
                                            setMonthPatternType('specific')
                                            setShowMonthDates(false)
                                            setYearPatternType('month')
                                            setShowYearMonths(false)
                                          }
                                          
                                          // Open modal
                                          setFrequencyCustomizeContext('add')
                                          setShowFrequencyCustomize(true)
                                          // Don't change the dropdown value - keep it as 'custom'
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
                            <td className="py-3 px-3">
                              {isEditing ? (
                                <select
                                  value={editFormData.type}
                                  onChange={(e) => setEditFormData({...editFormData, type: e.target.value as 'income' | 'expense' | 'administrative'})}
                                  className="input-field text-sm w-full"
                                >
                                  <option value="income">Income</option>
                                  <option value="expense">Expense</option>
                                  <option value="administrative">Administrative</option>
                                </select>
                              ) : (
                                <span className={`text-sm font-medium ${
                                  transaction.type === 'income' ? 'text-green-600' : transaction.type === 'expense' ? 'text-red-600' : 'text-gray-600'
                                }`}>
                                  {transaction.type === 'income' ? 'Income' : transaction.type === 'expense' ? 'Expense' : 'Administrative'}
                                </span>
                              )}
                            </td>
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
                                  {accounts.find(a => a.id === transaction.accountId)?.name || 'Unknown'}
                                </span>
                              )}
                            </td>
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
                                    className="btn-primary text-xs"
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
                          </tr>
                        )
                      })}
                    {/* Expense Totals Row */}
                    <tr className="border-t-2 border-gray-200 bg-red-50">
                      <td className="py-3 px-3 font-bold text-gray-900">Expense Total</td>
                      <td className="py-3 px-3"></td>
                      <td className="text-right py-3 px-3 font-bold text-red-700">
                        -${monthlyExpenses.toFixed(2)}
                      </td>
                      <td className="text-right py-3 px-3 font-bold text-red-700">
                        -${(monthlyExpenses * 12).toFixed(2)}
                      </td>
                      <td className="py-3 px-3"></td>
                      <td className="py-3 px-3"></td>
                      <td className="py-3 px-3"></td>
                      <td className="py-3 px-3"></td>
                      <td className="py-3 px-3"></td>
                    </tr>
                  </tbody>
                </table>
                {transactions.filter(t => t.type === 'expense' && t.isActive).length === 0 && (
                  <p className="text-gray-500 text-sm py-4">No expense transactions found</p>
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
            {/* Analytics Header */}
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Budget Analytics</h2>
              <p className="text-gray-600">Deep insights into your budget performance and spending patterns</p>
            </div>

            {/* Budget Summary Widget */}
            <BudgetSummaryWidget {...getCurrentMonthInfo()} />

            {/* Budget Analytics Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Budget vs Actual Comparison */}
              <BudgetVsActualWidget
                title="Budget vs Actual Comparison"
                data={getBudgetVsActualData()}
                showVariance={true}
              />

              {/* Spending by Category */}
              <AnalyticsWidget
                title="Spending by Category"
                type="pie"
                data={getSpendingByCategory()}
              />
            </div>

            {/* Budget Progress */}
            <BudgetProgressWidget
              title="Budget Progress by Category"
              data={getBudgetProgressData()}
            />

            {/* Additional Analytics */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Budget Performance Insights */}
              <div className="card">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Budget Performance Insights</h3>
                <div className="space-y-3">
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="font-medium text-blue-900">Budget Health</p>
                    <p className="text-sm text-blue-700 mt-1">
                      Your spending is on track for most categories. Keep monitoring discretionary expenses.
                    </p>
                  </div>
                  <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                    <p className="font-medium text-green-900">Savings Opportunity</p>
                    <p className="text-sm text-green-700 mt-1">
                      You could save an additional ${Math.abs(monthlyExpenses * 0.1).toFixed(0)} by reducing expenses by 10%.
                    </p>
                  </div>
                  <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <p className="font-medium text-yellow-900">Recommendation</p>
                    <p className="text-sm text-yellow-700 mt-1">
                      Consider setting specific budget limits for variable expense categories.
                    </p>
                  </div>
                </div>
              </div>

              {/* Monthly Trend */}
              <div className="card">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Monthly Budget Trend</h3>
                <div className="h-48 flex items-center justify-center bg-gray-50 rounded-lg">
                  <p className="text-gray-500">Monthly trend chart will be displayed here</p>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Add Transaction Form */}
      <div id="add-transaction-form" className="card">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium text-gray-900">Add Transaction</h3>
          <button
            type="button"
            className="btn-secondary"
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
                type: formData.type
              })
              setFormErrors([])
            }}
          >
            Cancel
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="form-label">Transaction Name</label>
              <input
                type="text"
                className="form-input"
                placeholder="Enter transaction name"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                disabled={addingTransaction}
              />
            </div>
            <div>
              <label className="form-label">Amount</label>
              <input
                type="number"
                className="form-input"
                placeholder="0.00"
                step="0.01"
                value={formData.amount}
                onChange={(e) => setFormData(prev => ({ ...prev, amount: e.target.value }))}
                disabled={addingTransaction}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="form-label">Type</label>
              <select
                className="form-input"
                value={formData.type}
                onChange={(e) => setFormData(prev => ({ ...prev, type: e.target.value as 'income' | 'expense' | 'administrative' }))}
                disabled={addingTransaction}
              >
                <option value="income">Income</option>
                <option value="expense">Expense</option>
                <option value="administrative">Administrative</option>
              </select>
            </div>
            <div>
              <label className="form-label">Start Date</label>
              <input
                type="date"
                className="form-input"
                value={formData.startDate}
                onChange={(e) => setFormData(prev => ({ ...prev, startDate: e.target.value }))}
                disabled={addingTransaction}
              />
            </div>
            <div>
              <label className="form-label">Account</label>
              <select
                className="form-input"
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
          </div>

          <div>
            <label className="form-label">Frequency</label>
            <FrequencySelector
              value={formData.frequency}
              onChange={(frequency) => setFormData(prev => ({ ...prev, frequency: { unit: frequency.unit, value: frequency.value, customPattern: frequency.customPattern } }))}
              startDate={formData.startDate}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
            <CategorySelector
              categories={categories}
              selectedCategoryId={formData.categoryId}
              onChange={(id: string) => setFormData({ ...formData, categoryId: id })}
              onCategoryAdded={(cat: Category) => {
                setCategories(prev => [...prev, cat])
                setFormData(prev => ({ ...prev, categoryId: cat.id }))
              }}
              required
            />
          </div>

          {formErrors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-800 font-medium mb-2">Please fix the following errors:</p>
              <ul className="text-sm text-red-700 list-disc list-inside">
                {formErrors.map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              className="btn-secondary"
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
                  type: formData.type
                })
                setFormErrors([])
              }}
              disabled={addingTransaction}
            >
              Clear
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={addingTransaction}
            >
              {addingTransaction ? 'Adding...' : 'Add Transaction'}
            </button>
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
                            setMonthWeekPattern({ week, dayOfWeek })
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
                            setYearWeekPattern({ months: [month], week, dayOfWeek })
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">Transaction Name</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Enter transaction name"
                    value={editFormData.name}
                    onChange={(e) => setEditFormData(prev => ({ ...prev, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">Account</label>
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
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                  <select
                    className="form-input"
                    value={editFormData.categoryId}
                    onChange={(e) => setEditFormData(prev => ({ ...prev, categoryId: e.target.value }))}
                  >
                    <option value="">Select a category</option>
                    {categories
                      .filter(cat => cat.name.toLowerCase().includes(editFormData.type === 'income' ? 'income' : 'expense'))
                      .map(category => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                  </select>
                </div>
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
                          const week = Math.ceil(dayOfMonth / 7)
                          
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
                          
                          // Initialize month pattern
                          setMonthWeekPattern({ week, dayOfWeek })
                          
                          // Initialize year patterns
                          setYearMonthPattern({ months: [month], day: dayOfMonth })
                          setYearWeekPattern({ months: [month], week, dayOfWeek })
                          
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
                                    setMonthWeekPattern({ week, dayOfWeek })
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
                                    setYearWeekPattern({ months: [month], week, dayOfWeek })
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
                className="btn-primary"
                onClick={() => editingTransaction && saveEditTransaction(editingTransaction)}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Budget
