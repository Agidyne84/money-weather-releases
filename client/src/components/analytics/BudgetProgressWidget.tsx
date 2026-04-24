import React from 'react'

interface BudgetProgressWidgetProps {
  title?: string
  data: {
    category: string
    budget: number
    actual: number
    color: string
  }[]
  className?: string
}

const BudgetProgressWidget: React.FC<BudgetProgressWidgetProps> = ({ 
  title = "Budget Progress",
  data,
  className = ''
}) => {
  const getProgressPercentage = (budget: number, actual: number) => {
    if (budget === 0) return 0
    return Math.min((actual / budget) * 100, 999) // Cap at 999% for display
  }

  const getProgressColor = (percentage: number) => {
    if (percentage >= 100) return 'bg-red-500'
    if (percentage >= 80) return 'bg-yellow-500'
    return 'bg-green-500'
  }

  const getProgressTextColor = (percentage: number) => {
    if (percentage >= 100) return 'text-red-600'
    if (percentage >= 80) return 'text-yellow-600'
    return 'text-green-600'
  }

  return (
    <div className={`card ${className}`}>
      <h3 className="text-lg font-medium text-gray-900 mb-4">{title}</h3>
      
      {data.length > 0 ? (
        <div className="space-y-4">
          {data.map((item, index) => {
            const percentage = getProgressPercentage(item.budget, item.actual)
            const remaining = item.budget - item.actual
            const isOverBudget = item.actual > item.budget

            return (
              <div key={index} className="space-y-2">
                {/* Category Header */}
                <div className="flex justify-between items-center">
                  <div className="flex items-center space-x-2">
                    <div 
                      className="w-3 h-3 rounded-full" 
                      style={{ backgroundColor: item.color }}
                    ></div>
                    <span className="font-medium text-gray-900">{item.category}</span>
                  </div>
                  <div className="text-right">
                    <p className={`font-medium ${getProgressTextColor(percentage)}`}>
                      ${item.actual.toFixed(0)} / ${item.budget.toFixed(0)}
                    </p>
                    <p className="text-xs text-gray-500">
                      {percentage >= 999 ? '999+' : percentage.toFixed(0)}% used
                    </p>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="relative">
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all duration-300 ${getProgressColor(percentage)}`}
                      style={{ width: `${Math.min(percentage, 100)}%` }}
                    ></div>
                  </div>
                  {/* Over-budget indicator */}
                  {percentage > 100 && (
                    <div 
                      className="absolute top-0 right-0 h-2 bg-red-500 rounded-full"
                      style={{ width: `${Math.min(percentage - 100, 100)}%` }}
                    ></div>
                  )}
                </div>

                {/* Status */}
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-500">
                    {isOverBudget ? 'Over budget' : 'Under budget'}
                  </span>
                  <span className={`font-medium ${isOverBudget ? 'text-red-600' : 'text-green-600'}`}>
                    {isOverBudget ? 
                      `+$${Math.abs(remaining).toFixed(0)} over` : 
                      `$${remaining.toFixed(0)} remaining`
                    }
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="text-center py-8 text-gray-500">
          <p>No budget data available</p>
          <p className="text-sm mt-1">Set up budgets to see progress tracking</p>
        </div>
      )}
    </div>
  )
}

export default BudgetProgressWidget
