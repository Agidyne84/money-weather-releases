import React, { useEffect, useState } from 'react'
import axios from 'axios'

const API_BASE_URL = 'http://localhost:3001/api'

const ConnectionStatus: React.FC = () => {
  const [status, setStatus] = useState<'connected' | 'disconnected' | 'checking'>('checking')
  const [showDetails, setShowDetails] = useState(false)
  const [appVersion, setAppVersion] = useState<string | null>(null)

  const checkHealth = async (isInitial = false) => {
    if (isInitial) setStatus('checking')
    try {
      await axios.get(`${API_BASE_URL}/health`, { timeout: 3000 })
      setStatus(prev => prev === 'connected' ? prev : 'connected')
    } catch {
      setStatus(prev => prev === 'disconnected' ? prev : 'disconnected')
    }
  }

  useEffect(() => {
    checkHealth(true)
    const interval = setInterval(() => checkHealth(false), 5000)
    // Fetch app version from Electron if available
    if ((window as any).electronAPI?.getAppVersion) {
      (window as any).electronAPI.getAppVersion().then((v: string) => setAppVersion(v))
    }
    return () => clearInterval(interval)
  }, [])

  if (status === 'checking') return null

  if (status === 'connected') {
    return (
      <div className="flex items-center justify-between px-4 py-1 bg-gray-100 border-t border-gray-200">
        <div className="flex items-center gap-1.5 text-xs text-green-700">
          <span className="w-2 h-2 rounded-full bg-green-500" />
          Backend connected
        </div>
        {appVersion && (
          <span className="text-xs text-gray-400">v{appVersion}</span>
        )}
      </div>
    )
  }

  return (
    <div className="px-4 py-2 bg-red-50 border-t border-red-200">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2">
          <>
            <span className="w-2 h-2 rounded-full bg-red-500" />
            <span className="text-sm font-medium text-red-800">Backend disconnected — data cannot be loaded or saved</span>
          </>
        </div>
        <div className="flex items-center gap-2">
          {appVersion && (
            <span className="text-xs text-gray-400">v{appVersion}</span>
          )}
          <button
            onClick={() => checkHealth(true)}
            className="text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50"
          >
            Retry Connection
          </button>
          {status === 'disconnected' && (
            <button
              onClick={() => setShowDetails(v => !v)}
              className="text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50"
            >
              {showDetails ? 'Hide' : 'How to fix'}
            </button>
          )}
        </div>
      </div>
      {showDetails && status === 'disconnected' && (
        <div className="max-w-7xl mx-auto mt-2 text-xs text-red-700 bg-red-100 rounded p-2">
          <p className="font-semibold mb-1">Restart the backend server:</p>
          <ol className="list-decimal list-inside space-y-0.5">
            <li>Open a terminal in the project root</li>
            <li>Run: <code className="bg-white px-1 rounded">cd server ; npm run dev</code></li>
            <li>Wait for "Server running on port 3001"</li>
            <li>Click <strong>Retry Connection</strong> above</li>
          </ol>
          <p className="mt-1.5">If the frontend also fails to load, run: <code className="bg-white px-1 rounded">cd client ; npm run dev</code></p>
        </div>
      )}
    </div>
  )
}

export default ConnectionStatus
