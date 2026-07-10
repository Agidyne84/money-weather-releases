// Secure Passphrase Storage
// The backup passphrase is encrypted with a random Session Master Key (SMK).
// The SMK itself is stored in two encrypted forms:
//   1. Encrypted with a key derived from the user's PIN (so PIN unlock can recover it).
//   2. Stored in the OS secure store (Android Keystore / iOS Keychain) so that
//      any successful app unlock -- PIN or biometric -- can recover it.
// The decrypted passphrase lives only in volatile session memory.

import { Preferences } from '@capacitor/preferences'
import { SecureStorage } from '@aparajita/capacitor-secure-storage'

// Legacy PIN-encrypted passphrase (pre-SMK)
const LEGACY_ENCRYPTED_PASSPHRASE_KEY = 'cloud_sync_encrypted_passphrase'
const LEGACY_PASSPHRASE_SALT_KEY = 'cloud_sync_passphrase_salt'

// SMK-based storage
const SMK_PIN_KEY = 'cloud_sync_smk_pin'
const PASSPHRASE_SMK_KEY = 'cloud_sync_passphrase_smk'
const SMK_SECURE_KEY = 'cloud_sync_smk_secure'

const PBKDF2_ITERATIONS = 100_000
const KEY_LENGTH = 32
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

let sessionPassphrase: string | null = null

function getCrypto(): Crypto {
  const c = (globalThis as any).crypto || (window as any).crypto
  if (!c || !c.subtle) {
    throw new Error('Web Crypto API not available in this environment')
  }
  return c
}

async function deriveKeyFromPin(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const crypto = getCrypto()
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(pin),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: KEY_LENGTH * 8 },
    false,
    ['encrypt', 'decrypt']
  )
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

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

async function generateSMK(): Promise<CryptoKey> {
  const crypto = getCrypto()
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: KEY_LENGTH * 8 },
    true,
    ['encrypt', 'decrypt']
  )
}

async function exportSMK(key: CryptoKey): Promise<ArrayBuffer> {
  return getCrypto().subtle.exportKey('raw', key)
}

async function importSMK(raw: ArrayBuffer): Promise<CryptoKey> {
  return getCrypto().subtle.importKey(
    'raw',
    raw,
    { name: 'AES-GCM', length: KEY_LENGTH * 8 },
    false,
    ['encrypt', 'decrypt']
  )
}

interface AesGcmBundle {
  iv: string
  ct: string
  tag: string
}

async function aesGcmEncrypt(plaintext: string, key: CryptoKey): Promise<AesGcmBundle> {
  const crypto = getCrypto()
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    new TextEncoder().encode(plaintext)
  )
  const cipherBytes = new Uint8Array(encrypted)
  const ciphertext = cipherBytes.subarray(0, cipherBytes.length - AUTH_TAG_LENGTH)
  const authTag = cipherBytes.subarray(cipherBytes.length - AUTH_TAG_LENGTH)
  return {
    iv: bufToHex(iv),
    ct: bufToHex(ciphertext),
    tag: bufToHex(authTag),
  }
}

async function aesGcmDecrypt(bundle: AesGcmBundle, key: CryptoKey): Promise<string> {
  const iv = hexToBuf(bundle.iv)
  const ciphertext = hexToBuf(bundle.ct)
  const authTag = hexToBuf(bundle.tag)
  const cipherWithTag = new Uint8Array(ciphertext.length + AUTH_TAG_LENGTH)
  cipherWithTag.set(ciphertext, 0)
  cipherWithTag.set(authTag, ciphertext.length)
  const decrypted = await getCrypto().subtle.decrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    cipherWithTag.buffer.slice(cipherWithTag.byteOffset, cipherWithTag.byteOffset + cipherWithTag.byteLength) as ArrayBuffer
  )
  return new TextDecoder().decode(decrypted)
}

interface PinWrappedBundle {
  salt: string
  iv: string
  ct: string
  tag: string
}

async function wrapSMKWithPin(smk: ArrayBuffer, pin: string): Promise<PinWrappedBundle> {
  const crypto = getCrypto()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await deriveKeyFromPin(pin, salt)
  const bundle = await aesGcmEncrypt(arrayBufferToBase64(smk), key)
  return { salt: bufToHex(salt), ...bundle }
}

async function unwrapSMKWithPin(bundle: PinWrappedBundle, pin: string): Promise<ArrayBuffer | null> {
  try {
    const salt = hexToBuf(bundle.salt)
    const key = await deriveKeyFromPin(pin, salt)
    const base64Smk = await aesGcmDecrypt(bundle, key)
    return base64ToArrayBuffer(base64Smk)
  } catch (err) {
    console.error('[securePassphrase] unwrapSMKWithPin failed:', err)
    return null
  }
}

async function storeSMKSecurely(smk: ArrayBuffer): Promise<void> {
  try {
    const b64 = arrayBufferToBase64(smk)
    await SecureStorage.set(SMK_SECURE_KEY, b64)
    console.log('[securePassphrase] SMK stored in secure storage, length:', b64.length)
  } catch (err) {
    console.warn('[securePassphrase] Could not store SMK in secure storage:', err)
  }
}

async function getSMKSecurely(): Promise<ArrayBuffer | null> {
  try {
    const value = await SecureStorage.get(SMK_SECURE_KEY)
    console.log('[securePassphrase] SecureStorage.get result type:', typeof value, 'length:', typeof value === 'string' ? value.length : 0)
    if (value && typeof value === 'string') {
      return base64ToArrayBuffer(value)
    }
  } catch (err) {
    console.warn('[securePassphrase] Could not retrieve SMK from secure storage:', err)
  }
  return null
}

async function removeSMKSecurely(): Promise<void> {
  try {
    await SecureStorage.remove(SMK_SECURE_KEY)
  } catch {
    // ignore
  }
}

async function decryptPassphraseWithSMK(smkRaw: ArrayBuffer): Promise<boolean> {
  try {
    const bundleJson = (await Preferences.get({ key: PASSPHRASE_SMK_KEY })).value
    console.log('[securePassphrase] decryptPassphraseWithSMK bundle present:', !!bundleJson)
    if (!bundleJson) return false
    const bundle: AesGcmBundle = JSON.parse(bundleJson)
    const smk = await importSMK(smkRaw)
    sessionPassphrase = await aesGcmDecrypt(bundle, smk)
    console.log('[securePassphrase] decryptPassphraseWithSMK succeeded, passphrase length:', sessionPassphrase?.length ?? 0)
    return true
  } catch (err) {
    console.error('[securePassphrase] decryptPassphraseWithSMK failed:', err)
    sessionPassphrase = null
    return false
  }
}

async function migrateLegacyStorage(pin: string): Promise<boolean> {
  try {
    const legacyJson = (await Preferences.get({ key: LEGACY_ENCRYPTED_PASSPHRASE_KEY })).value
    if (!legacyJson) return false
    const legacy = JSON.parse(legacyJson)
    const salt = hexToBuf(legacy.salt)
    const iv = hexToBuf(legacy.iv)
    const ciphertext = hexToBuf(legacy.ct)
    const authTag = hexToBuf(legacy.tag)
    const key = await deriveKeyFromPin(pin, salt)
    const cipherWithTag = new Uint8Array(ciphertext.length + AUTH_TAG_LENGTH)
    cipherWithTag.set(ciphertext, 0)
    cipherWithTag.set(authTag, ciphertext.length)
    const decrypted = await getCrypto().subtle.decrypt(
      { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
      key,
      cipherWithTag.buffer.slice(cipherWithTag.byteOffset, cipherWithTag.byteOffset + cipherWithTag.byteLength) as ArrayBuffer
    )
    const passphrase = new TextDecoder().decode(decrypted)
    await storePassphrase(pin, passphrase)
    // Clean up legacy storage
    await Preferences.remove({ key: LEGACY_ENCRYPTED_PASSPHRASE_KEY })
    await Preferences.remove({ key: LEGACY_PASSPHRASE_SALT_KEY })
    return true
  } catch (err) {
    console.error('[securePassphrase] migrateLegacyStorage failed:', err)
    return false
  }
}

/**
 * Store the backup passphrase using the SMK model.
 * The passphrase is encrypted with a random SMK. The SMK is encrypted with the
 * user's PIN and also stored in the OS secure store.
 */
export async function storePassphrase(pin: string, passphrase: string): Promise<void> {
  const smk = await generateSMK()
  const smkRaw = await exportSMK(smk)

  // Encrypt the passphrase with the SMK
  const passphraseBundle = await aesGcmEncrypt(passphrase, smk)
  await Preferences.set({
    key: PASSPHRASE_SMK_KEY,
    value: JSON.stringify(passphraseBundle),
  })

  // Encrypt the SMK with the PIN-derived key
  const smkPinBundle = await wrapSMKWithPin(smkRaw, pin)
  await Preferences.set({
    key: SMK_PIN_KEY,
    value: JSON.stringify(smkPinBundle),
  })

  // Also keep the SMK in the OS secure store so biometric unlock can use it
  await storeSMKSecurely(smkRaw)

  // Keep the passphrase in session memory for immediate use
  sessionPassphrase = passphrase
  console.log('[securePassphrase] Passphrase stored with SMK (PIN-wrapped + secure store)')
}

/**
 * Store the backup passphrase using the SMK model without PIN wrapping.
 * The SMK is only stored in the OS secure store. This is used when the user
 * has unlocked with biometric and enters the backup password directly, or when
 * setting up sync on a device where the PIN is not available.
 */
export async function storePassphraseSecurely(passphrase: string): Promise<void> {
  const smk = await generateSMK()
  const smkRaw = await exportSMK(smk)

  const passphraseBundle = await aesGcmEncrypt(passphrase, smk)
  await Preferences.set({
    key: PASSPHRASE_SMK_KEY,
    value: JSON.stringify(passphraseBundle),
  })

  // Remove any PIN-wrapped SMK because the SMK has changed and the old
  // PIN-wrapped copy would no longer decrypt the passphrase.
  await Preferences.remove({ key: SMK_PIN_KEY })

  await storeSMKSecurely(smkRaw)

  sessionPassphrase = passphrase
  console.log('[securePassphrase] Passphrase stored securely (secure store only)')
}

/**
 * Decrypt the stored passphrase using the user's PIN.
 * Returns true if decryption succeeded. The passphrase is held in session memory.
 * Automatically migrates legacy PIN-encrypted storage if present.
 */
export async function unlockPassphrase(pin: string): Promise<boolean> {
  try {
    // Check for legacy storage and migrate
    const hasLegacy = !!(await Preferences.get({ key: LEGACY_ENCRYPTED_PASSPHRASE_KEY })).value
    if (hasLegacy) {
      const migrated = await migrateLegacyStorage(pin)
      if (migrated) return true
    }

    const bundleJson = (await Preferences.get({ key: SMK_PIN_KEY })).value
    if (!bundleJson) return false

    const bundle: PinWrappedBundle = JSON.parse(bundleJson)
    const smkRaw = await unwrapSMKWithPin(bundle, pin)
    if (!smkRaw) return false

    const ok = await decryptPassphraseWithSMK(smkRaw)
    if (ok) {
      // Ensure the SMK is also in secure storage for biometric unlock path
      await storeSMKSecurely(smkRaw)
      console.log('[securePassphrase] PIN unlock recovered passphrase')
    } else {
      console.warn('[securePassphrase] PIN unlock: SMK decrypted but passphrase decryption failed')
    }
    return ok
  } catch (err) {
    console.error('[securePassphrase] unlockPassphrase failed:', err)
    sessionPassphrase = null
    return false
  }
}

/**
 * Try to recover the passphrase from the OS secure store without a PIN.
 * This is used after biometric unlock on mobile.
 * Returns true if the passphrase was recovered and is now in session memory.
 */
export async function unlockPassphraseFromSecureStorage(): Promise<boolean> {
  const smkRaw = await getSMKSecurely()
  console.log('[securePassphrase] unlockPassphraseFromSecureStorage got SMK:', !!smkRaw)
  if (!smkRaw) return false
  const ok = await decryptPassphraseWithSMK(smkRaw)
  console.log('[securePassphrase] unlockPassphraseFromSecureStorage decrypted passphrase:', ok)
  return ok
}

/**
 * Get the decrypted passphrase from session memory.
 * Returns null if the session has not been unlocked.
 */
export function getSessionPassphrase(): string | null {
  return sessionPassphrase
}

/**
 * Set the session passphrase directly (e.g. after the user enters the backup
 * password manually when the session passphrase is not available).
 */
export function setSessionPassphrase(passphrase: string): void {
  sessionPassphrase = passphrase
}

/**
 * Clear the session passphrase from memory (called on app lock / background).
 */
export function clearSessionPassphrase(): void {
  sessionPassphrase = null
}

/**
 * Check whether a passphrase has been stored.
 */
export async function hasStoredPassphrase(): Promise<boolean> {
  const legacy = (await Preferences.get({ key: LEGACY_ENCRYPTED_PASSPHRASE_KEY })).value
  const smk = (await Preferences.get({ key: PASSPHRASE_SMK_KEY })).value
  return !!legacy || !!smk
}

/**
 * Remove the stored passphrase entirely.
 */
export async function deleteStoredPassphrase(): Promise<void> {
  await Preferences.remove({ key: LEGACY_ENCRYPTED_PASSPHRASE_KEY })
  await Preferences.remove({ key: LEGACY_PASSPHRASE_SALT_KEY })
  await Preferences.remove({ key: PASSPHRASE_SMK_KEY })
  await Preferences.remove({ key: SMK_PIN_KEY })
  await removeSMKSecurely()
  sessionPassphrase = null
}
