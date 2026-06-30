// App Lock Service — Password-based authentication using Web Crypto API
// Stores hash and salt in Capacitor Preferences (fast & reliable).

import { Preferences } from '@capacitor/preferences'
import { BiometricAuth } from '@aparajita/capacitor-biometric-auth'
import { unlockPassphrase, clearSessionPassphrase } from './securePassphrase'

const LOCK_ENABLED_KEY = 'app_lock_enabled'
const LOCK_HASH_KEY = 'app_lock_password_hash'
const LOCK_SALT_KEY = 'app_lock_password_salt'
const LOCK_LAST_AUTH_KEY = 'app_lock_last_authenticated'
const BIOMETRIC_ENABLED_KEY = 'app_lock_biometric_enabled'
const LOCK_SETUP_COMPLETE_KEY = 'app_lock_setup_complete'
const LOCK_TIMEOUT_MINUTES = 5

let bioAvailableCache: boolean | null = null

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
  ])
}

const PBKDF2_ITERATIONS = 100_000
const KEY_LENGTH = 32

async function getPref(key: string): Promise<string | null> {
  try {
    const result = await Preferences.get({ key })
    return result.value
  } catch (err) {
    console.error(`[lockService] getPref(${key}) error:`, err)
    return null
  }
}

async function setPref(key: string, value: string): Promise<void> {
  await Preferences.set({ key, value })
}

function getCrypto(): Crypto {
  const c = (globalThis as any).crypto || (window as any).crypto
  if (!c || !c.subtle) {
    throw new Error('Web Crypto API not available in this environment')
  }
  return c
}

async function deriveKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const crypto = getCrypto()
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  )
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    KEY_LENGTH * 8
  )
  return new Uint8Array(derived)
}

function bufToHex(buf: Uint8Array): string {
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function hexToBuf(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/**
 * Check if app lock is enabled.
 */
export async function isLockEnabled(): Promise<boolean> {
  const val = await getPref(LOCK_ENABLED_KEY)
  return val === 'true'
}

export interface SetPasswordResult {
  success: boolean
  error?: string
}

/**
 * Set or change the lock password.
 */
export async function setPassword(password: string): Promise<SetPasswordResult> {
  console.log('[lockService] setPassword called, password length:', password.length)
  try {
    const salt = getCrypto().getRandomValues(new Uint8Array(16))
    console.log('[lockService] salt generated, length:', salt.length)
    const hash = await deriveKey(password, salt)
    console.log('[lockService] hash derived, length:', hash.length)
    await Promise.all([
      setPref(LOCK_HASH_KEY, bufToHex(hash)),
      setPref(LOCK_SALT_KEY, bufToHex(salt)),
      setPref(LOCK_ENABLED_KEY, 'true'),
    ])
    console.log('[lockService] preferences saved successfully')
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[lockService] setPassword failed:', err)
    return { success: false, error: message }
  }
}

/**
 * Verify the provided password against the stored hash.
 * If correct, updates the last-authenticated timestamp.
 */
export async function verifyPassword(password: string): Promise<boolean> {
  try {
    const [hashHex, saltHex] = await Promise.all([
      getPref(LOCK_HASH_KEY),
      getPref(LOCK_SALT_KEY),
    ])
    if (!hashHex || !saltHex) return false

    const salt = hexToBuf(saltHex)
    const expectedHash = hexToBuf(hashHex)
    const actualHash = await deriveKey(password, salt)

    if (expectedHash.length !== actualHash.length) return false
    for (let i = 0; i < expectedHash.length; i++) {
      if (expectedHash[i] !== actualHash[i]) return false
    }

    await setPref(LOCK_LAST_AUTH_KEY, Date.now().toString())

    // Try to decrypt the cloud sync passphrase using the PIN
    try {
      const ok = await unlockPassphrase(password)
      if (ok) {
        console.log('[lockService] App unlock decrypted cloud sync passphrase')
      } else {
        console.warn('[lockService] App unlock could not decrypt cloud sync passphrase (wrong PIN or none stored)')
      }
    } catch (e) {
      console.warn('[lockService] unlockPassphrase error during app unlock:', e)
    }

    return true
  } catch {
    return false
  }
}

/**
 * Disable the app lock entirely.
 */
export async function disableLock(): Promise<void> {
  clearSessionPassphrase()
  await Promise.all([
    setPref(LOCK_ENABLED_KEY, 'false'),
    setPref(LOCK_HASH_KEY, ''),
    setPref(LOCK_SALT_KEY, ''),
    setPref(LOCK_LAST_AUTH_KEY, ''),
  ])
}

/**
 * Mark the app as authenticated (e.g., after a successful unlock).
 */
export async function markAuthenticated(): Promise<void> {
  await setPref(LOCK_LAST_AUTH_KEY, Date.now().toString())
}

/**
 * Check if the user needs to re-authenticate based on the timeout.
 * Returns true if the lock screen should be shown.
 */
export async function shouldRequireAuth(): Promise<boolean> {
  const enabled = await isLockEnabled()
  if (!enabled) return false

  const lastAuth = await getPref(LOCK_LAST_AUTH_KEY)
  if (!lastAuth) return true

  const lastAuthTime = parseInt(lastAuth, 10)
  const now = Date.now()
  const elapsedMinutes = (now - lastAuthTime) / (1000 * 60)

  return elapsedMinutes > LOCK_TIMEOUT_MINUTES
}

export async function isBiometricAvailable(): Promise<boolean> {
  if (bioAvailableCache !== null) return bioAvailableCache
  try {
    const result = await withTimeout(BiometricAuth.checkBiometry(), 5000)
    bioAvailableCache = (result as any).biometryType !== 'none'
    return bioAvailableCache
  } catch {
    bioAvailableCache = false
    return false
  }
}

export async function isLockSetupComplete(): Promise<boolean> {
  const val = await getPref(LOCK_SETUP_COMPLETE_KEY)
  return val === 'true'
}

export async function completeLockSetup(): Promise<void> {
  await setPref(LOCK_SETUP_COMPLETE_KEY, 'true')
}

export async function isBiometricEnabled(): Promise<boolean> {
  const val = await getPref(BIOMETRIC_ENABLED_KEY)
  return val === 'true'
}

export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  await setPref(BIOMETRIC_ENABLED_KEY, enabled ? 'true' : 'false')
}

export async function authenticateWithBiometric(): Promise<boolean> {
  try {
    await withTimeout(
      BiometricAuth.authenticate({ reason: 'Unlock Money Weather', allowDeviceCredential: true }),
      10000
    )
    await markAuthenticated()
    return true
  } catch {
    return false
  }
}
