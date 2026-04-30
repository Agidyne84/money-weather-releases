// Data validation utilities

export interface ValidationResult {
  isValid: boolean
  errors: string[]
}

export const validateAccount = (account: any): ValidationResult => {
  const errors: string[] = []

  if (!account.name || typeof account.name !== 'string' || account.name.trim().length === 0) {
    errors.push('Account name is required')
  }

  if (!account.type || !['checking', 'savings', 'credit', 'investment'].includes(account.type)) {
    errors.push('Account type must be checking, savings, credit, or investment')
  }

  if (typeof account.startingBalance !== 'number' || isNaN(account.startingBalance)) {
    errors.push('Starting balance must be a valid number')
  }

  if (typeof account.includeInLowBalanceAnalysis !== 'boolean') {
    errors.push('Include in low balance analysis must be true or false')
  }

  return {
    isValid: errors.length === 0,
    errors
  }
}

export const validateCategory = (category: any): ValidationResult => {
  const errors: string[] = []

  if (!category.name || typeof category.name !== 'string' || category.name.trim().length === 0) {
    errors.push('Category name is required')
  }

  if (category.parentId && typeof category.parentId !== 'string') {
    errors.push('Parent ID must be a string')
  }

  if (!category.color || typeof category.color !== 'string' || !/^#[0-9A-F]{6}$/i.test(category.color)) {
    errors.push('Color must be a valid hex color (e.g., #FF0000)')
  }

  if (typeof category.sortOrder !== 'number' || isNaN(category.sortOrder) || category.sortOrder < 0) {
    errors.push('Sort order must be a non-negative number')
  }

  return {
    isValid: errors.length === 0,
    errors
  }
}

export const validateTransaction = (transaction: any): ValidationResult => {
  const errors: string[] = []

  if (!transaction.name || typeof transaction.name !== 'string' || transaction.name.trim().length === 0) {
    errors.push('Name is required')
  }

  if (!transaction.amount || typeof transaction.amount !== 'number' || transaction.amount === 0) {
    errors.push('Amount cannot be zero')
  }

  if (!transaction.frequencyValue || typeof transaction.frequencyValue !== 'number' || transaction.frequencyValue < 1) {
    errors.push('Frequency value must be a positive number')
  }

  if (!transaction.frequencyUnit || !['days', 'weeks', 'months', 'years', 'custom'].includes(transaction.frequencyUnit)) {
    errors.push('Frequency unit must be days, weeks, months, years, or custom')
  }

  if (transaction.frequencyUnit === 'custom' && (!transaction.customFrequencyPattern || transaction.customFrequencyPattern.trim().length === 0)) {
    errors.push('Custom frequency pattern is required when frequency unit is custom')
  }

  if (!transaction.startDate || !isValidDate(transaction.startDate)) {
    errors.push('Start date is required and must be valid')
  }

  if (transaction.endDate && !isValidDate(transaction.endDate)) {
    errors.push('End date must be valid')
  }

  if (transaction.startDate && transaction.endDate && new Date(transaction.startDate) > new Date(transaction.endDate)) {
    errors.push('End date must be on or after start date')
  }

  if (!transaction.categoryId || typeof transaction.categoryId !== 'string') {
    errors.push('Category ID is required')
  }

  if (!transaction.accountId || typeof transaction.accountId !== 'string') {
    errors.push('Account ID is required')
  }

  if (!transaction.type || !['income', 'expense', 'administrative'].includes(transaction.type)) {
    errors.push('Transaction type must be income, expense, or administrative')
  }

  if (transaction.isTransfer === true && (!transaction.transferToAccountId || typeof transaction.transferToAccountId !== 'string')) {
    errors.push('Transfer to account is required when isTransfer is true')
  }

  if (typeof transaction.isActive !== 'boolean') {
    errors.push('Is active must be true or false')
  }

  return {
    isValid: errors.length === 0,
    errors
  }
}

const isValidDate = (dateString: string): boolean => {
  const date = new Date(dateString)
  return date instanceof Date && !isNaN(date.getTime())
}

export const validatePreference = (key: string, value: string): ValidationResult => {
  const errors: string[] = []

  if (!key || typeof key !== 'string' || key.trim().length === 0) {
    errors.push('Preference key is required')
  }

  if (value === null || value === undefined) {
    errors.push('Preference value is required')
  }

  return {
    isValid: errors.length === 0,
    errors
  }
}
