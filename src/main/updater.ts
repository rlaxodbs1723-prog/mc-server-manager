// 자동 업데이트: 깃허브 Releases에 새 버전이 올라오면 뒤에서 받아 두고, 준비되면 화면에 알린다.
// 설치는 사용자가 "업데이트"를 누르거나 앱을 끌 때 한다 (서버가 돌고 있는데 갑자기 다시 시작하지 않는다).
// 설치 파일로 설치한 앱에서만 동작한다 (개발 중에는 하지 않는다)
// 테스트용 (환경 변수, 평소에는 없음):
//   MCSM_UPDATE_URL: 깃허브 대신 이 주소에서 새 버전을 찾는다 (내 컴퓨터에 띄운 업데이트 서버 등)
//   MCSM_UPDATE_AUTOINSTALL=1: 받으면 버튼을 누르지 않아도 바로 설치하고 다시 켠다
import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import fs from 'fs'
import path from 'path'
import type { UpdateState } from '../shared-types'
import { notify } from './notify'

let state: UpdateState = { state: 'none' }
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000 // 6시간마다 다시 확인 (앱을 며칠씩 켜 두는 사람이 많다)

// 무슨 일이 있었는지 남긴다 (업데이트가 안 될 때 원인을 찾으려고). 최근 200줄만
function log(line: string): void {
  try {
    const file = path.join(app.getPath('userData'), 'update-log.txt')
    const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').slice(-199) : []
    fs.writeFileSync(file, [...old, `${new Date().toISOString()} [${app.getVersion()}] ${line}`].join('\n'))
  } catch {
    // 기록 못 해도 업데이트는 계속
  }
}

function set(next: UpdateState): void {
  state = next
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('update', state)
}

export const getUpdateState = (): UpdateState => state

export function initUpdater(): void {
  if (!app.isPackaged) return
  log('앱 시작')
  // 업데이트 라이브러리가 남기는 기록도 같은 파일에 (오류 원인 찾기용)
  autoUpdater.logger = { info: (m: unknown) => log(`· ${m}`), warn: (m: unknown) => log(`경고: ${m}`), error: (m: unknown) => log(`오류: ${m}`), debug: () => undefined }
  const testUrl = process.env.MCSM_UPDATE_URL
  log(testUrl ? `테스트 주소: ${testUrl}` : '깃허브에서 확인')
  if (testUrl) autoUpdater.setFeedURL({ provider: 'generic', url: testUrl })
  autoUpdater.autoDownload = true // 새 버전이 있으면 뒤에서 받아 둔다
  autoUpdater.autoInstallOnAppQuit = true // 받아 둔 채로 앱을 끄면 그때 설치된다
  autoUpdater.on('update-not-available', () => log('새 버전 없음'))
  // 6시간마다 다시 확인하면 이미 받아 둔 버전도 "있음 → 받음"이 다시 온다. 그때 버튼이 깜빡이거나 알림이 또 뜨지 않게 한다
  const alreadyReady = (version: string): boolean => state.state === 'ready' && state.version === version
  autoUpdater.on('update-available', (info) => {
    if (alreadyReady(info.version)) return
    log(`새 버전 ${info.version} 받는 중`)
    set({ state: 'downloading', version: info.version, percent: 0 })
  })
  autoUpdater.on('download-progress', (p) => {
    if (state.state === 'downloading') set({ ...state, percent: Math.round(p.percent) })
  })
  autoUpdater.on('update-downloaded', (info) => {
    if (alreadyReady(info.version)) return
    log(`새 버전 ${info.version} 준비됨`)
    set({ state: 'ready', version: info.version })
    notify('업데이트가 준비됐어요', `새 버전 ${info.version}이 준비됐어요. 앱에서 "업데이트"를 누르거나, 앱을 끄면 설치돼요.`)
    if (process.env.MCSM_UPDATE_AUTOINSTALL === '1') {
      log('테스트: 바로 설치')
      autoUpdater.quitAndInstall(true, true)
    }
  })
  // 인터넷이 안 되는 등: 조용히 넘어가고 다음에 다시 확인한다 (앱 쓰는 데는 지장 없다)
  autoUpdater.on('error', (e) => {
    log(`오류: ${e?.message ?? e}`)
    if (state.state === 'downloading') set({ state: 'none' })
  })
  const check = (): void => {
    log('새 버전 확인')
    Promise.resolve(autoUpdater.checkForUpdates()).catch((e) => log(`확인 실패: ${e?.message ?? e}`))
  }
  setTimeout(check, testUrl ? 2_000 : 10_000) // 켜자마자는 서버 켜기 등으로 바쁘니 조금 뒤에
  setInterval(check, CHECK_EVERY_MS).unref()
}

// 받아 둔 새 버전을 설치하고 다시 켠다 (서버는 부르는 쪽에서 먼저 끈다)
export function installUpdateNow(): void {
  if (state.state !== 'ready') throw new Error('설치할 업데이트가 없어요.')
  log('설치하고 다시 켜기')
  autoUpdater.quitAndInstall(true, true) // 설치 창 없이 설치하고, 끝나면 앱을 다시 켠다
}
