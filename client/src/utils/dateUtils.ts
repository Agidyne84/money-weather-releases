/**
 * Date utility functions for consistent date handling across the application
 * Addresses timezone issues with JavaScript Date objects
 */

/**
 * Creates a safe Date object that handles timezone issues correctly
 * 
 * The key issue: `new Date('YYYY-MM-DD')` is treated as UTC midnight (00:00:00 UTC)
 * When displayed in local time, this can show the previous day due to timezone offset
 * 
 * Solution: Parse YYYY-MM-DD format and create Date at noon local time
 * This avoids the midnight timezone issue while maintaining the correct date
 * 
 * @param dateInput - Date object or string in YYYY-MM-DD format
 * @returns Date object with correct local time representation
 */
export const createSafeDate = (dateInput: string | Date): Date => {
  // Handle both string and Date inputs
  let dateString: string
  if (dateInput instanceof Date) {
    // If it's already a Date object, return it directly
    return dateInput
  } else {
    // If it's a string, process it
    dateString = dateInput
  }

  if (!dateString) {
    return new Date()
  }

  try {
    // Parse YYYY-MM-DD format and create Date at noon local time to avoid timezone issues
    const parts = dateString.split('-')
    if (parts.length === 3) {
      const year = parseInt(parts[0])
      const month = parseInt(parts[1]) - 1 // JavaScript months are 0-indexed
      const day = parseInt(parts[2])
      // Create date at noon local time (not UTC) to avoid timezone offset issues
      return new Date(year, month, day, 12, 0, 0)
    }
  } catch (error) {
    console.error('Error parsing date:', error)
  }

  // Fallback to regular Date parsing
  const date = new Date(dateString)
  return isNaN(date.getTime()) ? new Date() : date
}

/**
 * Formats a Date object for storage in YYYY-MM-DD format
 * 
 * @param date - Date object
 * @returns Date string in YYYY-MM-DD format
 */
export const formatDateForStorage = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Formats a Date object or string for consistent display
 * 
 * @param dateInput - Date object or string in YYYY-MM-DD format
 * @returns Formatted date string in local time format (MM/DD/YYYY)
 */
export const formatDateForDisplay = (dateInput: Date | string): string => {
  // Convert date to proper local date string for display
  const dateObj = dateInput instanceof Date ? dateInput : createSafeDate(dateInput)
  return dateObj.toLocaleDateString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
}

/**
 * Formats a Date object for HTML date input fields
 * 
 * @param dateInput - Date object or string
 * @returns Date string in YYYY-MM-DD format (required for HTML date inputs)
 */
export const formatDateForInput = (dateInput: Date | string): string => {
  const date = dateInput instanceof Date ? dateInput : createSafeDate(dateInput)
  return formatDateForStorage(date)
}

/**
 * Creates a Date object at a specific time to avoid timezone issues
 * 
 * @param year - Full year (e.g., 2026)
 * @param month - Month (0-11, where 0 = January)
 * @param day - Day of month (1-31)
 * @param hour - Hour in 24-hour format (0-23)
 * @param minute - Minute (0-59)
 * @param second - Second (0-59)
 * @returns Date object
 */
export const createDateAtTime = (
  year: number,
  month: number,
  day: number,
  hour: number = 0,
  minute: number = 0,
  second: number = 0
): Date => {
  return new Date(year, month, day, hour, minute, second)
}

/**
 * Gets the start of a day in local time (midnight)
 * 
 * @param date - Date object
 * @returns Date object at midnight of the given day
 */
export const getStartOfDay = (date: Date): Date => {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    0, 0, 0
  )
}

/**
 * Gets the end of a day in local time (one millisecond before midnight of next day)
 * 
 * @param date - Date object
 * @returns Date object at 23:59:59.999 of the given day
 */
export const getEndOfDay = (date: Date): Date => {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23, 59, 59, 999
  )
}

/**
 * Compares two dates ignoring time components
 * 
 * @param date1 - First date
 * @param date2 - Second date
 * @returns -1 if date1 < date2, 0 if equal, 1 if date1 > date2
 */
export const compareDatesOnly = (date1: Date, date2: Date): number => {
  const d1 = new Date(date1.getFullYear(), date1.getMonth(), date1.getDate())
  const d2 = new Date(date2.getFullYear(), date2.getMonth(), date2.getDate())
  return d1.getTime() - d2.getTime()
}
