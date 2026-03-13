const Budget = () => {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Monthly Budget</h1>
        <div className="flex space-x-2">
          <select className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500">
            <option>March 2026</option>
            <option>February 2026</option>
            <option>January 2026</option>
          </select>
          <button className="btn-primary">Edit Budget</button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card">
          <div className="text-sm font-medium text-gray-500">Total Budgeted</div>
          <div className="text-2xl font-bold text-gray-900">$4,000</div>
        </div>
        <div className="card">
          <div className="text-sm font-medium text-gray-500">Actual Spending</div>
          <div className="text-2xl font-bold text-gray-900">$3,180</div>
        </div>
        <div className="card">
          <div className="text-sm font-medium text-gray-500">Remaining</div>
          <div className="text-2xl font-bold text-green-600">$820</div>
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Budget by Category</h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
            <div className="flex-1">
              <div className="flex justify-between items-center mb-2">
                <span className="font-medium text-gray-900">Groceries</span>
                <span className="text-sm text-gray-500">$420 / $500</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-green-600 h-2 rounded-full" style={{ width: '84%' }}></div>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
            <div className="flex-1">
              <div className="flex justify-between items-center mb-2">
                <span className="font-medium text-gray-900">Entertainment</span>
                <span className="text-sm text-gray-500">$180 / $200</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-yellow-600 h-2 rounded-full" style={{ width: '90%' }}></div>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
            <div className="flex-1">
              <div className="flex justify-between items-center mb-2">
                <span className="font-medium text-gray-900">Utilities</span>
                <span className="text-sm text-gray-500">$350 / $400</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-green-600 h-2 rounded-full" style={{ width: '87.5%' }}></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Budget
