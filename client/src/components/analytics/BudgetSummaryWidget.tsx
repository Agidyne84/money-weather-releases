import React, { useRef } from 'react'

interface AccountGauge {
  budget: number
  actual: number
}

interface BudgetSummaryWidgetProps {
  title?: string
  totalBudget: number
  totalSpent: number
  totalRemaining: number
  monthName: string
  daysInMonth: number
  daysPassed: number
  isCompleted?: boolean
  checkingGauge?: AccountGauge
  savingsGauge?: AccountGauge
  creditGauge?: AccountGauge
  onPrevMonth?: () => void
  onNextMonth?: () => void
  canGoNext?: boolean
  monthContextLabel?: string
  className?: string
}

// ─── Arc Gauge ───────────────────────────────────────────────────────────────
// Dual-zone semicircular gauge (9-o'clock → 12-o'clock → 3-o'clock).
//
// The arc is split at the midpoint (12-o'clock = 100% of budget target):
//   Zone 1 (left → top)   : 0 – 100% of budget
//   Zone 2 (top  → right) : 100% – 200%+ of budget (overage)
//
// A small circle at 12-o'clock marks the budget target so overages are
// immediately visible as a separate coloured fill on the right half.
//
// isGoodWhenOver = true  → savings / credit  (zone2 = green, zone1 = red/yellow)
// isGoodWhenOver = false → checking          (zone1 = green/yellow, zone2 = red)
const ArcGauge: React.FC<{
  label: string
  budget: number
  actual: number
  isGoodWhenOver: boolean
}> = ({ label, budget, actual, isGoodWhenOver }) => {
  const pct = budget > 0 ? (actual / budget) * 100 : 0
  const isOver = pct >= 100

  // ── geometry ──────────────────────────────────────────────────────────────
  const cx = 60, cy = 68, r = 50, sw = 9

  // Returns the SVG coordinate of a point on the arc at arcPct (0–100% of arc).
  //   arcPct 0   → (cx−r, cy)  = left  end (9-o'clock)
  //   arcPct 50  → (cx,   cy−r)= top         (12-o'clock) ← budget target
  //   arcPct 100 → (cx+r, cy)  = right end (3-o'clock)
  const pt = (arcPct: number) => {
    const θ = Math.PI * (1 - arcPct / 100)
    return { x: cx + r * Math.cos(θ), y: cy - r * Math.sin(θ) }
  }

  // SVG arc path from one arc-% to another (always clockwise, always ≤ 180°).
  const seg = (a: number, b: number): string => {
    if (b <= a) return ''
    const s = pt(a), e = pt(b)
    return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 0 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`
  }

  // Map budget % → arc %:  100% budget = 50% arc, 200% budget = 100% arc
  const zone1End = Math.min(pct, 100) / 2                          // 0–50 arc%
  const zone2End = 50 + Math.min(Math.max(pct - 100, 0), 100) / 2 // 50–100 arc%
  const topPt = pt(50)                                              // 12-o'clock marker

  // ── colours ───────────────────────────────────────────────────────────────
  // Zone 1 (0→100%): green while safe, yellow when approaching target
  const z1Color = isGoodWhenOver
    ? (pct >= 80 ? '#F59E0B' : '#EF4444')   // savings/credit: red → yellow near target
    : (pct >= 80 ? '#F59E0B' : '#10B981')   // checking:      green → yellow near target
  // Zone 2 (100%+):
  const z2Color = isGoodWhenOver ? '#10B981' : '#EF4444'
  // Label colour reflects the current state
  const labelColor = isOver ? z2Color : z1Color

  const fmt = (v: number) =>
    v >= 10000 ? `$${(v / 1000).toFixed(0)}k`
    : v >= 1000 ? `$${(v / 1000).toFixed(1)}k`
    : `$${v.toFixed(0)}`

  // ── signed-value states ────────────────────────────────────────────────────
  const isGood = actual >= budget   // works for all sign combos

  if (budget <= 0) {
    const stateLabel = budget === 0 ? 'no target' : 'carrying balance'
    const net = actual - budget      // how much ahead/behind the planned shortfall
    const shortfall = Math.abs(budget)
    const covered = shortfall > 0 ? Math.max(0, Math.min(100, (net / shortfall) * 100)) : 0
    return (
      <div className="text-center">
        <svg viewBox="0 0 120 78" className="w-full max-w-[116px] mx-auto">
          <path d={seg(0, 100)} fill="none" stroke="#E5E7EB" strokeWidth={sw} strokeLinecap="round" />
          {/* Coverage arc on the left half (0 → midpoint) */}
          {covered > 0 && (
            <path d={seg(0, covered / 2)} fill="none" stroke={isGood ? '#10B981' : '#EF4444'} strokeWidth={sw} strokeLinecap="round" />
          )}
          <circle cx={topPt.x} cy={topPt.y} r="4" fill="white" stroke="#D1D5DB" strokeWidth="1.5" />
          <text x="60" y="52" textAnchor="middle" fontSize="10" fontWeight="bold" fill="#9CA3AF">
            {stateLabel}
          </text>
          <text x="60" y="64" textAnchor="middle" fontSize="9" fill="#9CA3AF">
            {shortfall > 0 ? `${fmt(shortfall)} planned` : '—'}
          </text>
        </svg>
        <p className="text-xs font-semibold text-gray-700 -mt-0.5">{label}</p>
        <p className="text-xs text-gray-400 mt-0.5 tabular-nums">
          {fmt(actual)} / {fmt(Math.abs(budget))}
        </p>
        <p className={`text-xs mt-0.5 font-medium ${isGood ? 'text-green-600' : 'text-red-500'}`}>
          {isGood ? 'on track or ahead' : 'shortfall growing'}
        </p>
      </div>
    )
  }

  return (
    <div className="text-center">
      <svg viewBox="0 0 120 78" className="w-full max-w-[116px] mx-auto">
        {/* Full track */}
        <path d={seg(0, 100)} fill="none" stroke="#E5E7EB" strokeWidth={sw} strokeLinecap="round" />

        {/* Zone 1: left → midpoint (0–100% of budget) */}
        {zone1End > 0 && (
          <path d={seg(0, zone1End)} fill="none" stroke={z1Color} strokeWidth={sw} strokeLinecap="round" />
        )}

        {/* Zone 2: midpoint → right (100%–200%+ overage) */}
        {isOver && zone2End > 50 && (
          <path d={seg(50, zone2End)} fill="none" stroke={z2Color} strokeWidth={sw} strokeLinecap="round" />
        )}

        {/* Target marker at 12-o'clock (= 100% of budget) */}
        <circle cx={topPt.x} cy={topPt.y} r="4" fill="white" stroke="#9CA3AF" strokeWidth="1.5" />

        {/* Percentage */}
        <text x="60" y="54" textAnchor="middle" fontSize="21" fontWeight="bold" fill={labelColor}>
          {pct > 999 ? '999+' : `${Math.round(pct)}`}%
        </text>
        <text x="60" y="66" textAnchor="middle" fontSize="9" fill="#9CA3AF">
          of target
        </text>
      </svg>

      {/* Labels below arc */}
      <p className="text-xs font-semibold text-gray-700 -mt-0.5">{label}</p>
      <p className="text-xs text-gray-400 mt-0.5 tabular-nums">
        {fmt(actual)} / {fmt(budget)}
      </p>
      <p className={`text-xs mt-0.5 font-medium ${isGood ? 'text-green-600' : 'text-red-500'}`}>
        {isOver
          ? (isGoodWhenOver ? '↑ above target' : '↑ over budget')
          : (isGoodWhenOver ? '↓ below target' : '↓ under budget')}
      </p>
    </div>
  )
}

// ─── Main widget ─────────────────────────────────────────────────────────────
const BudgetSummaryWidget: React.FC<BudgetSummaryWidgetProps> = ({
  title = 'Budget Summary',
  totalBudget,
  totalSpent,
  totalRemaining,
  monthName,
  daysInMonth,
  daysPassed,
  isCompleted = false,
  checkingGauge,
  savingsGauge,
  creditGauge,
  onPrevMonth,
  onNextMonth,
  canGoNext = false,
  monthContextLabel,
  className = '',
}) => {
  const spentPct = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0
  const timePct  = (daysPassed / daysInMonth) * 100
  const isOverBudget = totalSpent > totalBudget
  const isOnTrack    = spentPct <= timePct

  const dailyAvg    = daysPassed > 0 ? totalSpent / daysPassed : 0
  const dailyBudget = daysInMonth > 0 ? totalBudget / daysInMonth : 0

  const gauges = [
    checkingGauge && { key: 'checking', label: 'Checking', ...checkingGauge, isGoodWhenOver: false },
    savingsGauge  && { key: 'savings',  label: 'Savings',  ...savingsGauge,  isGoodWhenOver: true  },
    creditGauge   && { key: 'credit',   label: 'Credit',   ...creditGauge,   isGoodWhenOver: true  },
  ].filter(Boolean) as { key: string; label: string; budget: number; actual: number; isGoodWhenOver: boolean }[]

  // Touch swipe for month navigation
  const touchStartX = useRef<number | null>(null)
  const SWIPE_THRESHOLD = 50
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.changedTouches[0].screenX
  }
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return
    const deltaX = e.changedTouches[0].screenX - touchStartX.current
    if (deltaX > SWIPE_THRESHOLD && onPrevMonth) {
      onPrevMonth()
    } else if (deltaX < -SWIPE_THRESHOLD && onNextMonth && canGoNext) {
      onNextMonth()
    }
    touchStartX.current = null
  }

  return (
    <div
      className={`card ${className}`}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium text-gray-900">{title}</h3>
        <div className="flex items-center gap-1.5">
          {monthContextLabel && (
            <span className="text-xs text-gray-400 mr-1">{monthContextLabel}</span>
          )}
          {onPrevMonth && (
            <button
              onClick={onPrevMonth}
              className="px-2 py-1 text-xs text-gray-600 hover:text-gray-900 border border-gray-200 rounded hover:bg-gray-50 transition-colors"
            >← Prev</button>
          )}
          {onNextMonth && (
            <button
              onClick={onNextMonth}
              disabled={!canGoNext}
              className="px-2 py-1 text-xs text-gray-600 hover:text-gray-900 border border-gray-200 rounded hover:bg-gray-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >Next →</button>
          )}
        </div>
      </div>

      <div className="space-y-4">
        {/* Month name + day info */}
        <div className="text-center">
          <p className="text-2xl font-bold text-gray-900">{monthName}</p>
          <p className="text-sm text-gray-500">
            {isCompleted
              ? `${daysInMonth} days — month completed`
              : `${daysPassed} of ${daysInMonth} days (${Math.round(timePct)}% complete)`}
          </p>
        </div>

        {/* Per-account-type arc gauges */}
        {gauges.length > 0 ? (
          <div className={`grid gap-2 ${gauges.length === 1 ? 'grid-cols-1 max-w-[140px] mx-auto' : gauges.length === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-3'}`}>
            {gauges.map(g => (
              <ArcGauge key={g.key} label={g.label} budget={g.budget} actual={g.actual} isGoodWhenOver={g.isGoodWhenOver} />
            ))}
          </div>
        ) : (
          /* Fallback: single overall gauge if no per-type data */
          <div className="flex justify-center">
            <ArcGauge label="Overall" budget={totalBudget} actual={totalSpent} isGoodWhenOver={false} />
          </div>
        )}

        {/* Overall numbers */}
        <div className="grid grid-cols-3 gap-4 text-center border-t border-gray-100 pt-3">
          <div>
            <p className="text-xs text-gray-500">Budgeted</p>
            <p className="font-bold text-blue-600 text-sm">${totalBudget.toFixed(0)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Actual</p>
            <p className={`font-bold text-sm ${isOverBudget ? 'text-red-600' : 'text-gray-900'}`}>
              ${totalSpent.toFixed(0)}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">{totalRemaining < 0 ? 'Over By' : 'Remaining'}</p>
            <p className={`font-bold text-sm ${totalRemaining < 0 ? 'text-red-600' : 'text-green-600'}`}>
              ${Math.abs(totalRemaining).toFixed(0)}
            </p>
          </div>
        </div>

        {/* Status */}
        <div className="space-y-2">
          <div className={`p-3 rounded-lg text-center ${isOverBudget ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
            <p className="font-medium text-sm">
              {isCompleted
                ? (isOverBudget ? '✗ Finished Over Budget' : '✓ Finished Under Budget')
                : (isOnTrack ? '✓ On Track' : '⚠ Over Budget Pace')}
            </p>
            <p className="text-xs mt-0.5">
              {isCompleted
                ? `Used ${spentPct.toFixed(0)}% of budget${isOverBudget ? ` — ${(spentPct - 100).toFixed(0)}% over` : ''}`
                : isOnTrack
                  ? `Spending ${Math.abs(spentPct - timePct).toFixed(0)}% slower than time`
                  : `Spending ${Math.abs(spentPct - timePct).toFixed(0)}% faster than time`}
            </p>
          </div>

          <div className="p-3 bg-gray-50 rounded-lg text-center">
            <p className="text-xs text-gray-600">Daily Average</p>
            <p className="font-medium text-sm text-gray-900">
              ${dailyAvg.toFixed(0)} / ${dailyBudget.toFixed(0)} budgeted
            </p>
            <p className="text-xs text-gray-500">
              {dailyAvg > dailyBudget
                ? `$${(dailyAvg - dailyBudget).toFixed(0)}/day over`
                : `$${(dailyBudget - dailyAvg).toFixed(0)}/day under`}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default BudgetSummaryWidget
