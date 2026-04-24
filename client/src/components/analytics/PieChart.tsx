import React from 'react'

interface PieChartProps {
  data: {
    label: string
    value: number
    color: string
  }[]
  title?: string
  size?: 'small' | 'medium' | 'large'
}

const PieChart: React.FC<PieChartProps> = ({ data, title, size = 'medium' }) => {
  const total = data.reduce((sum, item) => sum + item.value, 0)
  
  const sizeClasses = {
    small: 'w-32 h-32',
    medium: 'w-48 h-48',
    large: 'w-64 h-64'
  }

  return (
    <div className="flex flex-col items-center">
      {title && <h3 className="text-lg font-medium text-gray-900 mb-4">{title}</h3>}
      <div className={`${sizeClasses[size]} relative`}>
        {/* Simple SVG Pie Chart */}
        <svg viewBox="0 0 100 100" className="transform -rotate-90">
          {data.map((item, index) => {
            const percentage = (item.value / total) * 100
            const strokeDasharray = `${percentage} 100`
            const previousPercentages = data.slice(0, index).reduce((sum, prev) => sum + (prev.value / total) * 100, 0)
            
            return (
              <circle
                key={item.label}
                cx="50"
                cy="50"
                r="40"
                fill="none"
                stroke={item.color}
                strokeWidth="20"
                strokeDasharray={strokeDasharray}
                strokeDashoffset={-previousPercentages}
                className="transition-all duration-300"
              />
            )
          })}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-2xl font-bold text-gray-900">{total}</span>
        </div>
      </div>
      
      {/* Legend */}
      <div className="mt-4 space-y-2">
        {data.map((item) => (
          <div key={item.label} className="flex items-center space-x-2">
            <div 
              className="w-3 h-3 rounded-full" 
              style={{ backgroundColor: item.color }}
            ></div>
            <span className="text-sm text-gray-600">{item.label}</span>
            <span className="text-sm font-medium text-gray-900">
              {((item.value / total) * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default PieChart
