// OneDrive Provider (Microsoft Graph)
// Direct HTTPS transport for the cloud backup file — bypasses Android SAF, whose
// OneDrive DocumentsProvider caches writes locally and never reliably uploads them.
// Auth: OAuth2 authorization code + PKCE against the "consumers" tenant (personal
// Microsoft accounts). The refresh token lives in the OS secure store so sync can
// run without re-prompting. The access token lives only in session memory.

import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { Preferences } from '@capacitor/preferences'
import { SecureStorage } from '@aparajita/capacitor-secure-storage'

const CLIENT_ID = 'ad5d849b-e20c-4d22-a862-2d34b36412b4'
const AUTHORITY = 'https://login.microsoftonline.com/consumers/oauth2/v2.0'
const REDIRECT_URI = 'moneyweather://oauth'
const SCOPES = 'Files.ReadWrite offline_access'
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'

const REFRESH_TOKEN_KEY = 'onedrive_refresh_token'

const ONEDRIVE_PREFIX = 'onedrive:'

export function isOneDrivePath(path: string): boolean {
  return path.startsWith(ONEDRIVE_PREFIX)
}

export function encodeOneDrivePath(oneDrivePath: string): string {
  return ONEDRIVE_PREFIX + oneDrivePath
}

export function decodeOneDrivePath(filePath: string): string {
  return filePath.slice(ONEDRIVE_PREFIX.length)
}

export interface OneDriveFileInfo {
  exists: boolean
  modifiedAt: string | null
  size: number
}

interface TokenSet {
  accessToken: string
  expiresAt: number // epoch ms
  refreshToken: string
}

let tokenSet: TokenSet | null = null
let refreshInFlight: Promise<string> | null = null

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(64)))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64UrlEncode(new Uint8Array(digest)) }
}

function generateState(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)))
}

async function saveRefreshToken(token: string): Promise<void> {
  try {
    await SecureStorage.set(REFRESH_TOKEN_KEY, token)
  } catch (err) {
    console.warn('[OneDrive] Could not store refresh token in secure storage:', err)
  }
  // Preferences fallback mirrors the SMK storage pattern — the OS secure store
  // is not always readable on the next launch, and losing the refresh token
  // forces the user through the browser sign-in again.
  try {
    await Preferences.set({ key: REFRESH_TOKEN_KEY, value: token })
  } catch (err) {
    console.warn('[OneDrive] Could not store refresh token in Preferences:', err)
  }
}

async function loadRefreshToken(): Promise<string | null> {
  try {
    const value = await SecureStorage.get(REFRESH_TOKEN_KEY)
    if (value && typeof value === 'string') return value
  } catch (err) {
    console.warn('[OneDrive] SecureStorage refresh token read failed:', err)
  }
  try {
    const { value } = await Preferences.get({ key: REFRESH_TOKEN_KEY })
    if (value) return value
  } catch (err) {
    console.warn('[OneDrive] Preferences refresh token read failed:', err)
  }
  return null
}

export async function isOneDriveConnected(): Promise<boolean> {
  if (tokenSet) return true
  return (await loadRefreshToken()) !== null
}

export async function disconnectOneDrive(): Promise<void> {
  tokenSet = null
  try {
    await SecureStorage.remove(REFRESH_TOKEN_KEY)
  } catch {
    // ignore
  }
  try {
    await Preferences.remove({ key: REFRESH_TOKEN_KEY })
  } catch {
    // ignore
  }
}

async function tokenRequest(body: Record<string, string>): Promise<TokenSet> {
  const response = await fetch(`${AUTHORITY}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) {
    const desc = json.error_description || json.error || `HTTP ${response.status}`
    throw new Error(`OneDrive sign-in failed: ${desc}`)
  }
  return {
    accessToken: json.access_token,
    expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000,
    refreshToken: json.refresh_token,
  }
}

async function refreshAccessToken(): Promise<string> {
  if (refreshInFlight) return refreshInFlight
  refreshInFlight = (async () => {
    const stored = await loadRefreshToken()
    if (!stored) {
      throw new Error('OneDrive is not connected. Connect it in Settings > Cloud Sync.')
    }
    const tokens = await tokenRequest({
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: stored,
      scope: SCOPES,
    })
    tokenSet = tokens
    if (tokens.refreshToken && tokens.refreshToken !== stored) {
      await saveRefreshToken(tokens.refreshToken)
    }
    return tokens.accessToken
  })()
  try {
    return await refreshInFlight
  } finally {
    refreshInFlight = null
  }
}

async function getAccessToken(): Promise<string> {
  if (tokenSet && tokenSet.expiresAt > Date.now() + 60_000) {
    return tokenSet.accessToken
  }
  return refreshAccessToken()
}

async function graphFetch(path: string, init: RequestInit = {}, retryOnAuth = true): Promise<Response> {
  const token = await getAccessToken()
  const headers = new Headers(init.headers || {})
  headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(`${GRAPH_BASE}${path}`, { ...init, headers })
  if (response.status === 401 && retryOnAuth) {
    tokenSet = null
    return graphFetch(path, init, false)
  }
  return response
}

function driveItemUrl(oneDrivePath: string): string {
  const cleaned = oneDrivePath.replace(/^\/+/, '')
  const encoded = cleaned.split('/').map(encodeURIComponent).join('/')
  return `/me/drive/root:/${encoded}`
}

async function graphError(response: Response): Promise<Error> {
  let message = `HTTP ${response.status}`
  let code = ''
  try {
    const json = await response.json()
    if (json.error?.message) message = json.error.message
    if (json.error?.code) code = json.error.code
  } catch {
    // keep default
  }
  if (code === 'quotaLimitReached' || /quota/i.test(message)) {
    return new Error('OneDrive storage is full — free up space in OneDrive, then try again')
  }
  if (response.status === 401 || code === 'unauthenticated' || code === 'InvalidAuthenticationToken') {
    return new Error('OneDrive sign-in expired — reconnect via Connect OneDrive')
  }
  return new Error(`OneDrive error: ${message}`)
}

export interface OneDriveItem {
  name: string
  isFolder: boolean
  size: number
  modifiedAt: string | null
}

/** List children of a folder. Pass '' for the drive root. */
export async function oneDriveListFolder(folderPath: string): Promise<OneDriveItem[]> {
  const select = '$select=name,size,lastModifiedDateTime,folder,file'
  const url = folderPath
    ? `${driveItemUrl(folderPath)}:/children?${select}&$top=500`
    : `/me/drive/root/children?${select}&$top=500`
  const response = await graphFetch(url)
  if (!response.ok) throw await graphError(response)
  const json = await response.json()
  return (json.value || []).map((item: any) => ({
    name: item.name,
    isFolder: !!item.folder,
    size: typeof item.size === 'number' ? item.size : -1,
    modifiedAt: item.lastModifiedDateTime || null,
  }))
}

/** Drive quota for the signed-in account (bytes). Used to surface "drive full" states. */
export async function oneDriveQuota(): Promise<{ used: number; total: number; remaining: number } | null> {
  const response = await graphFetch('/me/drive?$select=quota')
  if (!response.ok) return null
  const json = await response.json()
  if (!json.quota) return null
  return {
    used: json.quota.used ?? 0,
    total: json.quota.total ?? 0,
    remaining: json.quota.remaining ?? 0,
  }
}

export async function oneDriveFileInfo(filePath: string): Promise<OneDriveFileInfo> {
  const response = await graphFetch(`${driveItemUrl(decodeOneDrivePath(filePath))}?$select=id,name,size,lastModifiedDateTime,eTag`)
  if (response.status === 404) {
    return { exists: false, modifiedAt: null, size: -1 }
  }
  if (!response.ok) throw await graphError(response)
  const item = await response.json()
  return {
    exists: true,
    modifiedAt: item.lastModifiedDateTime || null,
    size: typeof item.size === 'number' ? item.size : -1,
  }
}

export async function oneDriveDownload(filePath: string): Promise<ArrayBuffer> {
  const response = await graphFetch(`${driveItemUrl(decodeOneDrivePath(filePath))}:/content`)
  if (response.status === 404) {
    throw new Error('OneDrive backup file not found')
  }
  if (!response.ok) throw await graphError(response)
  return await response.arrayBuffer()
}

export interface OneDriveUploadResult {
  modifiedAt: string
  size: number
  eTag: string | null
}

export async function oneDriveUpload(filePath: string, data: Uint8Array): Promise<OneDriveUploadResult> {
  const response = await graphFetch(`${driveItemUrl(decodeOneDrivePath(filePath))}:/content`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
  })
  if (!response.ok) throw await graphError(response)
  const item = await response.json()
  return {
    modifiedAt: item.lastModifiedDateTime || new Date().toISOString(),
    size: typeof item.size === 'number' ? item.size : data.length,
    eTag: item.eTag || null,
  }
}

/**
 * Full sign-in flow: opens the system browser (Custom Tab) to the Microsoft
 * consent page, waits for the moneyweather://oauth redirect (delivered via the
 * appUrlOpen event), and exchanges the authorization code for tokens.
 */
export async function signInToOneDrive(): Promise<void> {
  const { verifier, challenge } = await generatePkce()
  const state = generateState()

  const authUrl = new URL(`${AUTHORITY}/authorize`)
  authUrl.searchParams.set('client_id', CLIENT_ID)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
  authUrl.searchParams.set('response_mode', 'query')
  authUrl.searchParams.set('scope', SCOPES)
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('code_challenge', challenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')
  // Always show the account chooser so the user can switch Microsoft accounts.
  authUrl.searchParams.set('prompt', 'select_account')

  const code = await new Promise<string>((resolve, reject) => {
    let settled = false
    let urlHandle: { remove: () => void } | null = null
    let finishedHandle: { remove: () => void } | null = null

    const cleanup = () => {
      urlHandle?.remove()
      finishedHandle?.remove()
      Browser.close().catch(() => {})
    }

    App.addListener('appUrlOpen', ({ url }) => {
      if (!url.startsWith(REDIRECT_URI)) return
      if (settled) return
      try {
        const parsed = new URL(url.replace('moneyweather://', 'https://dummy/'))
        const params = parsed.searchParams
        if (params.get('state') !== state) return
        const error = params.get('error')
        if (error) {
          settled = true
          cleanup()
          reject(new Error(`OneDrive sign-in failed: ${params.get('error_description') || error}`))
          return
        }
        const authCode = params.get('code')
        if (authCode) {
          settled = true
          cleanup()
          resolve(authCode)
        }
      } catch {
        // not our redirect — ignore
      }
    }).then((h) => { urlHandle = h })

    Browser.addListener('browserFinished', () => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error('Sign-in cancelled'))
    }).then((h) => { finishedHandle = h })

    Browser.open({ url: authUrl.toString() }).catch((err) => {
      if (settled) return
      settled = true
      cleanup()
      reject(err instanceof Error ? err : new Error(String(err)))
    })
  })

  const tokens = await tokenRequest({
    client_id: CLIENT_ID,
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
    scope: SCOPES,
  })
  tokenSet = tokens
  if (tokens.refreshToken) {
    await saveRefreshToken(tokens.refreshToken)
  }
}
