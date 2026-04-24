import React from 'react'
import AccountManager from '../components/AccountManager'

const Accounts: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        <AccountManager />
      </div>
    </div>
  )
}

export default Accounts
