import React, { useState } from 'react'

interface DataPoint {
  label: string
  value: number
  date: Date
}

interface Props {
  data: DataPoint[]
  height?: number
}

const SpendingTrendChart: React.FC<Props> = ({ data, height = 320 }) => {
  const [blend, setBlend] = useState(50)

  if (!data.length) {
    return <div className="h-64 flex items-center justify-center bg-gray-50 rounded-lg"><p className="text-gray-500">No spending data</p></div>
  }

  // Linear regression for trend line
  const computeTrendLine = (points: DataPoint[]): { slope: number; intercept: number } => {
    const n = points.length
    if (n < 2) return { slope: 0, intercept: points[0]?.value || 0 }

    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0
    for (let i = 0; i < n; i++) {
      sumX += i
      sumY += points[i].value
      sumXY += i * points[i].value
      sumX2 += i * i
    }

    const denominator = n * sumX2 - sumX * sumX
    if (denominator === 0) return { slope: 0, intercept: sumY / n }

    const slope = (n * sumXY - sumX * sumY) / denominator
    const intercept = (sumY - slope * sumX) / n
    return { slope, intercept }
  }

  const trend = computeTrendLine(data)
  const trendValue = (index: number) => trend.slope * index + trend.intercept

  // Chart scaling
  const exactValues = data.map(d => d.value)
  const trendValues = data.map((_, i) => trendValue(i))
  const allValues = [...exactValues, ...trendValues]

  const maxVal = Math.max(...allValues, ...exactValues)
  const minVal = Math.min(...allValues, ...exactValues)
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

  const fmt = (n: number) => Math.abs(n) >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`

  const yTicks = Array.from({ length: 6 }, (_, i) => yMin + i * (yRange / 5))

  // Smart X-axis tick spacing (like BalanceForecastChart)
  const days = data.length
  const maxTicks = 10
  const step = Math.max(1, Math.floor((days - 1) / maxTicks))
  const ticks: number[] = [0]
  for (let i = step; i < days - 1; i += step) ticks.push(i)
  if (days > 1) {
    if (days - 1 - (ticks[ticks.length - 1] || 0) < step / 2) {
      ticks[ticks.length - 1] = days - 1
    } else {
      ticks.push(days - 1)
    }
  }

  const sliderPos = blend / 100
  const maxRadius = Math.max(data.length * 2, 1)

  // α(x) = 1.75 · √(x / (100 − x)), where x is slider position 0-100
  const getRadius = (x: number): number => {
    if (x <= 0) return 0
    if (x >= 100) return maxRadius
    const alpha = 1.75 * Math.sqrt(x / (100 - x))
    return Math.min(alpha, maxRadius)
  }

  const radius = getRadius(blend)

  // Compute deviations from trend
  const deviations = data.map((d, i) => d.value - trendValue(i))

  // Gaussian smoothing of deviations — disperses spikes outward instead of compressing vertically
  const smoothDeviations = (devs: number[], radius: number): number[] => {
    if (radius === 0) return devs
    return devs.map((_, i) => {
      let sum = 0
      let weightSum = 0
      for (let j = 0; j < devs.length; j++) {
        const distance = i - j
        const weight = Math.exp(-(distance * distance) / (2 * radius * radius))
        sum += devs[j] * weight
        weightSum += weight
      }
      return sum / weightSum
    })
  }

  const smoothedDeviations = smoothDeviations(deviations, radius)

  const blendedPoints = data.map((_, i) => {
    const blendedY = trendValue(i) + smoothedDeviations[i]
    return `${xFor(i)},${yFor(blendedY)}`
  }).join(' ')

  const exactPoints = data.map((d, i) => `${xFor(i)},${yFor(d.value)}`).join(' ')

  return (
    <div className="w-full">
      {/* Blend slider */}
      <div className="flex items-center gap-2 mb-2">
        {/* Exact pill — left of slider */}
        <span
          className="px-2.5 py-1 text-xs font-medium rounded-md transition-colors duration-150 select-none"
          style={{
            backgroundColor: `rgb(${59 + sliderPos * (229 - 59)}, ${130 + sliderPos * (231 - 130)}, ${246 + sliderPos * (235 - 246)})`,
            color: sliderPos < 0.5 ? '#fff' : '#6B7280'
          }}
        >
          Exact
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={blend}
          onChange={e => setBlend(Number(e.target.value))}
          className="flex-1 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
        />
        {/* Trend pill — right of slider */}
        <span
          className="px-2.5 py-1 text-xs font-medium rounded-md transition-colors duration-150 select-none"
          style={{
            backgroundColor: `rgb(${229 + sliderPos * (59 - 229)}, ${231 + sliderPos * (130 - 231)}, ${235 + sliderPos * (246 - 235)})`,
            color: sliderPos > 0.5 ? '#fff' : '#6B7280'
          }}
        >
          Trend
        </span>
      </div>
      <div className="text-xs text-gray-500 mb-2 font-mono select-text">
        Slider: {blend}% &nbsp;|&nbsp; Smoothing: {radius.toFixed(2)}
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
          {yMin <= 0 && yMax >= 0 && (
            <line x1={PL} y1={yFor(0)} x2={W - PR} y2={yFor(0)} stroke="#9CA3AF" strokeWidth="1.5" strokeDasharray="6,4" />
          )}
          {/* X grid + labels */}
          {ticks.map(i => (
            <g key={`x${i}`}>
              <line x1={xFor(i)} y1={PT} x2={xFor(i)} y2={H - PB} stroke="#E5E7EB" strokeWidth="1" />
              <text x={xFor(i)} y={H - PB + 16} textAnchor={i === 0 ? 'start' : i === days - 1 ? 'end' : 'middle'} fontSize="11" fill="#6B7280">
                {data[i].date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </text>
            </g>
          ))}
          {/* Ghost exact line (fades as morph completes) */}
          <polyline
            points={exactPoints}
            fill="none"
            stroke="#BFDBFE"
            strokeWidth="1.5"
            opacity={0.3 * (1 - sliderPos)}
          />
          {/* Blended line — morphs from exact shape to straight trend */}
          <polyline
            points={blendedPoints}
            fill="none"
            stroke={`rgb(${59 + sliderPos * (239 - 59)}, ${130 + sliderPos * (68 - 130)}, ${246 + sliderPos * (68 - 246)})`}
            strokeWidth="2.5"
          />
          {/* Data points */}
          {data.map((_, i) => {
            const blendedY = trendValue(i) + smoothedDeviations[i]
            const pointBlend = Math.min(sliderPos * 2, 1) // fade faster than the line
            return (
              <circle
                key={i}
                cx={xFor(i)}
                cy={yFor(blendedY)}
                r={3 + (1 - pointBlend) * 2}
                fill={`rgb(${59 + pointBlend * (180 - 59)}, ${130 + pointBlend * (150 - 130)}, ${246 + pointBlend * (255 - 246)})`}
                stroke="white"
                strokeWidth="2"
                opacity={0.8 + pointBlend * 0.2}
              />
            )
          })}
        </svg>
      </div>
    </div>
  )
}

export default SpendingTrendChart
