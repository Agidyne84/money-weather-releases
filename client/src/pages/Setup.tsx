import React from 'react'
import AccountManager from '../components/AccountManager'
import BulkTransactionEntry from '../components/BulkTransactionImport'

const Setup: React.FC = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Setup</h1>
        <p className="text-gray-600">Configure your accounts and add transactions</p>
      </div>

      <AccountManager />
      <BulkTransactionEntry />
    </div>
  )
}

export default Setup
