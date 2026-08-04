// Mobile OTA (Over-The-Air) Update Service
// Checks remote version JSON and triggers APK download + install on Android

import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { App } from '@capacitor/app'
import { Preferences } from '@capacitor/preferences'
import { registerPlugin } from '@capacitor/core'

export interface OtaUpdatePlugin {
  downloadAndInstall(options: { url: string; fileName?: string }): Promise<{ downloadId: number }>
  checkDownloadStatus(): Promise<{
    status: number
    statusText: string
    bytesDownloaded: number
    totalBytes: number
    reason?: number
  }>
  installUpdate(): Promise<void>
  canRequestPackageInstalls(): Promise<{ canInstall: boolean }>
  openInstallSettings(): Promise<void>
  addListener(eventName: 'otaInstallReady' | 'otaDownloadFailed' | 'otaInstallFailed', listener: (info: any) => void): Promise<{ remove: () => void }>
  removeAllListeners(): Promise<void>
}

const OtaUpdate = registerPlugin<OtaUpdatePlugin>('OtaUpdate')

export function addOtaListener(
  event: 'otaInstallReady' | 'otaDownloadFailed' | 'otaInstallFailed',
  callback: (info: any) => void
): Promise<{ remove: () => void }> {
  return OtaUpdate.addListener(event, callback)
}

const API_VERSION_URL =
  'https://api.github.com/repos/Agidyne84/money-weather-releases/contents/mobile-version.json?ref=master'
const RAW_VERSION_URL =
  'https://raw.githubusercontent.com/Agidyne84/money-weather-releases/master/mobile-version.json'

const SKIP_VERSION_KEY = 'ota_skip_version'
const FETCH_TIMEOUT_MS = 15000

function decodeGithubApiContent(data: any): MobileVersionInfo | null {
  if (!data || typeof data !== 'object' || typeof data.content !== 'string') return null
  try {
    // GitHub base64-encodes the file; strip wrapping whitespace and the BOM that
    // Notepad/VS Code sometimes writes, then parse the JSON envelope.
    const cleaned = data.content.replace(/[\s\r\n]+/g, '')
    const jsonStr = atob(cleaned).replace(/^\uFEFF/, '')
    return JSON.parse(jsonStr) as MobileVersionInfo
  } catch (err) {
    console.warn('[OTA] Could not decode GitHub API content:', err)
    return null
  }
}

export interface MobileVersionInfo {
  version: string
  versionCode: number
  downloadUrl: string
  force: boolean
  releaseNotes: string
}

async function fetchWithXHR(url: string): Promise<{ ok: boolean; status: number; data: MobileVersionInfo | null }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('GET', url, true)
    xhr.setRequestHeader('Accept', 'application/json')
    xhr.setRequestHeader('Cache-Control', 'no-cache')
    xhr.timeout = FETCH_TIMEOUT_MS
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const parsed = parseVersionPayload(JSON.parse(xhr.responseText))
          resolve({ ok: !!parsed, status: xhr.status, data: parsed })
        } catch {
          resolve({ ok: false, status: xhr.status, data: null })
        }
      } else {
        resolve({ ok: false, status: xhr.status, data: null })
      }
    }
    xhr.onerror = () => reject(new Error('XHR network error'))
    xhr.ontimeout = () => reject(new Error('XHR timeout'))
    xhr.send()
  })
}

function parseVersionPayload(data: unknown): MobileVersionInfo | null {
  if (!data) return null
  if (typeof data === 'object') {
    const api = decodeGithubApiContent(data)
    if (api) return api
    if (
      'version' in data &&
      'versionCode' in data &&
      'downloadUrl' in data &&
      'force' in data &&
      'releaseNotes' in data
    ) {
      return data as MobileVersionInfo
    }
    return null
  }
  if (typeof data === 'string') {
    try {
      return parseVersionPayload(JSON.parse(data))
    } catch {
      return null
    }
  }
  return null
}

async function fetchVersionJson(url: string): Promise<{ ok: boolean; status: number; data: MobileVersionInfo | null }> {
  if (Capacitor.isNativePlatform()) {
    // Primary: CapacitorHttp (bypasses WebView CORS/fetch issues)
    try {
      console.log('[OTA] CapacitorHttp.get:', url)
      const response = await CapacitorHttp.get({
        url,
        headers: {
          'User-Agent': 'MoneyWeather-App/1.1.62',
          'Accept': 'application/json',
          'Cache-Control': 'no-cache',
        },
      })
      console.log('[OTA] CapacitorHttp response:', response.status, typeof response.data)
      if (response.status < 200 || response.status >= 300) {
        return { ok: false, status: response.status, data: null }
      }
      const parsed = parseVersionPayload(response.data)
      if (!parsed) {
        console.error('[OTA] Could not parse CapacitorHttp response:', response.data)
        return { ok: false, status: response.status, data: null }
      }
      console.log('[OTA] Parsed:', parsed.version, parsed.versionCode)
      return { ok: true, status: response.status, data: parsed }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('[OTA] CapacitorHttp failed, falling back to fetch:', msg)
    }

    // Fallback 1: standard fetch (may also be intercepted by CapacitorHttp)
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        cache: 'no-store',
      })
      console.log('[OTA] Fallback fetch status:', response.status)
      if (!response.ok) {
        return { ok: false, status: response.status, data: null }
      }
      const parsed = parseVersionPayload(await response.json())
      if (!parsed) {
        return { ok: false, status: response.status, data: null }
      }
      return { ok: true, status: response.status, data: parsed }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('[OTA] Fallback fetch failed:', msg)
    }

    // Fallback 2: XMLHttpRequest (alternative native transport)
    try {
      console.log('[OTA] Trying XMLHttpRequest...')
      const result = await fetchWithXHR(url)
      console.log('[OTA] XHR result:', result.status, result.ok)
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[OTA] XMLHttpRequest also failed:', msg)
      throw new Error(msg)
    }
  } else {
    // Desktop / Web: standard fetch with timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const response = await fetch(url, { signal: controller.signal })
      clearTimeout(timeoutId)
      if (!response.ok) {
        return { ok: false, status: response.status, data: null }
      }
      const parsed = parseVersionPayload(await response.json())
      return { ok: !!parsed, status: response.status, data: parsed }
    } catch (err) {
      clearTimeout(timeoutId)
      throw err
    }
  }
}

export async function getMobileVersionInfo(): Promise<{
  info: MobileVersionInfo | null
  error?: string
}> {
  // Primary: GitHub Contents API (JSON, not served from raw CDN, so no stale cache)
  const apiUrl = API_VERSION_URL
  // Fallback: raw URL with cache-buster to bypass GitHub raw CDN caching
  const rawUrlWithCache = `${RAW_VERSION_URL}?t=${Date.now()}`
  const rawUrlPlain = RAW_VERSION_URL

  const attempts = [
    { url: apiUrl, source: 'github-api' },
    { url: rawUrlWithCache, source: 'raw-cache-buster' },
    { url: rawUrlPlain, source: 'raw-plain' },
  ]

  for (let i = 0; i < attempts.length; i++) {
    const { url, source } = attempts[i]
    try {
      const result = await fetchVersionJson(url)
      if (!result.ok) {
        console.warn(`[OTA] ${source} returned ${result.status}`)
        continue
      }
      if (!result.data) {
        console.warn(`[OTA] ${source} returned no data`)
        continue
      }
      console.log(`[OTA] Version info fetched from ${source}:`, result.data.version)
      return { info: result.data }
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError'
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[OTA] ${source} fetch failed (${url}):`, msg)

      if (i === attempts.length - 1) {
        if (isAbort) {
          return { info: null, error: 'Request timed out. Please check your internet connection.' }
        }
        return { info: null, error: 'Unable to reach update server. Please check your internet connection.' }
      }

      await new Promise((r) => setTimeout(r, (i + 1) * 1000))
    }
  }

  return { info: null, error: 'Unknown error checking for updates.' }
}

export async function getCurrentAppVersion(): Promise<{ version: string; build: string }> {
  const info = await App.getInfo()
  return { version: info.version, build: info.build }
}

export async function checkForMobileUpdate(): Promise<{
  available: boolean
  info?: MobileVersionInfo
  currentVersion?: string
  currentVersionCode?: number
  error?: string
}> {
  if (!Capacitor.isNativePlatform()) return { available: false }

  const remote = await getMobileVersionInfo()
  if (remote.error) {
    return { available: false, error: remote.error }
  }
  if (!remote.info) {
    return { available: false, error: 'Could not read version info from server.' }
  }

  const current = await getCurrentAppVersion()
  const currentVersionCode = parseInt(current.build, 10) || 0

  // Check if user previously skipped this version
  const { value: skipVersion } = await Preferences.get({ key: SKIP_VERSION_KEY })
  if (!remote.info.force && skipVersion === remote.info.version) {
    return { available: false, currentVersion: current.version, currentVersionCode }
  }

  // versionCode is the authoritative check for Android
  if (remote.info.versionCode > currentVersionCode) {
    return {
      available: true,
      info: remote.info,
      currentVersion: current.version,
      currentVersionCode,
    }
  }

  return {
    available: false,
    currentVersion: current.version,
    currentVersionCode,
  }
}

export async function skipVersion(version: string): Promise<void> {
  await Preferences.set({ key: SKIP_VERSION_KEY, value: version })
}

export async function canInstallPackages(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  try {
    const { canInstall } = await OtaUpdate.canRequestPackageInstalls()
    return canInstall
  } catch {
    return false
  }
}

export async function openInstallPermissionSettings(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  await OtaUpdate.openInstallSettings()
}

export async function downloadAndInstallUpdate(url: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  await OtaUpdate.downloadAndInstall({ url, fileName: 'money-weather-update.apk' })
}

export async function installUpdate(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  await OtaUpdate.installUpdate()
}

export async function getDownloadStatus(): Promise<{
  status: number
  statusText: string
  bytesDownloaded: number
  totalBytes: number
  reason?: number
}> {
  if (!Capacitor.isNativePlatform()) {
    return { status: -1, statusText: 'not-native', bytesDownloaded: 0, totalBytes: 0 }
  }
  try {
    return await OtaUpdate.checkDownloadStatus()
  } catch {
    return { status: -1, statusText: 'error', bytesDownloaded: 0, totalBytes: 0 }
  }
}
