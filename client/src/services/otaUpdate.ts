// Mobile OTA (Over-The-Air) Update Service
// Checks remote version JSON and triggers APK download + install on Android

import { Capacitor } from '@capacitor/core'
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
  canRequestPackageInstalls(): Promise<{ canInstall: boolean }>
  openInstallSettings(): Promise<void>
}

const OtaUpdate = registerPlugin<OtaUpdatePlugin>('OtaUpdate')

const VERSION_URL =
  'https://raw.githubusercontent.com/Agidyne84/money-weather-releases/main/mobile-version.json'

const SKIP_VERSION_KEY = 'ota_skip_version'

export interface MobileVersionInfo {
  version: string
  versionCode: number
  downloadUrl: string
  force: boolean
  releaseNotes: string
}

export async function getMobileVersionInfo(): Promise<MobileVersionInfo | null> {
  try {
    const response = await fetch(VERSION_URL, { cache: 'no-cache' })
    if (!response.ok) return null
    return (await response.json()) as MobileVersionInfo
  } catch {
    return null
  }
}

export async function getCurrentAppVersion(): Promise<{ version: string; build: string }> {
  const info = await App.getInfo()
  return { version: info.version, build: info.build }
}

export async function checkForMobileUpdate(): Promise<{
  available: boolean
  info?: MobileVersionInfo
  currentVersion?: string
}> {
  if (!Capacitor.isNativePlatform()) return { available: false }

  const remote = await getMobileVersionInfo()
  if (!remote) return { available: false }

  const current = await getCurrentAppVersion()
  const currentVersionCode = parseInt(current.build, 10) || 0

  // Check if user previously skipped this version
  const { value: skipVersion } = await Preferences.get({ key: SKIP_VERSION_KEY })
  if (!remote.force && skipVersion === remote.version) {
    return { available: false }
  }

  // versionCode is the authoritative check for Android
  if (remote.versionCode > currentVersionCode) {
    return { available: true, info: remote, currentVersion: current.version }
  }

  return { available: false }
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

export async function getDownloadStatus(): Promise<{
  status: number
  statusText: string
  bytesDownloaded: number
  totalBytes: number
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
