import React, { useState, useEffect } from 'react'
import AccountManager from '../components/AccountManager'
import BulkTransactionEntry from '../components/BulkTransactionImport'
import CategoryManager from '../components/CategoryManager'
import RulesManager from '../components/RulesManager'
import { rulesApi } from '../services/database'
import BackupRestore from '../components/BackupRestore'
import AppLockSettings from '../components/AppLockSettings'
import CloudSyncSettings from '../components/CloudSyncSettings'
import MobileUpdateChecker from '../components/MobileUpdateChecker'

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

      {hasRules && <RulesManager />}
      <AccountManager />
      <CategoryManager />
      <BulkTransactionEntry />
      {!hasRules && <RulesManager />}
      <BackupRestore />
      <CloudSyncSettings />
      <MobileUpdateChecker />
      <AppLockSettings />
    </div>
  )
}

export default Setup
