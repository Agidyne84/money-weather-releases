const Forecast = () => {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Financial Forecast</h1>
        <div className="flex space-x-2">
          <select className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500">
            <option>Next 3 Months</option>
            <option>Next 6 Months</option>
            <option>Next 12 Months</option>
          </select>
          <button className="btn-primary">Update Forecast</button>
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Projected Cash Flow</h2>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="text-center p-4 bg-green-50 rounded-lg">
              <div className="text-sm text-green-600 font-medium">April 2026</div>
              <div className="text-xl font-bold text-green-700">+$2,100</div>
              <div className="text-xs text-green-600">Projected Net</div>
            </div>
            <div className="text-center p-4 bg-yellow-50 rounded-lg">
              <div className="text-sm text-yellow-600 font-medium">May 2026</div>
              <div className="text-xl font-bold text-yellow-700">+$1,850</div>
              <div className="text-xs text-yellow-600">Projected Net</div>
            </div>
            <div className="text-center p-4 bg-red-50 rounded-lg">
              <div className="text-sm text-red-600 font-medium">June 2026</div>
              <div className="text-xl font-bold text-red-700">-$250</div>
              <div className="text-xs text-red-600">Projected Net</div>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Budget Chokepoints</h2>
        <div className="space-y-3">
          <div className="p-4 border-l-4 border-red-500 bg-red-50 rounded">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-semibold text-red-800">Entertainment Budget</h3>
                <p className="text-sm text-red-600 mt-1">Projected to exceed by $150 in June due to vacation expenses</p>
                <div className="mt-2">
                  <span className="text-xs bg-red-100 text-red-800 px-2 py-1 rounded">High Risk</span>
                </div>
              </div>
            </div>
            <div className="mt-3 text-sm text-red-700">
              <strong>Recommendations:</strong>
              <ul className="list-disc list-inside mt-1 space-y-1">
                <li>Increase entertainment budget by $200 for June</li>
                <li>Look for vacation deals to reduce entertainment costs</li>
                <li>Transfer funds from savings to cover shortfall</li>
              </ul>
            </div>
          </div>

          <div className="p-4 border-l-4 border-yellow-500 bg-yellow-50 rounded">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-semibold text-yellow-800">Utilities Category</h3>
                <p className="text-sm text-yellow-600 mt-1">Seasonal increase expected for summer cooling</p>
                <div className="mt-2">
                  <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded">Medium Risk</span>
                </div>
              </div>
            </div>
            <div className="mt-3 text-sm text-yellow-700">
              <strong>Recommendations:</strong>
              <ul className="list-disc list-inside mt-1 space-y-1">
                <li>Increase utility budget by $50 for summer months</li>
                <li>Consider energy-saving measures</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Forecast Assumptions</h2>
        <div className="space-y-3 text-sm text-gray-600">
          <div className="flex justify-between">
            <span>Income stability:</span>
            <span className="font-medium">95% confidence</span>
          </div>
          <div className="flex justify-between">
            <span>Recurring expenses:</span>
            <span className="font-medium">Based on 6-month average</span>
          </div>
          <div className="flex justify-between">
            <span>Seasonal adjustments:</span>
            <span className="font-medium">Applied for utilities/entertainment</span>
          </div>
          <div className="flex justify-between">
            <span>Inflation factor:</span>
            <span className="font-medium">3% annual</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Forecast
