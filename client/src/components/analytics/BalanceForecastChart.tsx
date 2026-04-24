import React from 'react'
import { Account, BalanceForecast } from '../../types'

interface Props {
  data: BalanceForecast[]
  accounts: Account[]
  selectedAccountIds: string[]
  height?: number
}

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16']

const BalanceForecastChart: React.FC<Props> = ({ data, accounts, selectedAccountIds, height = 320 }) => {
  if (!data.length || !selectedAccountIds.length) {
    return <div className="h-64 flex items-center justify-center bg-gray-50 rounded-lg"><p className="text-gray-500">No forecast data</p></div>
  }

  const values: number[] = []
  data.forEach(d => d.accountBalances.forEach(ab => {
    if (selectedAccountIds.includes(ab.accountId)) values.push(ab.balance)
  }))
  if (!values.length) {
    return <div className="h-64 flex items-center justify-center bg-gray-50 rounded-lg"><p className="text-gray-500">No data for selected accounts</p></div>
  }

  const maxVal = Math.max(...values)
  const minVal = Math.min(...values)
  let yMin = Math.min(minVal, 0)
  let yMax = Math.max(maxVal, 0)
  const pad = (yMax - yMin) * 0.05 || 1
  yMin -= pad; yMax += pad
  const yRange = yMax - yMin || 1

  const PL = 56, PR = 16, PT = 16, PB = 40
  const W = 1000, H = 400
  const pw = W - PL - PR, ph = H - PT - PB
  const xFor = (i: number) => PL + (i / (data.length - 1)) * pw
  const yFor = (v: number) => PT + ph - ((v - yMin) / yRange) * ph

  const colorFor = (id: string) => COLORS[selectedAccountIds.indexOf(id) % COLORS.length]
  const fmt = (n: number) => Math.abs(n) >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`

  const days = data.length
  const maxTicks = 10
  const step = Math.max(1, Math.floor((days - 1) / maxTicks))
  const ticks: number[] = [0]
  for (let i = step; i < days - 1; i += step) ticks.push(i)
  // Ensure last tick without overlap: replace previous if too close
  if (days > 1) {
    if (days - 1 - (ticks[ticks.length - 1] || 0) < step / 2) {
      ticks[ticks.length - 1] = days - 1
    } else {
      ticks.push(days - 1)
    }
  }

  const yTicks = Array.from({ length: 6 }, (_, i) => yMin + i * (yRange / 5))

  return (
    <div className="w-full">
      <div className="flex flex-wrap gap-4 mb-2">
        {selectedAccountIds.map(id => {
          const a = accounts.find(ac => ac.id === id)
          return a ? (
            <div key={id} className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: colorFor(id) }} />
              <span className="text-xs text-gray-700">{a.name}</span>
            </div>
          ) : null
        })}
      </div>
      <div style={{ height }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="none">
          {/* Y grid */}
          {yTicks.map((t, i) => (
            <g key={`y${i}`}>
              <line x1={PL} y1={yFor(t)} x2={W - PR} y2={yFor(t)} stroke="#E5E7EB" strokeWidth="1" />
              <text x={PL - 6} y={yFor(t)} textAnchor="end" dominantBaseline="middle" fontSize="12" fill="#6B7280">{fmt(t)}</text>
            </g>
          ))}
          {/* Zero line */}
          <line x1={PL} y1={yFor(0)} x2={W - PR} y2={yFor(0)} stroke="#9CA3AF" strokeWidth="1.5" strokeDasharray="6,4" />
          {/* X grid + labels */}
          {ticks.map(i => (
            <g key={`x${i}`}>
              <line x1={xFor(i)} y1={PT} x2={xFor(i)} y2={H - PB} stroke="#E5E7EB" strokeWidth="1" />
              <text x={xFor(i)} y={H - PB + 16} textAnchor={i === 0 ? 'start' : i === days - 1 ? 'end' : 'middle'} fontSize="11" fill="#6B7280">
                {data[i].date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </text>
            </g>
          ))}
          {/* Data lines */}
          {selectedAccountIds.map(id => {
            const pts = data.map((d, i) => {
              const ab = d.accountBalances.find(a => a.accountId === id)
              return `${xFor(i)},${yFor(ab?.balance ?? yMin)}`
            }).join(' ')
            return <polyline key={id} points={pts} fill="none" stroke={colorFor(id)} strokeWidth="2" />
          })}
        </svg>
      </div>
    </div>
  )
}

export default BalanceForecastChart
