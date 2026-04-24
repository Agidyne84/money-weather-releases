import React from 'react'

interface LineChartProps {
  data: {
    label: string
    value: number
  }[]
  title?: string
  color?: string
  height?: number
}

const LineChart: React.FC<LineChartProps> = ({ 
  data, 
  title, 
  color = '#3B82F6', 
  height = 200 
}) => {
  if (data.length === 0) return null

  const maxValue = Math.max(...data.map(d => d.value))
  const minValue = Math.min(...data.map(d => d.value))
  const range = maxValue - minValue || 1

  // Generate points for the line
  const points = data.map((item, index) => {
    const x = (index / (data.length - 1)) * 100
    const y = 100 - ((item.value - minValue) / range) * 80 - 10 // 80% height, 10% padding
    return `${x},${y}`
  }).join(' ')

  return (
    <div className="w-full">
      {title && <h3 className="text-lg font-medium text-gray-900 mb-4">{title}</h3>}
      <div className="relative" style={{ height: `${height}px` }}>
        {/* Grid lines */}
        <svg className="absolute inset-0 w-full h-full">
          {/* Horizontal grid lines */}
          {[0, 25, 50, 75, 100].map((percent) => (
            <line
              key={percent}
              x1="0"
              y1={`${percent}%`}
              x2="100%"
              y2={`${percent}%`}
              stroke="#E5E7EB"
              strokeWidth="1"
            />
          ))}
          {/* Vertical grid lines */}
          {data.map((_, index) => {
            const x = (index / (data.length - 1)) * 100
            return (
              <line
                key={index}
                x1={`${x}%`}
                y1="0"
                x2={`${x}%`}
                y2="100%"
                stroke="#E5E7EB"
                strokeWidth="1"
              />
            )
          })}
          
          {/* Data line */}
          <polyline
            points={points}
            fill="none"
            stroke={color}
            strokeWidth="2"
            className="transition-all duration-300"
          />
          
          {/* Data points */}
          {data.map((item, index) => {
            const x = (index / (data.length - 1)) * 100
            const y = 100 - ((item.value - minValue) / range) * 80 - 10
            return (
              <circle
                key={index}
                cx={`${x}%`}
                cy={`${y}%`}
                r="3"
                fill={color}
                className="transition-all duration-300"
              />
            )
          })}
        </svg>
        
        {/* Labels */}
        <div className="absolute bottom-0 left-0 right-0 flex justify-between text-xs text-gray-500">
          {data.map((item, index) => (
            <span key={index} className="transform -translate-x-1/2" style={{ left: `${(index / (data.length - 1)) * 100}%` }}>
              {item.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

export default LineChart
