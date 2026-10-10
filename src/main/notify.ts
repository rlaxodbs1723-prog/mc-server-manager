// 윈도우 알림: 앱 창을 보고 있지 않을 때(트레이에 숨겼거나 다른 창을 쓰는 중)만 띄운다. always면 보고 있어도 띄운다.
// 누르면 앱 창을 연다.
import { app, BrowserWindow, Notification } from 'electron'
import { join } from 'path'
import { getAppSettings } from './appsettings'
import { tr } from './i18n'

const iconPath = (): string => (app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(__dirname, '../../resources/icon.png'))

export function notify(title: string, body: string, always = false): void {
  if (!Notification.isSupported() || !getAppSettings().notifications) return
  const win = BrowserWindow.getAllWindows()[0]
  if (!always && win && win.isVisible() && win.isFocused()) return // 보고 있으면 앱 안의 알림으로 충분하다
  const n = new Notification({ title: tr(title), body: tr(body), icon: iconPath() })
  n.on('click', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })
  n.show()
}
