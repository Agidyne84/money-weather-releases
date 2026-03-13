const Dashboard = () => {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <div className="text-sm text-gray-500">
          {new Date().toLocaleDateString('en-US', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          })}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                <span className="text-green-600">📈</span>
              </div>
            </div>
            <div className="ml-4">
              <div className="text-sm font-medium text-gray-500">Monthly Income</div>
              <div className="text-2xl font-bold text-gray-900">$5,250</div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center">
                <span className="text-red-600">📉</span>
              </div>
            </div>
            <div className="ml-4">
              <div className="text-sm font-medium text-gray-500">Monthly Expenses</div>
              <div className="text-2xl font-bold text-gray-900">$3,180</div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                <span className="text-blue-600">💰</span>
              </div>
            </div>
            <div className="ml-4">
              <div className="text-sm font-medium text-gray-500">Net Income</div>
              <div className="text-2xl font-bold text-gray-900">$2,070</div>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Activity</h2>
        <div className="space-y-3">
          <div className="flex justify-between items-center py-2 border-b border-gray-100">
            <div>
              <div className="font-medium text-gray-900">Grocery Store</div>
              <div className="text-sm text-gray-500">Today</div>
            </div>
            <div className="text-red-600 font-medium">-$125.50</div>
          </div>
          <div className="flex justify-between items-center py-2 border-b border-gray-100">
            <div>
              <div className="font-medium text-gray-900">Salary Deposit</div>
              <div className="text-sm text-gray-500">2 days ago</div>
            </div>
            <div className="text-green-600 font-medium">+$2,625.00</div>
          </div>
          <div className="flex justify-between items-center py-2">
            <div>
              <div className="font-medium text-gray-900">Electric Bill</div>
              <div className="text-sm text-gray-500">3 days ago</div>
            </div>
            <div className="text-red-600 font-medium">-$89.00</div>
          </div>
        </div>
      </div>

      {/* Budget Overview */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Budget Overview</h2>
        <div className="space-y-4">
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-600">Groceries</span>
              <span className="text-gray-900">$420 / $500</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="bg-green-600 h-2 rounded-full" style={{ width: '84%' }}></div>
            </div>
          </div>
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-600">Entertainment</span>
              <span className="text-gray-900">$180 / $200</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="bg-yellow-600 h-2 rounded-full" style={{ width: '90%' }}></div>
            </div>
          </div>
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-600">Utilities</span>
              <span className="text-gray-900">$350 / $400</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="bg-green-600 h-2 rounded-full" style={{ width: '87.5%' }}></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Dashboard
