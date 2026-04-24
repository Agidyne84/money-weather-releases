import React from 'react'

interface BudgetSummaryWidgetProps {
  title?: string
  totalBudget: number
  totalSpent: number
  totalRemaining: number
  monthName: string
  daysInMonth: number
  daysPassed: number
  className?: string
}

const BudgetSummaryWidget: React.FC<BudgetSummaryWidgetProps> = ({ 
  title = "Budget Summary",
  totalBudget,
  totalSpent,
  totalRemaining,
  monthName,
  daysInMonth,
  daysPassed,
  className = ''
}) => {
  const spentPercentage = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0
  const timePercentage = (daysPassed / daysInMonth) * 100
  const isOverBudget = totalSpent > totalBudget
  const isOnTrack = spentPercentage <= timePercentage

  const dailyBudget = totalBudget / daysInMonth
  const expectedSpendByNow = dailyBudget * daysPassed
  const variance = totalSpent - expectedSpendByNow

  return (
    <div className={`card ${className}`}>
      <h3 className="text-lg font-medium text-gray-900 mb-4">{title}</h3>
      
      <div className="space-y-4">
        {/* Month Overview */}
        <div className="text-center">
          <p className="text-2xl font-bold text-gray-900">{monthName}</p>
          <p className="text-sm text-gray-500">
            {daysPassed} of {daysInMonth} days ({Math.round(timePercentage)}% complete)
          </p>
        </div>

        {/* Main Budget Circle */}
        <div className="flex justify-center">
          <div className="relative w-32 h-32">
            <svg className="transform -rotate-90 w-32 h-32">
              <circle
                cx="64"
                cy="64"
                r="56"
                fill="none"
                stroke="#E5E7EB"
                strokeWidth="12"
              />
              <circle
                cx="64"
                cy="64"
                r="56"
                fill="none"
                stroke={isOverBudget ? '#EF4444' : isOnTrack ? '#10B981' : '#F59E0B'}
                strokeWidth="12"
                strokeDasharray={`${Math.min(spentPercentage, 100)} 100`}
                className="transition-all duration-300"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`text-2xl font-bold ${isOverBudget ? 'text-red-600' : isOnTrack ? 'text-green-600' : 'text-yellow-600'}`}>
                {spentPercentage >= 999 ? '999+' : spentPercentage.toFixed(0)}%
              </span>
              <span className="text-xs text-gray-500">spent</span>
            </div>
          </div>
        </div>

        {/* Budget Numbers */}
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-sm text-gray-500">Budget</p>
            <p className="font-bold text-blue-600">${totalBudget.toFixed(0)}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Spent</p>
            <p className={`font-bold ${isOverBudget ? 'text-red-600' : 'text-gray-900'}`}>
              ${totalSpent.toFixed(0)}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Remaining</p>
            <p className={`font-bold ${totalRemaining < 0 ? 'text-red-600' : 'text-green-600'}`}>
              ${totalRemaining.toFixed(0)}
            </p>
          </div>
        </div>

        {/* Status Messages */}
        <div className="space-y-2">
          {/* Track Status */}
          <div className={`p-3 rounded-lg text-center ${
            isOnTrack ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-700'
          }`}>
            <p className="font-medium">
              {isOnTrack ? '✓ On Track' : '⚠ Over Budget Pace'}
            </p>
            <p className="text-sm">
              {isOnTrack 
                ? `Spending ${Math.abs(spentPercentage - timePercentage).toFixed(0)}% slower than time`
                : `Spending ${Math.abs(spentPercentage - timePercentage).toFixed(0)}% faster than time`
              }
            </p>
          </div>

          {/* Daily Average */}
          <div className="p-3 bg-gray-50 rounded-lg text-center">
            <p className="text-sm text-gray-600">Daily Average</p>
            <p className="font-medium text-gray-900">
              ${(totalSpent / daysPassed).toFixed(0)} / ${dailyBudget.toFixed(0)}
            </p>
            <p className="text-xs text-gray-500">
              {variance > 0 ? 
                `$${Math.abs(variance).toFixed(0)} over expected` : 
                `$${Math.abs(variance).toFixed(0)} under expected`
              }
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default BudgetSummaryWidget
