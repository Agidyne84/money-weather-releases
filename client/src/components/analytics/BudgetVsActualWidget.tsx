import React, { useState, useRef, useLayoutEffect } from 'react'

interface BudgetVsActualItem {
  category: string
  budget: number
  actual: number
  color: string
  isCredit?: boolean
}

interface BudgetVsActualWidgetProps {
  title?: string
  data: BudgetVsActualItem[]
  showVariance?: boolean
  className?: string
  onCategoryClick?: (name: string) => void
  onLeafClick?: (name: string) => void
  isChildView?: boolean
  parentCategoryName?: string
  onBack?: () => void
  tableExpanded?: boolean
  onToggleExpand?: () => void
}

const fmt = (n: number) =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

const BAR_GROUP_W = 80   // px per category group
const CHART_H = 180      // bar area height in px
const TABLE_DEFAULT = 3

const BudgetVsActualWidget: React.FC<BudgetVsActualWidgetProps> = ({
  title = "Budget vs Actual",
  data,
  showVariance = true,
  className = '',
  onCategoryClick,
  onLeafClick,
  isChildView = false,
  parentCategoryName,
  onBack,
  tableExpanded = false,
  onToggleExpand,
}) => {
  const [hoveredCat, setHoveredCat] = useState<string | null>(null)
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const [containerW, setContainerW] = useState(0)

  useLayoutEffect(() => {
    const el = chartContainerRef.current
    if (!el) return
    setContainerW(el.clientWidth)
    const ro = new ResizeObserver(() => setContainerW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const effectiveGroupW = containerW > 0
    ? Math.max(BAR_GROUP_W, containerW / Math.max(data.length, 1))
    : BAR_GROUP_W
  const chartW = Math.max(data.length * effectiveGroupW, 360)

  const totalBudget = data.reduce((s, i) => s + i.budget, 0)
  const totalActual = data.reduce((s, i) => s + i.actual, 0)
  const totalVariance = totalActual - totalBudget
  const variancePct = totalBudget > 0 ? (totalVariance / totalBudget) * 100 : 0

  const maxVal = Math.max(...data.flatMap(i => [i.budget, i.actual]), 1)

  const displayTable = tableExpanded ? data : data.slice(0, TABLE_DEFAULT)
  const canDrillDown = !!onCategoryClick && !isChildView
  const canLeaf = !!onLeafClick && isChildView

  const handleBarClick = (name: string) => {
    if (canLeaf) onLeafClick!(name)
    else if (canDrillDown) onCategoryClick!(name)
  }

  return (
    <div className={`card ${className}`}>
      {/* Header */}
      <div className="flex flex-wrap justify-between items-start gap-3 mb-4">
        <div className="flex items-center gap-2">
          {isChildView && onBack && (
            <button
              onClick={onBack}
              className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1 font-medium"
            >
              ← All Categories
            </button>
          )}
          {isChildView && <span className="text-gray-400">/</span>}
          <div>
            <h3 className="text-lg font-medium text-gray-900">
              {isChildView ? parentCategoryName : title}
            </h3>
            {isChildView && (
              <p className="text-xs text-gray-500">Subcategory breakdown</p>
            )}
          </div>
        </div>
        {showVariance && totalBudget > 0 && (
          <div className={`text-right ${totalVariance > 0 ? 'text-red-600' : 'text-green-600'}`}>
            <p className="text-sm font-medium">{totalVariance > 0 ? 'Over' : 'Under'} Budget</p>
            <p className="text-xl font-bold">
              {fmt(Math.abs(totalVariance))}
              <span className="text-sm font-normal ml-1">({Math.abs(variancePct).toFixed(1)}%)</span>
            </p>
          </div>
        )}
      </div>

      {data.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <p>No budget data available</p>
          <p className="text-sm mt-1">Set up budgets to see performance analysis</p>
        </div>
      ) : (
        <>
          {/* Grouped bar chart — stretches to fill, scrolls if many categories */}
          <div ref={chartContainerRef} className="overflow-x-auto pb-2 mb-3">
            <div style={{ minWidth: `${chartW}px`, height: `${CHART_H + 50}px` }}>
              <svg width={chartW} height={CHART_H + 50}>
                {/* Y-axis grid lines */}
                {[0, 0.25, 0.5, 0.75, 1].map(frac => {
                  const y = (1 - frac) * CHART_H
                  return (
                    <g key={frac}>
                      <line x1={0} y1={y} x2="100%" y2={y} stroke="#E5E7EB" strokeWidth={1} />
                      <text x={2} y={y - 2} fontSize={9} fill="#9CA3AF">
                        {fmt(frac * maxVal)}
                      </text>
                    </g>
                  )
                })}
                {/* Bars */}
                {data.map((item, i) => {
                  const x = i * effectiveGroupW + effectiveGroupW * 0.1
                  const barW = Math.max(effectiveGroupW * 0.28, 14)
                  const barGap = Math.max(effectiveGroupW * 0.04, 3)
                  const budgetH = (item.budget / maxVal) * CHART_H
                  const actualH = (item.actual / maxVal) * CHART_H
                  const isOver = item.actual > item.budget
                  // For credit payments, over-budget is good (paying more = green)
                  const isGood = item.isCredit ? isOver : !isOver
                  const isHovered = hoveredCat === item.category
                  return (
                    <g
                      key={item.category}
                      style={{ cursor: (canDrillDown || canLeaf) ? 'pointer' : 'default' }}
                      onClick={() => handleBarClick(item.category)}
                      onMouseEnter={() => setHoveredCat(item.category)}
                      onMouseLeave={() => setHoveredCat(null)}
                    >
                      {/* Budget bar */}
                      <rect
                        x={x}
                        y={CHART_H - budgetH}
                        width={barW}
                        height={Math.max(budgetH, item.budget > 0 ? 2 : 0)}
                        fill={isHovered ? '#2563EB' : '#60A5FA'}
                        rx={2}
                      />
                      {/* Actual bar */}
                      <rect
                        x={x + barW + barGap}
                        y={CHART_H - actualH}
                        width={barW}
                        height={Math.max(actualH, item.actual > 0 ? 2 : 0)}
                        fill={isHovered ? (isGood ? '#16A34A' : '#DC2626') : (isGood ? '#4ADE80' : '#F87171')}
                        rx={2}
                      />
                      {/* Category label */}
                      <text
                        x={x + barW + barGap / 2}
                        y={CHART_H + 14}
                        fontSize={Math.min(10, effectiveGroupW / 7)}
                        fill={isHovered ? '#1D4ED8' : '#4B5563'}
                        textAnchor="middle"
                        fontWeight={isHovered ? 'bold' : 'normal'}
                      >
                        {item.category.length > 10 ? item.category.slice(0, 9) + '…' : item.category}
                      </text>
                    </g>
                  )
                })}
              </svg>
            </div>
          </div>

          {/* Legend */}
          <div className="flex justify-center gap-6 mb-4 text-sm flex-wrap">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded bg-blue-400" />
              <span className="text-gray-600">Budgeted</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded bg-green-400" />
              <span className="text-gray-600">Under Budget</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded bg-red-400" />
              <span className="text-gray-600">Over Budget</span>
            </div>
            {canDrillDown && (
              <span className="text-gray-400 text-xs self-center">Click a category to drill down</span>
            )}
          </div>

          {/* Category table — desktop */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 font-medium text-gray-600">Category</th>
                  <th className="text-right py-2 font-medium text-gray-600 whitespace-nowrap">Budgeted</th>
                  <th className="text-right py-2 font-medium text-gray-600 whitespace-nowrap">Actual</th>
                  <th className="text-right py-2 font-medium text-gray-600 whitespace-nowrap">Variance</th>
                  <th className="text-right py-2 font-medium text-gray-600 whitespace-nowrap">% / Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {displayTable.map(item => {
                  const variance = item.actual - item.budget
                  const pct = item.budget > 0 ? (variance / item.budget) * 100 : 0
                  const isOver = variance > 0
                  // Credit payment: over-budget = good; regular: over-budget = bad
                  const isGood = item.isCredit ? isOver : !isOver
                  const varColor = isGood ? 'text-green-600' : 'text-red-600'
                  const varLabel = item.isCredit
                    ? (isOver ? 'Above target' : 'Below target')
                    : (isOver ? 'Over' : 'Under')
                  return (
                    <tr
                      key={item.category}
                      className={`${canDrillDown || canLeaf ? 'cursor-pointer hover:bg-blue-50' : 'hover:bg-gray-50'} transition-colors`}
                      onClick={() => handleBarClick(item.category)}
                    >
                      <td className="py-2">
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
                          <span className="font-medium text-gray-900">{item.category}</span>
                          {item.isCredit && <span className="text-xs text-blue-500 bg-blue-50 px-1 rounded">credit</span>}
                        </div>
                      </td>
                      <td className="py-2 text-right font-mono text-blue-600 whitespace-nowrap">{fmt(item.budget)}</td>
                      <td className="py-2 text-right font-mono text-gray-900 whitespace-nowrap">{fmt(item.actual)}</td>
                      <td className={`py-2 text-right font-mono whitespace-nowrap ${varColor}`}>
                        {isOver ? '+' : ''}{fmt(variance)}
                      </td>
                      <td className={`py-2 text-right whitespace-nowrap ${varColor}`}>
                        <div className="font-mono">{isOver ? '+' : ''}{Math.abs(pct).toFixed(1)}%</div>
                        <div className="text-xs">{varLabel}</div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards for Budget vs Actual */}
          <div className="md:hidden space-y-2">
            {displayTable.map(item => {
              const variance = item.actual - item.budget
              const pct = item.budget > 0 ? (variance / item.budget) * 100 : 0
              const isOver = variance > 0
              const isGood = item.isCredit ? isOver : !isOver
              const varColor = isGood ? 'text-green-600' : 'text-red-600'
              const varLabel = item.isCredit
                ? (isOver ? 'Above target' : 'Below target')
                : (isOver ? 'Over' : 'Under')
              return (
                <div
                  key={item.category}
                  className={`bg-white border border-gray-200 rounded-lg p-3 shadow-sm ${canDrillDown || canLeaf ? 'cursor-pointer active:bg-blue-50' : ''}`}
                  onClick={() => handleBarClick(item.category)}
                >
                  <div className="flex justify-between items-center mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
                      <span className="font-medium text-gray-900 truncate">{item.category}</span>
                      {item.isCredit && <span className="text-xs text-blue-500 bg-blue-50 px-1 rounded flex-shrink-0">credit</span>}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Budgeted</span>
                      <span className="font-mono text-blue-600">{fmt(item.budget)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Actual</span>
                      <span className="font-mono text-gray-900">{fmt(item.actual)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Variance</span>
                      <span className={`font-mono ${varColor}`}>{isOver ? '+' : ''}{fmt(variance)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Status</span>
                      <span className={`font-mono ${varColor}`}>{Math.abs(pct).toFixed(1)}% {varLabel}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {data.length > TABLE_DEFAULT && onToggleExpand && (
            <button
              onClick={onToggleExpand}
              className="mt-3 w-full py-2 text-sm text-blue-600 hover:text-blue-800 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
            >
              {tableExpanded ? 'Show fewer categories' : `Show all ${data.length} categories`}
            </button>
          )}
        </>
      )}
    </div>
  )
}

export default BudgetVsActualWidget
