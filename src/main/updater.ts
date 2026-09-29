// 자동 업데이트: 깃허브 Releases에 새 버전이 올라오면 뒤에서 받아 두고, 준비되면 화면에 알린다.
// 설치는 사용자가 "업데이트"를 누르거나 앱을 끌 때 한다 (서버가 돌고 있는데 갑자기 다시 시작하지 않는다).
// 설치 파일로 설치한 앱에서만 동작한다 (개발 중에는 하지 않는다)
import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '../shared-types'

let state: UpdateState = { state: 'none' }
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000 // 6시간마다 다시 확인 (앱을 며칠씩 켜 두는 사람이 많다)

function set(next: UpdateState): void {
  state = next
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('update', state)
}

export const getUpdateState = (): UpdateState => state

export function initUpdater(): void {
  if (!app.isPackaged) return
  autoUpdater.autoDownload = true // 새 버전이 있으면 뒤에서 받아 둔다
  autoUpdater.autoInstallOnAppQuit = true // 받아 둔 채로 앱을 끄면 그때 설치된다
  autoUpdater.on('update-available', (info) => set({ state: 'downloading', version: info.version, percent: 0 }))
  autoUpdater.on('download-progress', (p) => {
    if (state.state === 'downloading') set({ ...state, percent: Math.round(p.percent) })
  })
  autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', version: info.version }))
  // 인터넷이 안 되는 등: 조용히 넘어가고 다음에 다시 확인한다 (앱 쓰는 데는 지장 없다)
  autoUpdater.on('error', () => {
    if (state.state === 'downloading') set({ state: 'none' })
  })
  const check = (): void => void autoUpdater.checkForUpdates().catch(() => undefined)
  setTimeout(check, 10_000) // 켜자마자는 서버 켜기 등으로 바쁘니 조금 뒤에
  setInterval(check, CHECK_EVERY_MS).unref()
}

// 받아 둔 새 버전을 설치하고 다시 켠다 (서버는 부르는 쪽에서 먼저 끈다)
export function installUpdateNow(): void {
  if (state.state !== 'ready') throw new Error('설치할 업데이트가 없어요.')
  autoUpdater.quitAndInstall(true, true) // 설치 창 없이 설치하고, 끝나면 앱을 다시 켠다
}
