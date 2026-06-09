import React, { useState } from 'react'

interface PieChartProps {
  data: {
    label: string
    value: number
    color: string
  }[]
  title?: string
  size?: 'small' | 'medium' | 'large'
  showLegend?: boolean
  onSliceClick?: (label: string) => void
}

const PieChart: React.FC<PieChartProps> = ({ data, title, size = 'medium', showLegend = true, onSliceClick }) => {
  const total = data.reduce((sum, item) => sum + item.value, 0)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  const sizeClasses = {
    small: 'w-32 h-32',
    medium: 'w-48 h-48',
    large: 'w-64 h-64'
  }

  const radius = 40
  const circumference = 2 * Math.PI * radius

  // Group slices below 3% into "Other" for the chart display
  const THRESHOLD = 0.03
  const mainSlices = data.filter(item => item.value / total >= THRESHOLD)
  const otherSlices = data.filter(item => item.value / total < THRESHOLD)
  const otherTotal = otherSlices.reduce((sum, item) => sum + item.value, 0)
  const chartData = otherSlices.length > 0
    ? [...mainSlices, { label: 'Other', value: otherTotal, color: '#9CA3AF' }]
    : mainSlices

  // Compute slice lengths with minimum-size enforcement and proportional rescaling
  const GAP = 2
  const availableCircumference = circumference - chartData.length * GAP
  const MIN_SLICE = 3

  const rawLengths = chartData.map(item => (item.value / total) * availableCircumference)
  const smallCount = rawLengths.filter(l => l < MIN_SLICE).length
  const clampedSum = smallCount * MIN_SLICE
  const bigRawSum = rawLengths.filter(l => l >= MIN_SLICE).reduce((s, l) => s + l, 0)
  const bigScale = bigRawSum > 0 ? (availableCircumference - clampedSum) / bigRawSum : 0

  const renderedLengths = rawLengths.map(l => l < MIN_SLICE ? MIN_SLICE : l * bigScale)
  const cumulativeLengths = renderedLengths.reduce<number[]>((acc, len) => {
    acc.push((acc[acc.length - 1] || 0) + len)
    return acc
  }, [])

  const hoveredItem = hoveredIndex !== null ? chartData[hoveredIndex] : null

  return (
    <div className="flex flex-col items-center">
      {title && <h3 className="text-lg font-medium text-gray-900 mb-4">{title}</h3>}
      <div className={`${sizeClasses[size]} relative`}>
        {/* Custom instant tooltip */}
        {hoveredItem && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none">
            <div className="bg-gray-900 text-white text-xs rounded-md px-2 py-1 shadow-lg whitespace-nowrap">
              {hoveredItem.label}: {((hoveredItem.value / total) * 100).toFixed(1)}%
            </div>
          </div>
        )}

        {/* Simple SVG Pie Chart */}
        <svg viewBox="0 0 100 100" className="transform -rotate-90 overflow-visible">
          {chartData.map((item, index) => {
            const sliceLength = renderedLengths[index]
            const previousSlices = index > 0 ? cumulativeLengths[index - 1] : 0
            const offset = -(previousSlices + index * GAP)
            const isHovered = hoveredIndex === index

            const isClickable = !!onSliceClick && item.label !== 'Other'
            return (
              <circle
                key={item.label}
                cx="50"
                cy="50"
                r={radius}
                fill="none"
                stroke={item.color}
                strokeWidth={isHovered ? 24 : 20}
                strokeDasharray={`${sliceLength} ${circumference}`}
                strokeDashoffset={offset}
                className={`transition-all duration-300 ${isClickable ? 'cursor-pointer' : 'cursor-default'}`}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
                onClick={() => isClickable && onSliceClick!(item.label)}
              />
            )
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-xl font-bold text-gray-900">${total.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
          <span className="text-xs text-gray-500">Total</span>
        </div>
      </div>

      {/* Legend */}
      {showLegend && (
        <div className="mt-4 space-y-2 w-full">
          {data.map((item) => (
            <div
              key={item.label}
              className={`flex items-center space-x-2 ${onSliceClick ? 'cursor-pointer hover:opacity-75' : ''}`}
              onClick={() => onSliceClick?.(item.label)}
            >
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }}></div>
              <span className="text-sm text-gray-600 flex-1">{item.label}</span>
              <span className="text-sm font-medium text-gray-900">
                {((item.value / total) * 100).toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default PieChart
