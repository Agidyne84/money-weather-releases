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

  const values = data.map(d => d.value)
  const maxValue = Math.max(...values, 0)
  const minValue = Math.min(...values, 0)
  const range = maxValue - minValue

  // If all values are the same or range is 0, provide a fallback scale
  const effectiveRange = range === 0 ? Math.max(Math.abs(maxValue), 100) : range

  // Zero line position as percentage from bottom
  const zeroLinePercent = minValue < 0
    ? (Math.abs(minValue) / effectiveRange) * 100
    : 0

  return (
    <div className="w-full">
      {title && <h3 className="text-lg font-medium text-gray-900 mb-4">{title}</h3>}
      <div className="relative" style={{ height: `${height}px` }}>
        {/* Grid lines */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
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
          {/* Zero baseline */}
          {minValue < 0 && (
            <line
              x1="0"
              y1={`${100 - zeroLinePercent}%`}
              x2="100%"
              y2={`${100 - zeroLinePercent}%`}
              stroke="#9CA3AF"
              strokeWidth="1.5"
              strokeDasharray="4 2"
            />
          )}
        </svg>

        {/* Bars */}
        <div className="relative h-full flex items-end px-2 pt-6 pb-6 gap-2">
          {data.map((item, index) => {
            const barColor = item.color || '#3B82F6'

            let barHeightPercent: number
            let bottomOffsetPercent: number

            if (item.value >= 0) {
              barHeightPercent = (item.value / effectiveRange) * 100
              bottomOffsetPercent = zeroLinePercent
            } else {
              barHeightPercent = (Math.abs(item.value) / effectiveRange) * 100
              bottomOffsetPercent = zeroLinePercent - barHeightPercent
            }

            return (
              <div key={index} className="flex flex-col items-center flex-1 min-w-0 h-full relative">
                {/* Value label */}
                <span className={`text-xs font-medium mb-1 w-full text-center ${item.value >= 0 ? 'text-gray-900' : 'text-red-600'}`}>
                  ${item.value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </span>
                {/* Bar container - fills height and positions bar */}
                <div className="relative w-full flex-1">
                  <div
                    className="absolute left-0 right-0 transition-all duration-300 hover:opacity-80 rounded-sm"
                    style={{
                      height: `${Math.max(barHeightPercent, 0.5)}%`,
                      bottom: `${Math.max(bottomOffsetPercent, 0)}%`,
                      backgroundColor: barColor,
                    }}
                  />
                </div>
                {/* Label below */}
                <span className="text-xs text-gray-600 mt-2 text-center truncate w-full" title={item.label}>
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
