import React, { useState, useEffect } from 'react'
import { isLockEnabled, setPassword, disableLock, isBiometricAvailable, isBiometricEnabled, setBiometricEnabled } from '../services/lockService'

const AppLockSettings: React.FC = () => {
  const [enabled, setEnabled] = useState(false)
  const [showSetup, setShowSetup] = useState(false)
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(true)
  const [bioAvailable, setBioAvailable] = useState(false)
  const [bioEnabled, setBioEnabled] = useState(false)

  useEffect(() => {
    // Guaranteed fallback — always clears loading after 3 seconds
    const fallbackTimer = setTimeout(() => {
      setLoading(false)
    }, 3000)

    const init = async () => {
      try {
        const lock = await isLockEnabled()
        setEnabled(lock)

        const available = await isBiometricAvailable()
        setBioAvailable(available)
        if (available) {
          const bioOn = await isBiometricEnabled()
          setBioEnabled(bioOn)
        }
      } catch (err) {
        console.error('[AppLockSettings] init error:', err)
      } finally {
        clearTimeout(fallbackTimer)
        setLoading(false)
      }
    }
    init()
    return () => clearTimeout(fallbackTimer)
  }, [])

  const handleEnable = () => {
    setShowSetup(true)
    setError('')
    setSuccess('')
  }

  const handleDisable = async () => {
    try {
      await disableLock()
      setEnabled(false)
      setSuccess('App lock disabled.')
    } catch {
      setError('Failed to disable lock.')
    }
  }

  const handleSavePin = async () => {
    setError('')
    setSuccess('')

    if (pin.length < 4) {
      setError('PIN must be at least 4 digits.')
      return
    }
    if (pin !== confirmPin) {
      setError('PINs do not match.')
      return
    }

    const result = await setPassword(pin)
    console.log('[AppLockSettings] setPassword result:', result)
    if (result.success) {
      setEnabled(true)
      setShowSetup(false)
      setPin('')
      setConfirmPin('')
      setSuccess('App lock enabled. You will be prompted for your PIN on next launch.')
    } else {
      setError(result.error || 'Failed to save PIN. Please try again.')
    }
  }

  const handleCancel = () => {
    setShowSetup(false)
    setPin('')
    setConfirmPin('')
    setError('')
  }

  if (loading) {
    return (
      <div className="card p-6">
        <p className="text-sm text-gray-500">Loading...</p>
      </div>
    )
  }

  return (
    <div className="card p-6">
      <h2 className="text-xl font-bold text-gray-900 mb-1">App Lock</h2>
      <p className="text-sm text-gray-500 mb-5">Require a PIN to open the app. Your PIN is stored locally and never transmitted.</p>

      {success && (
        <div className="mb-4 px-4 py-3 rounded text-sm font-medium bg-green-50 text-green-800 border border-green-200">
          {success}
        </div>
      )}

      {error && (
        <div className="mb-4 px-4 py-3 rounded text-sm font-medium bg-red-50 text-red-800 border border-red-200">
          {error}
        </div>
      )}

      {!showSetup ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-800">
                Status: {enabled ? 'Enabled' : 'Disabled'}
              </p>
              <p className="text-xs text-gray-500">
                {enabled
                  ? 'The app will require your PIN after 5 minutes of inactivity.'
                  : 'No PIN is required to open the app.'}
              </p>
            </div>
            {enabled ? (
              <button onClick={handleDisable} className="btn-secondary text-sm">
                Disable Lock
              </button>
            ) : (
              <button onClick={handleEnable} className="btn-primary text-sm">
                Enable Lock
              </button>
            )}
          </div>

          {enabled && (
            <button
              onClick={handleEnable}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              Change PIN
            </button>
          )}

          {bioAvailable && enabled && (
            <div className="flex items-center justify-between pt-3 border-t border-gray-200">
              <div>
                <p className="text-sm font-medium text-gray-800">Use Biometrics</p>
                <p className="text-xs text-gray-500">Unlock with fingerprint or face recognition.</p>
              </div>
              <button
                onClick={async () => {
                  const next = !bioEnabled
                  await setBiometricEnabled(next)
                  setBioEnabled(next)
                  setSuccess(next ? 'Biometric unlock enabled.' : 'Biometric unlock disabled.')
                }}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${bioEnabled ? 'bg-blue-600' : 'bg-gray-200'}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${bioEnabled ? 'translate-x-6' : 'translate-x-1'}`}
                />
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="form-label">Enter PIN (4–6 digits)</label>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              className="form-input w-full max-w-xs"
              placeholder="••••"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              autoComplete="off"
            />
          </div>
          <div>
            <label className="form-label">Confirm PIN</label>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              className="form-input w-full max-w-xs"
              placeholder="••••"
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              autoComplete="off"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={handleSavePin} className="btn-primary text-sm">
              Save PIN
            </button>
            <button onClick={handleCancel} className="btn-secondary text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default AppLockSettings
