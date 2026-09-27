// 앱 전체 설정 (서버마다가 아닌 것): userData/app-settings.json
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import type { AppSettings } from '../shared-types'

const DEFAULTS: AppSettings = {
  launchAtLogin: false,
  startHidden: true,
  closeBehavior: 'tray-if-running',
  notifications: true
}

const file = (): string => path.join(app.getPath('userData'), 'app-settings.json')
let cache: AppSettings | null = null

export function getAppSettings(): AppSettings {
  if (cache) return cache
  try {
    cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) }
  } catch {
    cache = { ...DEFAULTS }
  }
  return cache!
}

export function setAppSettings(patch: Partial<AppSettings>): AppSettings {
  const cur = getAppSettings()
  const next: AppSettings = {
    launchAtLogin: patch.launchAtLogin != null ? !!patch.launchAtLogin : cur.launchAtLogin,
    startHidden: patch.startHidden != null ? !!patch.startHidden : cur.startHidden,
    closeBehavior: patch.closeBehavior === 'always-tray' || patch.closeBehavior === 'tray-if-running' ? patch.closeBehavior : cur.closeBehavior,
    notifications: patch.notifications != null ? !!patch.notifications : cur.notifications
  }
  fs.writeFileSync(file(), JSON.stringify(next, null, 2))
  cache = next
  applyLoginItem(next)
  return next
}

// 윈도우를 켤 때 앱도 켜기. 설치한 앱에서만 된다 (개발 중에는 등록해도 앱이 아닌 electron이 켜진다)
export function applyLoginItem(s: AppSettings = getAppSettings()): void {
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: s.launchAtLogin, args: s.startHidden ? ['--hidden'] : [] })
}

// 윈도우를 켤 때 자동으로 켜졌고 "숨긴 채로 시작"이면 창 없이 트레이로 시작한다
export const startedHidden = (): boolean => process.argv.includes('--hidden')
