import React, { useState, useEffect } from 'react'

interface FrequencySelectorProps {
  value: {
    unit: 'days' | 'weeks' | 'months' | 'years'
    value: number
    customPattern?: string
  }
  onChange: (frequency: { unit: 'days' | 'weeks' | 'months' | 'years', value: number, customPattern?: string }) => void
  startDate?: string
}

const FrequencySelector: React.FC<FrequencySelectorProps> = ({ value, onChange, startDate }) => {
  const [showCustomize, setShowCustomize] = useState(false)
  const [weekDays, setWeekDays] = useState<boolean[]>([false, false, false, false, false, false, false])
  const [monthDays, setMonthDays] = useState<boolean[]>(Array.from({ length: 31 }, () => false))
  const [monthWeekPattern, setMonthWeekPattern] = useState({
    week: 1,
    dayOfWeek: 0
  })
  const [yearMonthPattern, setYearMonthPattern] = useState({
    months: [] as number[],
    day: 1
  })
  const [yearWeekPattern, setYearWeekPattern] = useState({
    week: 1,
    dayOfWeek: 0,
    months: [] as number[]
  })
  const [monthPatternType, setMonthPatternType] = useState<'specific' | 'week'>('specific')
  const [yearPatternType, setYearPatternType] = useState<'month' | 'week'>('month')
  const [showMonthDates, setShowMonthDates] = useState(false)
  const [showYearMonths, setShowYearMonths] = useState(false)

  const weekDayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const weekDayShortNames = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

  // Reset expanded sections when number or unit changes
  useEffect(() => {
    // Reset all expanded sections
    setMonthPatternType('specific')
    setYearPatternType('month')
    setShowMonthDates(false)
    setShowYearMonths(false)
    
    // Reset month days selection
    setMonthDays(Array.from({ length: 31 }, () => false))
    
    // Re-initialize based on new unit and start date
    if (startDate) {
      const date = new Date(startDate)
      const dayOfMonth = date.getDate()
      const month = date.getMonth()
      
      if (value.unit === 'weeks') {
        const dayOfWeek = date.getDay()
        setWeekDays(prev => {
          const newDays = [...prev]
          // Reset and only select start date day
          for (let i = 0; i < 7; i++) {
            newDays[i] = i === dayOfWeek
          }
          return newDays
        })
      } else if (value.unit === 'months') {
        setMonthWeekPattern({ week: Math.ceil(dayOfMonth / 7), dayOfWeek: date.getDay() })
        // Initialize month days with start date
        setMonthDays(prev => {
          const newDays = [...prev]
          newDays[dayOfMonth - 1] = true
          return newDays
        })
      } else if (value.unit === 'years') {
        // Always preserve the start date day
        setYearMonthPattern(prev => ({ 
          ...prev, 
          months: [month], 
          day: dayOfMonth 
        }))
        setYearWeekPattern({ months: [month], week: Math.ceil(dayOfMonth / 7), dayOfWeek: date.getDay() })
      }
    }
  }, [value.value, value.unit, startDate])

  const getOrdinal = (num: number): string => {
    const j = num % 10
    const k = num % 100
    if (j === 1 && k !== 11) return num + 'st'
    if (j === 2 && k !== 12) return num + 'nd'
    if (j === 3 && k !== 13) return num + 'rd'
    return num + 'th'
  }

  const getFrequencyDescription = (): string => {
    if (!value.customPattern) {
      return `Every ${value.value} ${value.unit}${value.value > 1 ? 's' : ''}`
    }

    if (value.unit === 'weeks' && value.customPattern.startsWith('days:')) {
      const days = value.customPattern.replace('days:', '').split(',').map(Number)
      const dayNames = days.map(d => weekDayShortNames[d]).join(', ')
      return `Every ${value.value} week${value.value > 1 ? 's' : ''} on ${dayNames}`
    }

    if (value.unit === 'months') {
      if (value.customPattern.startsWith('days:')) {
        const days = value.customPattern.replace('days:', '').split(',').map(Number)
        const dayList = days.map(d => getOrdinal(d)).join(', ')
        return `Every ${value.value} month${value.value > 1 ? 's' : ''} on the ${dayList}`
      }
      if (value.customPattern.startsWith('week:')) {
        const parts = value.customPattern.split(',')
        const week = parseInt(parts[0].replace('week:', ''))
        const day = parseInt(parts[1].replace('day:', ''))
        return `Every ${value.value} month${value.value > 1 ? 's' : ''} on the ${getOrdinal(week)} ${weekDayNames[day]}`
      }
    }

    if (value.unit === 'years') {
      if (value.customPattern.startsWith('months:') && !value.customPattern.includes('week:')) {
        // Parse the pattern correctly: "months:2,5,day:14"
        console.log('DEBUG - Raw Custom Pattern:', value.customPattern)
        
        // Find the months part and day part
        const monthsStart = value.customPattern.indexOf('months:') + 7
        const dayStart = value.customPattern.indexOf(',day:')
        
        let months: number[] = []
        let day = 1
        
        if (dayStart > -1) {
          // Extract months part (everything between "months:" and ",day:")
          const monthsPart = value.customPattern.substring(monthsStart, dayStart)
          months = monthsPart.split(',').map(Number)
          
          // Extract day part (everything after ",day:")
          const dayPart = value.customPattern.substring(dayStart + 5)
          day = parseInt(dayPart)
        }
        
        console.log('DEBUG - Months Part Extracted:', value.customPattern.substring(monthsStart, dayStart))
        console.log('DEBUG - Day Part Extracted:', value.customPattern.substring(dayStart + 5))
        console.log('DEBUG - Parsed months:', months)
        console.log('DEBUG - Parsed day:', day)
        console.log('DEBUG - Start Date day:', startDate ? new Date(startDate).getDate() : 'N/A')
        
        if (months.length === 1) {
          const selectedMonthNames = months.map(m => monthNames[m]).join(', ')
          return `Every ${value.value} year${value.value > 1 ? 's' : ''} on ${getOrdinal(day)} of ${selectedMonthNames}`
        } else {
          // For multiple months, use commas and proper format
          const sortedMonths = months.sort((a, b) => a - b)
          const monthNamesList = sortedMonths.map(m => monthNames[m]).join(', ')
          return `Every ${value.value} year${value.value > 1 ? 's' : ''} on the ${getOrdinal(day)} of ${monthNamesList}`
        }
      }
      if (value.customPattern.includes('week:')) {
        const parts = value.customPattern.split(',')
        const months = parts[0].replace('months:', '').split(',').map(Number)
        const week = parseInt(parts[1].replace('week:', ''))
        const day = parseInt(parts[2].replace('day:', ''))
        const selectedMonthNames = months.map(m => monthNames[m]).join(', ')
        return `Every ${value.value} year${value.value > 1 ? 's' : ''} on the ${getOrdinal(week)} ${weekDayNames[day]} of ${selectedMonthNames}`
      }
    }

    return `Every ${value.value} ${value.unit}${value.value > 1 ? 's' : ''}`
  }

  const handleWeekDayToggle = (index: number) => {
    // Don't allow unselecting the start date day
    if (startDate && value.unit === 'weeks') {
      const startDay = new Date(startDate).getDay()
      if (index === startDay && weekDays[index]) {
        return // Don't allow unselecting the start date day
      }
    }
    
    const newDays = [...weekDays]
    newDays[index] = !newDays[index]
    setWeekDays(newDays)
    
    // Generate custom pattern
    const selectedDays = newDays.map((selected, i) => selected ? i : -1).filter(i => i !== -1)
    if (selectedDays.length > 0) {
      onChange({
        unit: 'weeks',
        value: value.value,
        customPattern: `days:${selectedDays.join(',')}`
      })
    }
  }

  const handleMonthDayToggle = (day: number) => {
    // Don't allow unselecting the start date day
    if (startDate && value.unit === 'months') {
      const startDay = new Date(startDate).getDate()
      if (day === startDay && monthDays[day - 1]) {
        return // Don't allow unselecting the start date day
      }
    }
    
    const newDays = [...monthDays]
    newDays[day - 1] = !newDays[day - 1]
    setMonthDays(newDays)
    
    // Generate custom pattern
    const selectedDays = newDays.map((selected, i) => selected ? i + 1 : -1).filter(i => i !== -1)
    
    console.log('DEBUG - Month day toggle:', day)
    console.log('DEBUG - Selected days:', selectedDays)
    console.log('DEBUG - Start Date day:', startDate ? new Date(startDate).getDate() : 'N/A')
    
    if (selectedDays.length > 0) {
      // If only one day is selected, check if it's the default day
      if (selectedDays.length === 1 && startDate && selectedDays[0] === new Date(startDate).getDate()) {
        // Only the default day selected - use standard controls on main page
        console.log('DEBUG - Only default day selected - using standard controls')
        onChange({
          unit: 'months',
          value: value.value,
          customPattern: undefined
        })
      } else {
        // Multiple days or non-default day - use custom pattern
        onChange({
          unit: 'months',
          value: value.value,
          customPattern: `days:${selectedDays.join(',')}`
        })
        console.log('DEBUG - Creating month custom pattern:', `days:${selectedDays.join(',')}`)
      }
    }
  }

  const handleMonthWeekPatternChange = () => {
    onChange({
      unit: 'months',
      value: value.value,
      customPattern: `week:${monthWeekPattern.week},day:${monthWeekPattern.dayOfWeek}`
    })
  }

  const handleYearMonthPatternChange = () => {
    if (yearMonthPattern.months.length > 0) {
      onChange({
        unit: 'years',
        value: value.value,
        customPattern: `months:${yearMonthPattern.months.join(',')},day:${yearMonthPattern.day}`
      })
    }
  }

  const handleYearMonthToggle = (monthIndex: number) => {
    // Don't allow unselecting the start date month
    if (startDate && value.unit === 'years') {
      const startMonth = new Date(startDate).getMonth()
      if (monthIndex === startMonth && yearMonthPattern.months.includes(monthIndex)) {
        return // Don't allow unselecting the start date month
      }
    }
    
    const newMonths = yearMonthPattern.months.includes(monthIndex)
      ? yearMonthPattern.months.filter(m => m !== monthIndex)
      : [...yearMonthPattern.months, monthIndex].sort((a, b) => a - b)
    
    setYearMonthPattern(prev => ({ ...prev, months: newMonths }))
    
    // Debug: Log the toggle operation
    console.log('DEBUG - Toggle month:', monthIndex)
    console.log('DEBUG - New months array:', newMonths)
    console.log('DEBUG - Start Date day:', startDate ? new Date(startDate).getDate() : 'N/A')
    console.log('DEBUG - Current yearMonthPattern.day:', yearMonthPattern.day)
    
    if (newMonths.length > 0) {
      // ALWAYS use start date day directly, never trust the state
      const startDay = startDate ? new Date(startDate).getDate() : 1
      
      // If only one month is selected, check if it's the default month
      if (newMonths.length === 1 && startDate && newMonths[0] === new Date(startDate).getMonth()) {
        // Only the default month selected - use standard controls on main page
        console.log('DEBUG - Only default month selected - using standard controls')
        onChange({
          unit: 'years',
          value: value.value,
          customPattern: undefined
        })
      } else {
        // Multiple months or non-default month - use custom pattern
        const customPattern = `months:${newMonths.join(',')},day:${startDay}`
        console.log('DEBUG - Creating custom pattern:', customPattern)
        console.log('DEBUG - Start day used:', startDay)
        onChange({
          unit: 'years',
          value: value.value,
          customPattern: customPattern
        })
      }
    }
  }

  const handleYearWeekPatternChange = () => {
    if (yearWeekPattern.months.length > 0) {
      onChange({
        unit: 'years',
        value: value.value,
        customPattern: `months:${yearWeekPattern.months.join(',')},week:${yearWeekPattern.week},day:${yearWeekPattern.dayOfWeek}`
      })
    }
  }

  const renderCustomizeModal = () => (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium text-gray-900">Customize Frequency</h3>
          <button
            type="button"
            className="text-gray-400 hover:text-gray-600"
            onClick={() => setShowCustomize(false)}
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
              value={value.value}
              onChange={(e) => onChange({ ...value, value: parseInt(e.target.value) || 1, customPattern: undefined })}
            />
            <select
              className="form-input"
              value={value.unit}
              onChange={(e) => {
                const newUnit = e.target.value as any
                onChange({ ...value, unit: newUnit, customPattern: undefined })
                // Reset pattern types
                setMonthPatternType('specific')
                setYearPatternType('month')
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

          {value.unit === 'weeks' && (
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

          {value.unit === 'months' && (
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
                      onChange({ ...value, customPattern: undefined })
                    }}
                  />
                  Repeat on the {startDate ? getOrdinal(new Date(startDate).getDate()) : '1st'}
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
                      // Use start date to determine week pattern
                      if (startDate) {
                        const date = new Date(startDate)
                        const dayOfMonth = date.getDate()
                        const week = Math.ceil(dayOfMonth / 7)
                        const dayOfWeek = date.getDay()
                        setMonthWeekPattern({ week, dayOfWeek })
                        onChange({
                          ...value,
                          customPattern: `week:${week},day:${dayOfWeek}`
                        })
                      }
                    }}
                  />
                  Repeat on the {startDate ? getOrdinal(Math.ceil(new Date(startDate).getDate() / 7)) : '1st'} {startDate ? weekDayNames[new Date(startDate).getDay()] : 'Sunday'}
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

          {value.unit === 'years' && (
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
                      // Use start date to determine pattern
                      if (startDate) {
                        const date = new Date(startDate)
                        const dayOfMonth = date.getDate()
                        const month = date.getMonth()
                        setYearMonthPattern({ months: [month], day: dayOfMonth })
                        onChange({
                          ...value,
                          customPattern: `months:${month},day:${dayOfMonth}`
                        })
                      }
                    }}
                  />
                  Repeat on {startDate ? getOrdinal(new Date(startDate).getDate()) : '1st'} of {startDate ? monthNames[new Date(startDate).getMonth()] : 'January'}
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
                      // Use start date to determine week pattern
                      if (startDate) {
                        const date = new Date(startDate)
                        const dayOfMonth = date.getDate()
                        const month = date.getMonth()
                        const week = Math.ceil(dayOfMonth / 7)
                        const dayOfWeek = date.getDay()
                        setYearWeekPattern({ months: [month], week, dayOfWeek })
                        onChange({
                          ...value,
                          customPattern: `months:${month},week:${week},day:${dayOfWeek}`
                        })
                      }
                    }}
                  />
                  Repeat on the {startDate ? getOrdinal(Math.ceil(new Date(startDate).getDate() / 7)) : '1st'} {startDate ? weekDayNames[new Date(startDate).getDay()] : 'Sunday'} of {startDate ? monthNames[new Date(startDate).getMonth()] : 'January'}
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
                  Select months to repeat on the {startDate ? getOrdinal(new Date(startDate).getDate()) : '1st'}
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
            onClick={() => setShowCustomize(false)}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )

  const showSimpleControls = !value.customPattern

  return (
    <>
      <div className="space-y-4">
        {showSimpleControls ? (
          <div className="flex items-center space-x-2">
            <span>Every</span>
            <input
              type="number"
              min="1"
              className="form-input w-20"
              value={value.value}
              onChange={(e) => onChange({ ...value, value: parseInt(e.target.value) || 1, customPattern: undefined })}
            />
            <select
              className="form-input"
              value={value.unit}
              onChange={(e) => onChange({ ...value, unit: e.target.value as any, customPattern: undefined })}
            >
              <option value="days">day(s)</option>
              <option value="weeks">week(s)</option>
              <option value="months">month(s)</option>
              <option value="years">year(s)</option>
            </select>
            <button
              type="button"
              className="btn-secondary text-sm"
              onClick={() => setShowCustomize(true)}
            >
              Customize
            </button>
          </div>
        ) : (
          <div className="flex items-center space-x-3">
            <button
              type="button"
              className="btn-secondary text-sm"
              onClick={() => setShowCustomize(true)}
            >
              Change
            </button>
            <span className="text-gray-900">{getFrequencyDescription()}</span>
          </div>
        )}
      </div>

      {showCustomize && renderCustomizeModal()}
    </>
  )
}

export default FrequencySelector
