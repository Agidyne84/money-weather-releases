import React, { useState, useEffect } from 'react'
import AccountManager from '../components/AccountManager'
import BulkTransactionEntry from '../components/BulkTransactionImport'
import CategoryManager from '../components/CategoryManager'
import RulesManager from '../components/RulesManager'
import { rulesApi } from '../services/database'
import AppLockSettings from '../components/AppLockSettings'
import CloudSyncSettings from '../components/CloudSyncSettings'
import MobileUpdateChecker from '../components/MobileUpdateChecker'
import ResetAllData from '../components/ResetAllData'

const Setup: React.FC = () => {
  const [hasRules, setHasRules] = useState(false)

  useEffect(() => {
    rulesApi.getAll().then(rules => setHasRules(rules.length > 0)).catch(() => {})
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Setup</h1>
        <p className="text-gray-600">Configure your accounts, categories, and transactions</p>
      </div>

      <div className="card">
        <CloudSyncSettings />
      </div>
      {hasRules && <RulesManager />}
      <AccountManager />
      <CategoryManager />
      <BulkTransactionEntry />
      {!hasRules && <RulesManager />}
      <AppLockSettings />
      <MobileUpdateChecker />
      <ResetAllData />
    </div>
  )
}

export default Setup
