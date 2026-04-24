import React from 'react'

interface BarChartProps {
  data: {
    label: string
    value: number
    color?: string
  }[]
  title?: string
  height?: number
}

const BarChart: React.FC<BarChartProps> = ({ 
  data, 
  title, 
  height = 200 
}) => {
  if (data.length === 0) return null

  const maxValue = Math.max(...data.map(d => d.value))

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
        </svg>
        
        {/* Bars */}
        <div className="relative h-full flex items-end justify-around px-2">
          {data.map((item, index) => {
            const barHeight = (item.value / maxValue) * 80 // 80% of height
            const barColor = item.color || '#3B82F6'
            
            return (
              <div key={index} className="flex flex-col items-center flex-1 mx-1">
                <div className="relative w-full flex flex-col items-center">
                  {/* Value label on top of bar */}
                  <span className="text-xs font-medium text-gray-900 mb-1">
                    ${item.value.toFixed(0)}
                  </span>
                  {/* Bar */}
                  <div 
                    className="w-full transition-all duration-300 hover:opacity-80"
                    style={{ 
                      height: `${barHeight}%`,
                      backgroundColor: barColor,
                      minHeight: '2px'
                    }}
                  ></div>
                </div>
                {/* Label below bar */}
                <span className="text-xs text-gray-600 mt-2 text-center">
                  {item.label}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default BarChart
