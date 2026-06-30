import React, { useState, useEffect, useCallback, useRef } from 'react'
import { verifyPassword, isBiometricEnabled, isBiometricAvailable, authenticateWithBiometric } from '../services/lockService'

interface AppLockProps {
  onUnlock: () => void
  onUnlockWithPin?: (pin: string) => void
  onCancel?: () => void
  disableBiometric?: boolean
}

const AppLock: React.FC<AppLockProps> = ({ onUnlock, onUnlockWithPin, onCancel, disableBiometric = false }) => {
  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)
  const [biometricReady, setBiometricReady] = useState(false)

  const pinRef = useRef(pin)
  pinRef.current = pin
  const onUnlockRef = useRef(onUnlock)
  onUnlockRef.current = onUnlock
  const onUnlockWithPinRef = useRef(onUnlockWithPin)
  onUnlockWithPinRef.current = onUnlockWithPin
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel
  const biometricAttemptedRef = useRef(false)

  // Desktop keyboard support
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault()
        const nextPin = pinRef.current + e.key
        if (nextPin.length > 6) return
        setError(false)
        setPin(nextPin)
        if (nextPin.length >= 4) {
          verifyPassword(nextPin).then((ok) => {
            if (ok) {
              setPin('')
              if (onUnlockWithPinRef.current) {
                onUnlockWithPinRef.current(nextPin)
              } else {
                onUnlockRef.current?.()
              }
            } else if (nextPin.length >= 6) {
              setError(true)
              setPin('')
            }
          })
        }
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        setError(false)
        setPin((p) => p.slice(0, -1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const current = pinRef.current
        if (current.length < 4) return
        verifyPassword(current).then((ok) => {
          if (ok) {
            setPin('')
            if (onUnlockWithPinRef.current) {
              onUnlockWithPinRef.current(current)
            } else {
              onUnlockRef.current?.()
            }
          } else {
            setError(true)
            setPin('')
          }
        })
      } else if (e.key === 'Escape') {
        e.preventDefault()
        setError(false)
        setPin('')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleBiometric = useCallback(async () => {
    const ok = await authenticateWithBiometric()
    if (ok) {
      onUnlock()
    } else {
      setError(true)
    }
  }, [onUnlock])

  // Lazy-check biometric after mount so PIN keypad shows immediately
  useEffect(() => {
    let cancelled = false
    const checkBio = async () => {
      const bioEnabled = await isBiometricEnabled()
      const bioAvailable = await isBiometricAvailable()
      const ready = bioEnabled && bioAvailable
      if (!cancelled) setBiometricReady(ready)
      // Auto-trigger biometric prompt once per mount (unless caller requires PIN)
      if (ready && !cancelled && !biometricAttemptedRef.current && !disableBiometric) {
        biometricAttemptedRef.current = true
        setTimeout(() => handleBiometric(), 400)
      }
    }
    checkBio()
    return () => { cancelled = true }
  }, [handleBiometric, disableBiometric])

  const handleDigit = useCallback((digit: string) => {
    if (pin.length >= 6) return
    setError(false)
    const nextPin = pin + digit
    setPin(nextPin)

    if (nextPin.length >= 4) {
      // Auto-submit at 4+ digits
      verifyPassword(nextPin).then((ok) => {
        if (ok) {
          setPin('')
          if (onUnlockWithPin) {
            onUnlockWithPin(nextPin)
          } else {
            onUnlock?.()
          }
        } else if (nextPin.length >= 6) {
          setError(true)
          setPin('')
        }
      })
    }
  }, [pin, onUnlock, onUnlockWithPin])

  const handleBackspace = useCallback(() => {
    setError(false)
    setPin((p) => p.slice(0, -1))
  }, [])

  const handleClear = useCallback(() => {
    setError(false)
    setPin('')
  }, [])

  const handleSubmit = useCallback(() => {
    if (pin.length < 4) return
    verifyPassword(pin).then((ok) => {
      if (ok) {
        setPin('')
        if (onUnlockWithPin) {
          onUnlockWithPin(pin)
        } else {
          onUnlock?.()
        }
      } else {
        setError(true)
        setPin('')
      }
    })
  }, [pin, onUnlock, onUnlockWithPin])

  return (
    <div className="fixed inset-0 z-[100] bg-white flex flex-col items-center justify-center px-6">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Money Weather</h1>
        <p className="text-sm text-gray-500">Enter your PIN to unlock</p>
      </div>

      {/* PIN dots */}
      <div className="flex gap-3 mb-8">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className={`w-4 h-4 rounded-full border-2 transition-colors ${
              i < pin.length
                ? error
                  ? 'bg-red-500 border-red-500'
                  : 'bg-blue-600 border-blue-600'
                : 'border-gray-300'
            }`}
          />
        ))}
      </div>

      {error && (
        <div className="mb-4 text-sm text-red-600 font-medium">Incorrect PIN</div>
      )}

      {/* Keypad */}
      <div className="grid grid-cols-3 gap-4 w-full max-w-xs">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
          <button
            key={digit}
            onClick={() => handleDigit(digit)}
            className="h-14 rounded-xl bg-gray-100 text-xl font-semibold text-gray-900 active:bg-gray-200 flex items-center justify-center"
          >
            {digit}
          </button>
        ))}
        <button
          onClick={handleClear}
          className="h-14 rounded-xl bg-gray-100 text-sm font-medium text-gray-600 active:bg-gray-200 flex items-center justify-center"
        >
          Clear
        </button>
        <button
          onClick={() => handleDigit('0')}
          className="h-14 rounded-xl bg-gray-100 text-xl font-semibold text-gray-900 active:bg-gray-200 flex items-center justify-center"
        >
          0
        </button>
        <button
          onClick={handleBackspace}
          className="h-14 rounded-xl bg-gray-100 text-gray-600 active:bg-gray-200 flex items-center justify-center"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
            <line x1="18" x2="12" y1="9" y2="15" />
            <line x1="12" x2="18" y1="9" y2="15" />
          </svg>
        </button>
      </div>

      <button
        onClick={handleSubmit}
        disabled={pin.length < 4}
        className="mt-6 w-full max-w-xs py-3 rounded-xl bg-blue-600 text-white font-medium disabled:opacity-40 active:bg-blue-700"
      >
        Unlock
      </button>

      {onCancel && (
        <button
          onClick={() => { setPin(''); setError(false); onCancelRef.current?.() }}
          className="mt-3 w-full max-w-xs py-3 rounded-xl bg-gray-100 text-gray-700 font-medium active:bg-gray-200"
        >
          Cancel
        </button>
      )}

      {biometricReady && !disableBiometric && (
        <button
          onClick={handleBiometric}
          className="mt-3 w-full max-w-xs py-3 rounded-xl bg-gray-100 text-gray-700 font-medium active:bg-gray-200 flex items-center justify-center gap-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a10 10 0 0 1 10 10" />
            <path d="M12 2a10 10 0 0 0-10 10" />
            <path d="M12 8a4 4 0 0 1 4 4" />
            <path d="M12 8a4 4 0 0 0-4 4" />
            <line x1="12" y1="16" x2="12" y2="16" />
          </svg>
          Use Biometrics
        </button>
      )}
    </div>
  )
}

export default AppLock
