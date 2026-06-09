import React, { useState, useEffect } from 'react'
import { setPassword, completeLockSetup, markAuthenticated, isBiometricAvailable, setBiometricEnabled } from '../services/lockService'

interface FirstTimeLockSetupProps {
  onComplete: () => void
}

const FirstTimeLockSetup: React.FC<FirstTimeLockSetupProps> = ({ onComplete }) => {
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [error, setError] = useState('')
  const [bioAvailable, setBioAvailable] = useState(false)
  const [useBio, setUseBio] = useState(false)

  useEffect(() => {
    isBiometricAvailable().then((avail) => setBioAvailable(avail))
  }, [])

  const handleSave = async () => {
    setError('')

    if (pin.length < 4) {
      setError('PIN must be at least 4 digits.')
      return
    }
    if (pin !== confirmPin) {
      setError('PINs do not match.')
      return
    }

    const result = await setPassword(pin)
    if (result.success) {
      await completeLockSetup()
      await markAuthenticated()
      if (useBio) await setBiometricEnabled(true)
      onComplete()
    } else {
      setError(result.error || 'Failed to save PIN.')
    }
  }

  return (
    <div className="fixed inset-0 z-[100] bg-white flex flex-col items-center justify-center px-6">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Secure Your App</h1>
        <p className="text-sm text-gray-500">Create a PIN to protect your data.</p>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded text-sm font-medium bg-red-50 text-red-800 border border-red-200 w-full max-w-xs">
          {error}
        </div>
      )}

      <div className="space-y-4 w-full max-w-xs">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Enter PIN (4–6 digits)</label>
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-lg tracking-widest"
            placeholder="••••"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            autoComplete="off"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Confirm PIN</label>
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-lg tracking-widest"
            placeholder="••••"
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            autoComplete="off"
          />
        </div>

        {bioAvailable && (
          <div className="flex items-center justify-between pt-2">
            <div>
              <p className="text-sm font-medium text-gray-800">Use Biometrics</p>
              <p className="text-xs text-gray-500">Unlock with fingerprint or face recognition.</p>
            </div>
            <button
              onClick={() => setUseBio((v) => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${useBio ? 'bg-blue-600' : 'bg-gray-200'}`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${useBio ? 'translate-x-6' : 'translate-x-1'}`}
              />
            </button>
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={pin.length < 4 || pin !== confirmPin}
          className="w-full py-3 rounded-xl bg-blue-600 text-white font-medium disabled:opacity-40 active:bg-blue-700"
        >
          Save PIN
        </button>
      </div>
    </div>
  )
}

export default FirstTimeLockSetup
