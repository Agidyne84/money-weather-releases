import React from 'react'
import BarChart from './BarChart'

interface BudgetVsActualWidgetProps {
  title?: string
  data: {
    category: string
    budget: number
    actual: number
    color: string
  }[]
  showVariance?: boolean
  className?: string
}

const BudgetVsActualWidget: React.FC<BudgetVsActualWidgetProps> = ({ 
  title = "Budget vs Actual",
  data,
  showVariance = true,
  className = ''
}) => {
  // Prepare data for grouped bar chart
  const chartData = data.flatMap(item => [
    {
      label: item.category,
      value: item.budget,
      color: '#3B82F6' // Blue for budget
    },
    {
      label: item.category,
      value: item.actual,
      color: item.actual > item.budget ? '#EF4444' : '#10B981' // Red for over, Green for under
    }
  ])

  // Calculate variance
  const totalBudget = data.reduce((sum, item) => sum + item.budget, 0)
  const totalActual = data.reduce((sum, item) => sum + item.actual, 0)
  const totalVariance = totalActual - totalBudget
  const variancePercentage = totalBudget > 0 ? (totalVariance / totalBudget) * 100 : 0

  return (
    <div className={`card ${className}`}>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-medium text-gray-900">{title}</h3>
        {showVariance && (
          <div className={`text-right ${totalVariance > 0 ? 'text-red-600' : 'text-green-600'}`}>
            <p className="text-sm font-medium">
              {totalVariance > 0 ? 'Over' : 'Under'} Budget
            </p>
            <p className="text-lg font-bold">
              ${Math.abs(totalVariance).toFixed(0)}
              <span className="text-sm font-normal ml-1">
                ({Math.abs(variancePercentage).toFixed(1)}%)
              </span>
            </p>
          </div>
        )}
      </div>

      {data.length > 0 ? (
        <>
          {/* Grouped Bar Chart */}
          <div className="mb-6">
            <BarChart data={chartData} height={250} />
          </div>

          {/* Legend */}
          <div className="flex justify-center space-x-6 mb-4">
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 bg-blue-500 rounded"></div>
              <span className="text-sm text-gray-600">Budget</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 bg-green-500 rounded"></div>
              <span className="text-sm text-gray-600">Under Budget</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 bg-red-500 rounded"></div>
              <span className="text-sm text-gray-600">Over Budget</span>
            </div>
          </div>

          {/* Category Breakdown */}
          <div className="space-y-2">
            {data.map((item, index) => {
              const variance = item.actual - item.budget
              const variancePercentage = item.budget > 0 ? (variance / item.budget) * 100 : 0
              const isOverBudget = variance > 0

              return (
                <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center space-x-3">
                    <div 
                      className="w-3 h-3 rounded-full" 
                      style={{ backgroundColor: item.color }}
                    ></div>
                    <div>
                      <p className="font-medium text-gray-900">{item.category}</p>
                      <p className="text-sm text-gray-500">
                        Budget: ${item.budget.toFixed(0)} | 
                        Actual: ${item.actual.toFixed(0)}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`font-medium ${isOverBudget ? 'text-red-600' : 'text-green-600'}`}>
                      {isOverBudget ? '+' : ''}${variance.toFixed(0)}
                    </p>
                    <p className="text-xs text-gray-500">
                      {Math.abs(variancePercentage).toFixed(1)}% {isOverBudget ? 'over' : 'under'}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      ) : (
        <div className="text-center py-8 text-gray-500">
          <p>No budget data available</p>
          <p className="text-sm mt-1">Set up budgets to see performance analysis</p>
        </div>
      )}
    </div>
  )
}

export default BudgetVsActualWidget
