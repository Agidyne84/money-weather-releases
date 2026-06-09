// Secure Passphrase Storage
// The backup passphrase is encrypted with a key derived from the user's PIN.
// It can only be decrypted when the user is actively authenticated.
// The decrypted passphrase lives only in volatile session memory.

import { Preferences } from '@capacitor/preferences'

const ENCRYPTED_PASSPHRASE_KEY = 'cloud_sync_encrypted_passphrase'
const PASSPHRASE_SALT_KEY = 'cloud_sync_passphrase_salt'

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
      salt: salt.buffer as ArrayBuffer,
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

/**
 * Store the backup passphrase, encrypted with the user's PIN.
 * Must be called while the user is authenticated (PIN is known).
 */
export async function storePassphrase(pin: string, passphrase: string): Promise<void> {
  const crypto = getCrypto()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const key = await deriveKeyFromPin(pin, salt)

  const enc = new TextEncoder()
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    enc.encode(passphrase)
  )

  // AES-GCM ciphertext includes authTag at the end in Web Crypto
  const cipherBytes = new Uint8Array(encrypted)
  const ciphertext = cipherBytes.subarray(0, cipherBytes.length - AUTH_TAG_LENGTH)
  const authTag = cipherBytes.subarray(cipherBytes.length - AUTH_TAG_LENGTH)

  // Store: salt + iv + ciphertext + authTag (all hex-encoded)
  const bundle = {
    salt: bufToHex(salt),
    iv: bufToHex(iv),
    ct: bufToHex(ciphertext),
    tag: bufToHex(authTag),
  }

  await Preferences.set({
    key: ENCRYPTED_PASSPHRASE_KEY,
    value: JSON.stringify(bundle),
  })
  await Preferences.set({
    key: PASSPHRASE_SALT_KEY,
    value: bufToHex(salt),
  })

  // Keep in session memory for immediate use
  sessionPassphrase = passphrase
}

/**
 * Decrypt the stored passphrase using the user's PIN.
 * Returns true if decryption succeeded. The passphrase is held in session memory.
 */
export async function unlockPassphrase(pin: string): Promise<boolean> {
  try {
    const bundleJson = (await Preferences.get({ key: ENCRYPTED_PASSPHRASE_KEY })).value
    if (!bundleJson) return false

    const bundle = JSON.parse(bundleJson)
    const salt = hexToBuf(bundle.salt)
    const iv = hexToBuf(bundle.iv)
    const ciphertext = hexToBuf(bundle.ct)
    const authTag = hexToBuf(bundle.tag)

    const key = await deriveKeyFromPin(pin, salt)

    // Reassemble ciphertext + authTag for Web Crypto decrypt
    const cipherWithTag = new Uint8Array(ciphertext.length + AUTH_TAG_LENGTH)
    cipherWithTag.set(ciphertext, 0)
    cipherWithTag.set(authTag, ciphertext.length)

    const decrypted = await getCrypto().subtle.decrypt(
      { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
      key,
      cipherWithTag.buffer as ArrayBuffer
    )

    sessionPassphrase = new TextDecoder().decode(decrypted)
    return true
  } catch (err) {
    console.error('[securePassphrase] unlock failed:', err)
    sessionPassphrase = null
    return false
  }
}

/**
 * Get the decrypted passphrase from session memory.
 * Returns null if the session has not been unlocked.
 */
export function getSessionPassphrase(): string | null {
  return sessionPassphrase
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
  const val = (await Preferences.get({ key: ENCRYPTED_PASSPHRASE_KEY })).value
  return !!val
}

/**
 * Remove the stored passphrase entirely.
 */
export async function deleteStoredPassphrase(): Promise<void> {
  await Preferences.remove({ key: ENCRYPTED_PASSPHRASE_KEY })
  await Preferences.remove({ key: PASSPHRASE_SALT_KEY })
  sessionPassphrase = null
}
