import React from 'react'
import PieChart from './PieChart'
import LineChart from './LineChart'
import BarChart from './BarChart'

interface AnalyticsWidgetProps {
  title: string
  type: 'pie' | 'line' | 'bar'
  data: any[]
  className?: string
}

const AnalyticsWidget: React.FC<AnalyticsWidgetProps> = ({ 
  title, 
  type, 
  data, 
  className = '' 
}) => {
  const renderChart = () => {
    switch (type) {
      case 'pie':
        return <PieChart data={data} />
      case 'line':
        return <LineChart data={data} />
      case 'bar':
        return <BarChart data={data} />
      default:
        return <div className="text-center text-gray-500">Unsupported chart type</div>
    }
  }

  return (
    <div className={`card ${className}`}>
      <h3 className="text-lg font-medium text-gray-900 mb-4">{title}</h3>
      {data.length > 0 ? (
        renderChart()
      ) : (
        <div className="text-center py-8 text-gray-500">
          <p>No data available</p>
          <p className="text-sm mt-1">Add transactions to see analytics</p>
        </div>
      )}
    </div>
  )
}

export default AnalyticsWidget
