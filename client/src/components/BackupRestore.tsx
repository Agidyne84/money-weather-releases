import React, { useState } from 'react'
import axios from 'axios'
import { Capacitor } from '@capacitor/core'

const API_BASE_URL = 'http://localhost:3001/api'
const isNative = Capacitor.isNativePlatform()

const EyeIcon = ({ open }: { open: boolean }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {open ? (
      <>
        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ) : (
      <>
        <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
        <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
        <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7c.78 0 1.53-.09 2.24-.26" />
        <line x1="2" x2="22" y1="2" y2="22" />
      </>
    )}
  </svg>
)

const BackupRestore: React.FC = () => {
  const [exportPassphrase, setExportPassphrase] = useState('')
  const [importPassphrase, setImportPassphrase] = useState('')
  const [importFile, setImportFile] = useState<File | null>(null)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [showExportPassphrase, setShowExportPassphrase] = useState(false)
  const [showImportPassphrase, setShowImportPassphrase] = useState(false)
  const [resetting, setResetting] = useState(false)

  const handleExport = async (encrypted: boolean) => {
    setExporting(true)
    setMessage(null)
    try {
      const passphrase = encrypted ? exportPassphrase : undefined

      if (encrypted && !exportPassphrase.trim()) {
        setMessage({ type: 'error', text: 'Please enter a passphrase for encrypted export.' })
        setExporting(false)
        return
      }

      if (isNative) {
        // Mobile: generate backup client-side and share via native share sheet
        const { exportMobileBackup, shareMobileBackup } = await import('../utils/mobileBackup')
        const data = await exportMobileBackup(passphrase)
        const filename = encrypted ? 'budget-backup.budgetbackup' : 'budget-backup.json'
        await shareMobileBackup(data, filename)
        setMessage({ type: 'success', text: `Backup exported successfully${encrypted ? ' (encrypted)' : ' (unencrypted)'}` })
      } else {
        // Desktop: use server API
        const response = await axios.post(
          `${API_BASE_URL}/backup/export`,
          { passphrase },
          { responseType: 'blob' }
        )

        // Download the file
        const blob = new Blob([response.data])
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = encrypted ? 'budget-backup.budgetbackup' : 'budget-backup.json'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)

        setMessage({ type: 'success', text: `Backup exported successfully${encrypted ? ' (encrypted)' : ' (unencrypted)'}` })
      }
      setExportPassphrase('')
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.response?.data?.error || error?.message || 'Export failed' })
    } finally {
      setExporting(false)
    }
  }

  const handleImport = async () => {
    if (!importFile) {
      setMessage({ type: 'error', text: 'Please select a backup file.' })
      return
    }

    setShowConfirm(false)
    setImporting(true)
    setMessage(null)

    try {
      const fileBuffer = await importFile.arrayBuffer()

      if (isNative) {
        // Mobile: restore using client-side SQLite
        const { importMobileBackup } = await import('../utils/mobileBackup')
        const passphrase = importPassphrase.trim() || undefined
        const result = await importMobileBackup(fileBuffer, passphrase)
        const counts = Object.entries(result.summary)
          .map(([table, count]) => `${table.replace(/_/g, ' ')}: ${count}`)
          .join(', ')
        setMessage({ type: 'success', text: `Restore complete! ${counts}. Refreshing page...` })
      } else {
        // Desktop: use server API
        const headers: Record<string, string> = {
          'Content-Type': 'application/octet-stream',
        }
        if (importPassphrase.trim()) {
          headers['X-Backup-Passphrase'] = importPassphrase
        }

        const response = await axios.post(
          `${API_BASE_URL}/backup/import`,
          fileBuffer,
          { headers }
        )

        const { summary } = response.data
        const counts = Object.entries(summary)
          .map(([table, count]) => `${table.replace(/_/g, ' ')}: ${count}`)
          .join(', ')

        setMessage({ type: 'success', text: `Restore complete! ${counts}. Refreshing page...` })
      }

      setImportFile(null)
      setImportPassphrase('')

      // Reload after a short delay so user sees the success message
      setTimeout(() => window.location.reload(), 2000)
    } catch (error: any) {
      const errMsg = error?.response?.data?.error || error?.message || 'Import failed'
      setMessage({ type: 'error', text: errMsg })
    } finally {
      setImporting(false)
    }
  }

  const handleReset = async () => {
    setShowResetConfirm(false)
    setResetting(true)
    setMessage(null)

    try {
      if (isNative) {
        // Mobile: reset client-side SQLite
        const { resetMobileDatabase } = await import('../utils/mobileBackup')
        const result = await resetMobileDatabase()
        setMessage({ type: 'success', text: `${result.message} Refreshing page...` })
      } else {
        // Desktop: use server API
        const response = await axios.post(`${API_BASE_URL}/backup/reset`)
        setMessage({ type: 'success', text: `${response.data.message} Refreshing page...` })
      }
      setTimeout(() => window.location.reload(), 2000)
    } catch (error: any) {
      const errMsg = error?.response?.data?.error || error?.message || 'Reset failed'
      setMessage({ type: 'error', text: errMsg })
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="card p-6">
      <h2 className="text-xl font-bold text-gray-900 mb-1">Backup & Restore</h2>
      <p className="text-sm text-gray-500 mb-5">Export your data as an encrypted backup or restore from a previous backup. All data stays local.</p>

      {message && (
        <div className={`mb-4 px-4 py-3 rounded text-sm font-medium ${
          message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          {message.text}
        </div>
      )}

      {/* Export Section */}
      <div className="mb-6">
        <h3 className="text-md font-semibold text-gray-800 mb-3">Export Backup</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-600 mb-1">
              Passphrase <span className="text-gray-400">(for encrypted export)</span>
            </label>
            <div className="relative w-full max-w-sm">
              <input
                type={showExportPassphrase ? 'text' : 'password'}
                className="input w-full pr-10"
                placeholder="Enter a strong passphrase..."
                value={exportPassphrase}
                onChange={(e) => setExportPassphrase(e.target.value)}
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowExportPassphrase(v => !v)}
                className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-400 hover:text-gray-600"
                title={showExportPassphrase ? 'Hide passphrase' : 'Show passphrase'}
              >
                <EyeIcon open={showExportPassphrase} />
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              You will need this passphrase to restore the backup. It is never stored.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => handleExport(true)}
              disabled={exporting || !exportPassphrase.trim()}
              className="btn-primary text-sm disabled:opacity-50"
            >
              {exporting ? 'Exporting...' : 'Export Encrypted Backup'}
            </button>
            <button
              onClick={() => handleExport(false)}
              disabled={exporting}
              className="btn-secondary text-sm disabled:opacity-50"
              title="Exports plain JSON without encryption — for local-only use"
            >
              Export Unencrypted
            </button>
          </div>
        </div>
      </div>

      {/* Reset Section */}
      <div className="border-t pt-5 mb-6">
        <h3 className="text-md font-semibold text-gray-800 mb-3">Reset All Data</h3>
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
      </div>

      {/* Restore Section */}
      <div className="border-t pt-5">
        <h3 className="text-md font-semibold text-gray-800 mb-3">Restore from Backup</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Backup File</label>
            <input
              type="file"
              accept=".budgetbackup,.json"
              className="text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              onChange={(e) => setImportFile(e.target.files?.[0] || null)}
            />
          </div>
          {importFile && importFile.name.endsWith('.budgetbackup') && (
            <div>
              <label className="block text-sm text-gray-600 mb-1">
                Passphrase <span className="text-gray-400">(used during export)</span>
              </label>
              <div className="relative w-full max-w-sm">
                <input
                  type={showImportPassphrase ? 'text' : 'password'}
                  className="input w-full pr-10"
                  placeholder="Enter the passphrase used to export..."
                  value={importPassphrase}
                  onChange={(e) => setImportPassphrase(e.target.value)}
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowImportPassphrase(v => !v)}
                  className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-400 hover:text-gray-600"
                  title={showImportPassphrase ? 'Hide passphrase' : 'Show passphrase'}
                >
                  <EyeIcon open={showImportPassphrase} />
                </button>
              </div>
            </div>
          )}
          <button
            onClick={() => setShowConfirm(true)}
            disabled={importing || !importFile}
            className="text-sm px-4 py-2 rounded font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
          >
            {importing ? 'Restoring...' : 'Restore Backup'}
          </button>
          <p className="text-xs text-red-500">
            Warning: Restoring a backup will replace ALL current data. This cannot be undone.
          </p>
        </div>
      </div>

      {/* Restore Confirmation Modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Confirm Restore</h3>
            <p className="text-sm text-gray-600 mb-4">
              This will <span className="font-bold text-red-600">permanently replace</span> all existing data
              (accounts, transactions, categories, history, rules, and preferences) with the contents of the backup file.
            </p>
            <p className="text-sm text-gray-600 mb-5">
              File: <span className="font-medium">{importFile?.name}</span>
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowConfirm(false)}
                className="btn-secondary text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleImport}
                className="text-sm px-4 py-2 rounded font-medium bg-red-600 text-white hover:bg-red-700"
              >
                Yes, Replace All Data
              </button>
            </div>
          </div>
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
                className="btn-secondary text-sm"
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

export default BackupRestore
