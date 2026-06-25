import React, { useState } from 'react'
import axios from 'axios'
import { Capacitor } from '@capacitor/core'

const ResetAllData: React.FC = () => {
  const [resetting, setResetting] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const isNative = Capacitor.isNativePlatform()

  const handleReset = async () => {
    setShowResetConfirm(false)
    setResetting(true)
    setMessage(null)
    try {
      if (isNative) {
        const { resetMobileDatabase } = await import('../utils/mobileBackup')
        const result = await resetMobileDatabase()
        setMessage({ type: 'success', text: `${result.message} Refreshing page...` })
      } else {
        const response = await axios.post('http://localhost:3001/api/backup/reset')
        setMessage({ type: 'success', text: `${response.data.message} Refreshing page...` })
      }
      setTimeout(() => window.location.reload(), 2000)
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.response?.data?.error || error?.message || 'Reset failed' })
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="card p-6">
      <h2 className="text-lg font-bold text-red-700 mb-4">Reset All Data</h2>

      <div className="bg-red-50 border border-red-200 rounded p-4 space-y-3">
        <p className="text-sm text-red-800">
          This will <span className="font-bold">permanently delete</span> all accounts, budget items, categories, history, rules, and preferences.
          This action <span className="font-bold">cannot be undone</span>.
        </p>
        <p className="text-sm text-red-700">
          We strongly recommend exporting a backup first so you can restore your data if needed.
        </p>
        <button
          onClick={() => setShowResetConfirm(true)}
          disabled={resetting}
          className="text-sm px-4 py-2 rounded font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
        >
          {resetting ? 'Resetting...' : 'Reset All Data'}
        </button>
      </div>

      {message && (
        <div className={`mt-4 p-3 rounded-md text-sm ${
          message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
        }`}>
          {message.text}
        </div>
      )}

      {/* Reset Confirmation Modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-bold text-red-700 mb-2">Confirm Reset</h3>
            <p className="text-sm text-gray-600 mb-4">
              This will <span className="font-bold text-red-600">permanently delete</span> all data including:
            </p>
            <ul className="text-sm text-gray-600 mb-4 list-disc pl-5 space-y-1">
              <li>All accounts and their balances</li>
              <li>All budget items and categories</li>
              <li>All historical transactions</li>
              <li>All auto-assign rules</li>
              <li>All user preferences</li>
            </ul>
            <p className="text-sm text-red-600 mb-5 font-medium">
              This cannot be undone. Export a backup first if you want to keep your data.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-md hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleReset}
                className="text-sm px-4 py-2 rounded font-medium bg-red-600 text-white hover:bg-red-700"
              >
                Yes, Delete Everything
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ResetAllData
