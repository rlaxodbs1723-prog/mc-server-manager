import './datapath' // 맨 먼저: 데이터 폴더 위치 고정
import { getUpdateState, initUpdater, installUpdateNow } from './updater'
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, Notification, screen, shell, Tray } from 'electron'
import fs from 'fs'
import { join, resolve, sep } from 'path'
import { EULA_URL, friendlyError, SOFTWARE_INFO, type CreateServerOptions, type BackupSettings, type ManageAction, type ModpackBrowseOptions, type SearchSite, type MapSort, type Progress, type SaveSettings, type ServerEvent, type Software } from '../shared-types'
import { CreateEta } from './eta'
import { listGameRules, setGameRule } from './gamerules'
import { getHardcore, setHardcore } from './hardcore'
import { getGameRuleLang } from './lang'
import { checkReachable, closeAllPorts, getInvite, initInvite } from './invite'
import { getLoaderVersions } from './loaders'
import * as mods from './mods'
import { CancelledError, cancelTask, runCancellable, throwIfCancelled } from './cancel'
import { notify } from './notify'
import { browseModpacks, cleanModpackTemp, gameVersions, modpackVersions, prepareFromCurseForge, prepareFromModrinth, prepareFromUpload } from './modpack'
import * as datapacks from './datapacks'
import { getStats, stopAllSamplers } from './stats'
import { flushPlayerLog, getPlayerHistory } from './playerlog'
import { importWorld, listSaves, openDroppedWorld, pickWorldZip, prepareMap } from './worldimport'
import { curseForgeKeySource, hasCurseForgeKey, mapFiles, removeCurseForgeKey, searchMaps, setCurseForgeKey } from './curseforge'
import { applyLoginItem, getAppSettings, setAppSettings, startedHidden } from './appsettings'
import { createEntry, listDir, readConfigFile, renameEntry, revealEntry, trashEntries, writeConfigFile } from './configfiles'
import { cleanWorldTemp } from './worldzip'
import { getServerIcon, pickServerIcon, removeServerIcon, setServerIconFrom } from './icon'
import { disableDatapack } from './crash'
import * as whitelist from './whitelist'
import { getManageInfo, runAction } from './manage'
import { getVersions } from './mojang'
import { acceptEula, anyRunning, getLog, getState, onServerEvent, sendCommand, stopAll, stopServer } from './runner'
import { changeVersion, deleteServer, cancelAutoRestarts, setServerOrder, duplicateServer, renameServer, createServer, getSettings, readServerInfo, listServers, cleanupUnfinished, resetWorld, saveSettings, serversRoot, startServerAt } from './servers'
import { assertFree, busyJobs, setOnJobDone, withLock } from './lock'
import { getSiteStatus } from './sitestatus'
import { runPreflight } from './preflight'
import { autoStartServers, setStarter } from './automation'
import { createBackup, deleteBackup, getBackupSettings, listBackups, openBackupFolder, restoreBackup, setBackupSettings } from './backup'
import { tr } from './i18n'

let quitting = false // 서버를 끄고 닫기로 확정됨
let creating = 0 // 지금 만들고 있는 서버 수 (만드는 중에 닫으면 확인한다)
let mainWin: BrowserWindow | null = null

// 서버 만들기·백업·버전 바꾸기처럼 도중에 끊기면 안 되는 작업이 있는지
const working = (): boolean => creating > 0 || busyJobs().length > 0

// 켜진 서버 없이 작업 때문에만 트레이로 숨었으면, 작업이 끝났을 때 앱을 끝낸다 (사용자는 닫은 줄 안다)
let quitWhenIdle = false
function quitIfIdle(): void {
  if (!quitWhenIdle || working() || anyRunning() || mainWin?.isVisible()) return
  quitting = true
  app.quit()
}
setOnJobDone(() => setTimeout(quitIfIdle, 0)) // 작업 기록이 지워진 다음에 확인한다

// ---------- 창 크기 기억 ----------
interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  maximized: boolean
}
const windowStateFile = (): string => join(app.getPath('userData'), 'window.json')

function readWindowState(): Partial<WindowState> {
  try {
    return JSON.parse(fs.readFileSync(windowStateFile(), 'utf8'))
  } catch {
    return {}
  }
}

function saveWindowState(win: BrowserWindow): void {
  const b = win.getNormalBounds() // 최대화돼 있어도 원래 크기를 저장한다
  const state: WindowState = { width: b.width, height: b.height, x: b.x, y: b.y, maximized: win.isMaximized() }
  try {
    fs.writeFileSync(windowStateFile(), JSON.stringify(state))
  } catch {
    // 저장 못 해도 다음에 기본 크기로 열릴 뿐이다
  }
}

// 저장된 위치가 지금 연결된 화면 안에 있을 때만 쓴다 (모니터를 뺀 경우 화면 밖에 열리지 않게)
function onSomeDisplay(x: number, y: number): boolean {
  return screen.getAllDisplays().some((d) => x >= d.workArea.x - 50 && y >= d.workArea.y - 50 && x < d.workArea.x + d.workArea.width - 100 && y < d.workArea.y + d.workArea.height - 100)
}

// ---------- 트레이 ----------
// 서버가 켜져 있을 때 창을 닫으면 끄지 않고 작업 표시줄 오른쪽(트레이)으로 숨긴다
let tray: Tray | null = null
let trayHinted = false
// 앱 아이콘 (build-tools/icon.svg에서 만든다: node build-tools/make-icon.mjs)
const resourcePath = (name: string): string => (app.isPackaged ? join(process.resourcesPath, name) : join(__dirname, '../../resources', name))

function showWindow(): void {
  if (!mainWin) return
  quitWhenIdle = false // 다시 열었으면 작업이 끝나도 닫지 않는다
  if (mainWin.isMinimized()) mainWin.restore()
  mainWin.show()
  mainWin.focus()
}

// 트레이의 "종료": 켜진 서버가 있으면 창을 띄워 확인을 받는다
function requestQuit(): void {
  if (!anyRunning() && !working()) {
    quitting = true
    app.quit()
    return
  }
  showWindow()
  mainWin?.webContents.send('confirmQuit', { creating, jobs: busyJobs() })
}

function ensureTray(): void {
  if (tray) return
  tray = new Tray(nativeImage.createFromPath(resourcePath('icon.png')).resize({ width: 16, height: 16, quality: 'best' }))
  tray.setToolTip('MC CraftDeck')
  tray.on('click', showWindow)
  tray.on('double-click', showWindow)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: tr('열기'), click: showWindow },
      { type: 'separator' },
      { label: tr('종료'), click: requestQuit }
    ])
  )
}

function createWindow(): void {
  // 윈도우 기본 테두리·메뉴 없이 앱이 직접 타이틀바를 그린다
  // 이보다 작으면 모드 탭 등이 세로로 늘어나 보기 불편하다. 화면이 더 작은 컴퓨터에서는 화면 크기에 맞춘다
  const minWidth = Math.min(1366, screen.getPrimaryDisplay().workAreaSize.width)
  const minHeight = Math.min(846, screen.getPrimaryDisplay().workAreaSize.height)
  const saved = readWindowState() // 지난번 창 크기·위치
  const at = saved.x != null && saved.y != null && onSomeDisplay(saved.x, saved.y) ? { x: saved.x, y: saved.y } : {}
  const win = new BrowserWindow({
    width: Math.max(minWidth, saved.width ?? 0),
    height: Math.max(minHeight, saved.height ?? 0),
    ...at,
    minWidth,
    minHeight,
    frame: false,
    show: false,
    backgroundColor: '#101013', // 화면이 뜨기 전 번쩍이는 흰 화면 방지
    title: 'MC CraftDeck',
    icon: resourcePath('icon.ico'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true // preload는 contextBridge/ipcRenderer만 쓰므로 샌드박스에서 돌 수 있다
    }
  })
  win.once('ready-to-show', () => {
    if (saved.maximized) win.maximize()
    // 윈도우를 켤 때 자동으로 켜졌고 "숨긴 채로 시작"이면 창을 띄우지 않고 트레이에만 둔다
    if (startedHidden()) ensureTray()
    else win.show()
  })
  // 크기·위치를 바꾸면 잠시 뒤 저장한다
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  const saveSoon = (): void => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => saveWindowState(win), 500)
  }
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize'] as const) win.on(ev as 'resize', saveSoon)
  win.webContents.on('preload-error', (_e, file, err) => console.error('[preload 오류]', file, err))

  const sendMaximized = (): void => win.webContents.send('windowMaximized', win.isMaximized())
  win.on('maximize', sendMaximized)
  win.on('unmaximize', sendMaximized)

  mainWin = win
  // 켜진 서버(또는 만드는 중인 서버)가 있으면 닫지 않고 트레이로 숨긴다. 끄려면 트레이 메뉴의 "종료"
  win.on('close', (event) => {
    saveWindowState(win)
    if (quitting || (!anyRunning() && !working() && getAppSettings().closeBehavior !== 'always-tray')) return
    event.preventDefault()
    const alwaysTray = getAppSettings().closeBehavior === 'always-tray'
    quitWhenIdle = !anyRunning() && !alwaysTray // 작업만 남아서 숨었으면 끝난 뒤 알아서 종료 ("늘 트레이로"면 그대로 둔다)
    win.hide()
    ensureTray()
    if (!trayHinted && Notification.isSupported() && getAppSettings().notifications) {
      trayHinted = true
      new Notification({
        title: tr(anyRunning() ? '서버는 계속 돌아가고 있어요' : working() && !alwaysTray ? '작업이 끝날 때까지 뒤에서 계속해요' : '앱이 트레이에서 계속 켜져 있어요'),
        body: tr('작업 표시줄 오른쪽 아이콘을 누르면 다시 열 수 있어요.'),
        icon: resourcePath('icon.png')
      })
        .on('click', showWindow) // 알림을 누르면 창을 다시 연다 (다른 알림과 똑같이)
        .show()
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// 화면이 넘긴 경로가 서버 폴더 안인지 확인한다
function checkServerFolder(folderPath: string): string {
  const target = resolve(folderPath)
  if (!target.startsWith(resolve(serversRoot()) + sep)) throw new Error('서버 폴더가 아니에요.')
  return target
}

ipcMain.handle('getVersions', (_event, includeSnapshots: boolean) => getVersions(includeSnapshots))

ipcMain.handle('getLoaderVersions', (_event, software: Software, mcVersion: string) => {
  if (software === 'vanilla' || !SOFTWARE_INFO[software]) return []
  return getLoaderVersions(software, String(mcVersion))
})

ipcMain.handle('createServer', async (event, options: CreateServerOptions, taskId: string) => {
  // 여러 서버를 동시에 만들 수 있어서, 진행 상황에 작업 번호를 붙여 보낸다
  // 전체 진행률과 남은 시간을 붙여서 보낸다. 1초에 여러 번 오는 다운로드 보고는 0.2초에 한 번만 보낸다
  const eta = new CreateEta(options.software)
  let lastSent = 0
  let lastMessage = ''
  const report = (raw: Progress): void => {
    const progress = eta.update(raw)
    const now = Date.now()
    if (progress.message === lastMessage && now - lastSent < 200) return
    lastSent = now
    lastMessage = progress.message
    event.sender.send('createProgress', { taskId: String(taskId), progress })
  }
  // 1초마다 남은 시간을 다시 계산해 보낸다 (설치 프로그램처럼 한동안 보고가 없는 단계용)
  let latest: Progress = { message: '준비하고 있어요' }
  const tick = setInterval(() => report(latest), 1000)
  const track = (p: Progress): void => {
    throwIfCancelled() // 취소했으면 다음 단계로 넘어가지 않는다
    latest = p
    report(p)
  }
  creating++
  try {
    const info = await runCancellable(String(taskId), () => createServer(options, track))
    // Fabric API 같은 기본 모드를 미리 깐다. 실패해도 서버는 만들어졌으니 넘어간다 (나중에 모드 탭에서 설치 가능)
    if ((options.software === 'fabric' || options.software === 'quilt') && !options.modpackId) {
      track({ message: '기본 모드를 설치하고 있어요', phase: 'base' })
      await mods.installBaseMods(info.folderPath).catch(() => null)
    }
    eta.finish()
    notify('서버를 만들었어요', `${options.name} 서버가 준비됐어요. 눌러서 열어 보세요.`)
    return info
  } catch (e) {
    if (!(e instanceof CancelledError)) notify('서버를 만들지 못했어요', `${options.name}: ${friendlyError(e instanceof Error ? e.message.split('\n')[0] : String(e))}`)
    throw e
  } finally {
    clearInterval(tick)
    creating--
    setTimeout(quitIfIdle, 0)
  }
})

ipcMain.handle('changeVersion', async (event, folderPath: string, mcVersion: string, loaderVersion?: string) => {
  const target = checkServerFolder(folderPath)
  return withLock(target, '버전 바꾸기', async () => {
    // 여러 서버를 동시에 바꿀 수 있어서 어느 서버의 진행 상황인지 폴더를 붙여 보낸다
    const info = await changeVersion(target, String(mcVersion), loaderVersion ? String(loaderVersion) : undefined, (progress) =>
      event.sender.send('versionProgress', { ...progress, folderPath: target })
    )
    // Fabric·Quilt는 기본 모드(Fabric API 등)도 새 버전에 맞춘다. 실패해도 버전은 바뀌었으니 넘어간다
    if (info.software === 'fabric' || info.software === 'quilt') await mods.refreshBaseMods(info.folderPath).catch(() => null)
    return info
  })
})

const siteOf = (s: unknown): SearchSite => (s === 'modrinth' || s === 'curseforge' ? s : 'all')
ipcMain.handle('browseModpacks', (_event, o: ModpackBrowseOptions) =>
  browseModpacks({ query: String(o?.query ?? ''), sort: o?.sort ?? 'relevance', gameVersion: o?.gameVersion ? String(o.gameVersion) : null, loaders: Array.isArray(o?.loaders) ? o.loaders.map(String) : [], offset: Number(o?.offset) || 0, site: siteOf(o?.site) })
)
ipcMain.handle('gameVersions', () => gameVersions())
ipcMain.handle('modpackVersions', (_event, projectId: string, source: string) => modpackVersions(String(projectId), source === 'curseforge' ? 'curseforge' : 'modrinth'))
ipcMain.handle('prepareCurseForgeModpack', (_event, modId: string, fileId: string) => prepareFromCurseForge(Number(modId), Number(fileId)))
ipcMain.handle('prepareModpack', (_event, versionId: string) => prepareFromModrinth(String(versionId)))
ipcMain.handle('prepareModpackFile', (_event, file: string) => prepareFromUpload(String(file)))
ipcMain.handle('pickModpackFile', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const opts = { title: tr('모드팩 파일을 골라 주세요'), properties: ['openFile' as const], filters: [{ name: tr('모드팩'), extensions: ['mrpack', 'zip'] }] }
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  return res.canceled || !res.filePaths[0] ? null : prepareFromUpload(res.filePaths[0])
})
ipcMain.handle('cancelCreate', (_event, taskId: string) => cancelTask(String(taskId)))
ipcMain.handle('listServers', () => listServers())
ipcMain.handle('setServerOrder', (_event, folderPaths: string[]) => setServerOrder(Array.isArray(folderPaths) ? folderPaths.map((p) => checkServerFolder(String(p))) : []))

ipcMain.handle('openFolder', async (_event, folderPath: string) => {
  await shell.openPath(checkServerFolder(folderPath))
})

// 확인은 화면에서 받는다. 폴더는 휴지통으로 보내서 되살릴 수 있게 한다
ipcMain.handle('renameServer', (_event, folderPath: string, name: string) => renameServer(checkServerFolder(folderPath), String(name)))
ipcMain.handle('duplicateServer', (_event, folderPath: string, name: string) => {
  const target = checkServerFolder(folderPath)
  return withLock(target, '서버 복제', () => duplicateServer(target, String(name)))
})
ipcMain.handle('deleteServer', async (_event, folderPath: string) => {
  const target = checkServerFolder(folderPath)
  if (getState(target) !== 'stopped') throw new Error('서버를 끈 다음에 삭제할 수 있어요.')
  await withLock(target, '서버 삭제', () => deleteServer(target))
})

ipcMain.handle('openEulaPage', () => shell.openExternal(EULA_URL))
ipcMain.handle('acceptEula', (_event, folderPath: string) => acceptEula(checkServerFolder(folderPath)))

ipcMain.handle('startServer', (event, folderPath: string) => {
  const target = checkServerFolder(folderPath)
  // 여러 서버를 동시에 켤 수 있어서, 어느 서버의 진행 상황인지 폴더를 붙여 보낸다
  return startWithChecks(target, (p) => event.sender.send('progress', { ...p, folderPath }))
})

// 사용자가 켤 때와 자동으로 켤 때(앱 켤 때, 매일 다시 켜기) 똑같이 켠다
async function startWithChecks(target: string, report: (p: Progress) => void): Promise<void> {
  assertFree(target) // 모드 업데이트·버전 바꾸기 중이면 아래에서 모드 파일을 건드리기 전에 멈춘다
  // 기본 모드가 생기기 전에 만든 Fabric/Quilt 서버에 한 번 깔아 준다
  report({ message: '기본 모드를 확인하고 있어요' })
  await mods.installBaseMods(target, true).catch(() => null)
  // 버전을 바꾼 뒤에 기본 모드가 예전 버전용으로 남아 있으면 새 버전에 맞춘다 (한 번만)
  const info = readServerInfo(target)
  if ((info.software === 'fabric' || info.software === 'quilt') && info.baseModsFor !== info.mcVersion) await mods.refreshBaseMods(target).catch(() => null)
  await startServerAt(target, report)
}
setStarter((f) => startWithChecks(f, () => undefined))
ipcMain.handle('stopServer', (_event, folderPath: string, force?: boolean) =>
  stopServer(checkServerFolder(folderPath), !!force)
)
ipcMain.handle('sendCommand', (_event, folderPath: string, command: string) =>
  sendCommand(checkServerFolder(folderPath), String(command))
)
ipcMain.handle('getLog', (_event, folderPath: string) => getLog(checkServerFolder(folderPath)))

ipcMain.handle('getInvite', (_event, folderPath: string) => getInvite(checkServerFolder(folderPath)))
ipcMain.handle('checkReachable', (_event, folderPath: string) => checkReachable(checkServerFolder(folderPath)))
ipcMain.handle('getStats', (_event, folderPath: string) => getStats(checkServerFolder(folderPath)))
ipcMain.handle('getManageInfo', (_event, folderPath: string) => getManageInfo(checkServerFolder(folderPath)))
ipcMain.handle('getPlayerHistory', (_event, folderPath: string) => getPlayerHistory(checkServerFolder(folderPath)))
ipcMain.handle('manage', (_event, folderPath: string, action: ManageAction) =>
  runAction(checkServerFolder(folderPath), action)
)
ipcMain.handle('listGameRules', (_event, folderPath: string) => listGameRules(checkServerFolder(folderPath)))
ipcMain.handle('setGameRule', (_event, folderPath: string, name: string, value: string) =>
  setGameRule(checkServerFolder(folderPath), String(name), String(value))
)
ipcMain.handle('getGameRuleLang', (_event, folderPath: string) =>
  getGameRuleLang(readServerInfo(checkServerFolder(folderPath)).mcVersion).catch(() => ({})) // 못 받으면 앱의 이름을 쓴다
)
ipcMain.handle('getSettings', (_event, folderPath: string) => getSettings(checkServerFolder(folderPath)))
ipcMain.handle('saveSettings', (_event, folderPath: string, settings: SaveSettings) =>
  saveSettings(checkServerFolder(folderPath), settings ?? {})
)
ipcMain.handle('getHardcore', (_event, folderPath: string) => getHardcore(checkServerFolder(folderPath)))
ipcMain.handle('setHardcore', (_event, folderPath: string, on: boolean) => setHardcore(checkServerFolder(folderPath), !!on))
ipcMain.handle('resetWorld', (_event, folderPath: string) => {
  const target = checkServerFolder(folderPath)
  return withLock(target, '월드 리셋', () => resetWorld(target))
})
ipcMain.handle('listBackups', (_event, folderPath: string) => listBackups(checkServerFolder(folderPath)))
ipcMain.handle('createBackup', (_event, folderPath: string) => {
  const target = checkServerFolder(folderPath)
  return withLock(target, '백업', () => createBackup(target))
})
ipcMain.handle('restoreBackup', (_event, folderPath: string, id: string) => {
  const target = checkServerFolder(folderPath)
  return withLock(target, '백업 되돌리기', () => restoreBackup(target, String(id)))
})
ipcMain.handle('deleteBackup', (_event, folderPath: string, id: string) => {
  const target = checkServerFolder(folderPath)
  return withLock(target, '백업 삭제', () => deleteBackup(target, String(id))) // 되돌리는 중인 백업을 지우지 않게
})
ipcMain.handle('getServerIcon', (_event, folderPath: string) => getServerIcon(checkServerFolder(folderPath)))
ipcMain.handle('pickServerIcon', (event, folderPath: string) => pickServerIcon(checkServerFolder(folderPath), BrowserWindow.fromWebContents(event.sender)))
ipcMain.handle('setServerIconFile', (_event, folderPath: string, file: string) => setServerIconFrom(checkServerFolder(folderPath), String(file)))
ipcMain.handle('removeServerIcon', (_event, folderPath: string) => removeServerIcon(checkServerFolder(folderPath)))
ipcMain.handle('getBackupSettings', (_event, folderPath: string) => getBackupSettings(checkServerFolder(folderPath)))
ipcMain.handle('setBackupSettings', (_event, folderPath: string, s: BackupSettings) => setBackupSettings(checkServerFolder(folderPath), s ?? { everyMin: 0, keep: 10 }))
ipcMain.handle('openBackupFolder', (_event, folderPath: string) => openBackupFolder(checkServerFolder(folderPath)))
ipcMain.handle('listSaves', () => listSaves())
ipcMain.handle('openDroppedWorld', (_event, p: string) => openDroppedWorld(String(p)))
ipcMain.handle('pickWorldZip', (event) => pickWorldZip(BrowserWindow.fromWebContents(event.sender)))
ipcMain.handle('openExternal', (_event, url: string) => {
  // 화면이 아무 주소나 열지 못하게 CurseForge 주소만 연다
  if (/^https:\/\/([a-z0-9-]+\.)*curseforge\.com\//i.test(String(url))) return shell.openExternal(String(url))
})
ipcMain.handle('openCrashReport', (_event, folderPath: string, reportPath: string) => {
  const dir = join(checkServerFolder(folderPath), 'crash-reports')
  const file = resolve(String(reportPath))
  if (file.startsWith(dir + sep) && file.endsWith('.txt')) return shell.openPath(file).then(() => undefined)
})
ipcMain.handle('installModById', (_event, folderPath: string, modId: string) => mods.installById(checkServerFolder(folderPath), String(modId)))
ipcMain.handle('disableDatapack', (_event, folderPath: string, name: string) => disableDatapack(checkServerFolder(folderPath), String(name)))
ipcMain.handle('hasCurseForgeKey', () => hasCurseForgeKey())
ipcMain.handle('removeCurseForgeKey', () => removeCurseForgeKey())
ipcMain.handle('getAppInfo', () => ({
  settings: getAppSettings(),
  version: app.getVersion(),
  packaged: app.isPackaged,
  curseForgeKey: curseForgeKeySource(),
  dataFolder: app.getPath('userData')
}))
ipcMain.handle('setAppSettings', (_event, patch) => {
  const before = getAppSettings().language
  const next = setAppSettings(patch ?? {})
  if (next.language !== before && tray) {
    // 트레이 메뉴 글자를 새 언어로
    tray.destroy()
    tray = null
    ensureTray()
  }
  return next
})
ipcMain.handle('openDataFolder', () => shell.openPath(app.getPath('userData')).then(() => undefined))
ipcMain.handle('listDir', (_event, folderPath: string, rel: string) => listDir(checkServerFolder(folderPath), String(rel ?? '')))
ipcMain.handle('renameEntry', (_event, folderPath: string, rel: string, newName: string) => renameEntry(checkServerFolder(folderPath), String(rel), String(newName)))
ipcMain.handle('trashEntries', (_event, folderPath: string, rels: string[]) => trashEntries(checkServerFolder(folderPath), Array.isArray(rels) ? rels.map(String) : []))
ipcMain.handle('createEntry', (_event, folderPath: string, rel: string, name: string, kind: string) =>
  createEntry(checkServerFolder(folderPath), String(rel ?? ''), String(name), kind === 'dir' ? 'dir' : 'file')
)
ipcMain.handle('revealEntry', (_event, folderPath: string, rel: string) => revealEntry(checkServerFolder(folderPath), String(rel ?? '')))
ipcMain.handle('readConfigFile', (_event, folderPath: string, rel: string) => readConfigFile(checkServerFolder(folderPath), String(rel)))
ipcMain.handle('writeConfigFile', (_event, folderPath: string, rel: string, text: string, expectedModified?: number) =>
  writeConfigFile(checkServerFolder(folderPath), String(rel), String(text ?? ''), expectedModified == null ? undefined : Number(expectedModified))
)
ipcMain.handle('setCurseForgeKey', (_event, key: string) => setCurseForgeKey(String(key)))
ipcMain.handle('searchMaps', (_event, query: string, sort: MapSort, offset: number) =>
  searchMaps(String(query ?? ''), sort, Number(offset) || 0)
)
ipcMain.handle('mapFiles', (_event, modId: number) => mapFiles(Number(modId)))
// 맵은 한 번에 하나만 받는다. 취소하면 받던 것을 끊는다
ipcMain.handle('prepareMap', (event, modId: number, fileId: number, title: string) =>
  runCancellable('map-download', () => prepareMap(Number(modId), Number(fileId), String(title ?? ''), (done, total) => event.sender.send('mapProgress', { done, total })))
)
ipcMain.handle('cancelMap', () => cancelTask('map-download'))
ipcMain.handle('importWorld', (_event, folderPath: string, source: string) => {
  const target = checkServerFolder(folderPath)
  return withLock(target, '월드 가져오기', () => importWorld(target, String(source), readServerInfo(target).mcVersion))
})
ipcMain.handle('getWhitelist', (_event, folderPath: string) => whitelist.getWhitelist(checkServerFolder(folderPath)))
ipcMain.handle('setWhitelistEnabled', (_event, folderPath: string, enabled: boolean) =>
  whitelist.setWhitelistEnabled(checkServerFolder(folderPath), !!enabled)
)
ipcMain.handle('addWhitelist', (_event, folderPath: string, name: string) =>
  whitelist.addWhitelist(checkServerFolder(folderPath), String(name))
)
ipcMain.handle('removeWhitelist', (_event, folderPath: string, name: string) =>
  whitelist.removeWhitelist(checkServerFolder(folderPath), String(name))
)
ipcMain.handle('modKind', (_event, folderPath: string) => mods.modKind(checkServerFolder(folderPath)))
ipcMain.handle('searchMods', (_event, folderPath: string, query: string, page?: number, site?: string) =>
  mods.search(checkServerFolder(folderPath), String(query ?? ''), Number(page) || 0, siteOf(site))
)
ipcMain.handle('installMod', (_event, folderPath: string, projectId: string) => {
  const target = checkServerFolder(folderPath)
  return withLock(target, '모드 설치', () => mods.install(target, String(projectId)))
})
ipcMain.handle('listDatapacks', (_event, folderPath: string) => datapacks.list(checkServerFolder(folderPath)))
ipcMain.handle('identifyDatapacks', (_event, folderPath: string) => datapacks.identify(checkServerFolder(folderPath)).catch(() => null))
ipcMain.handle('searchDatapacks', (_event, folderPath: string, query: string, page: number, site?: string) =>
  datapacks.search(checkServerFolder(folderPath), String(query ?? ''), Number(page) || 0, siteOf(site))
)
ipcMain.handle('installDatapack', (_event, folderPath: string, projectId: string) => datapacks.install(checkServerFolder(folderPath), String(projectId)))
ipcMain.handle('setDatapackEnabled', (_event, folderPath: string, name: string, enabled: boolean) =>
  datapacks.setEnabled(checkServerFolder(folderPath), String(name), !!enabled)
)
ipcMain.handle('datapackVersions', (_event, folderPath: string, name: string) => datapacks.versionsOf(checkServerFolder(folderPath), String(name)))
ipcMain.handle('setDatapackVersion', (_event, folderPath: string, name: string, versionId: string) =>
  datapacks.setVersion(checkServerFolder(folderPath), String(name), String(versionId))
)
ipcMain.handle('removeDatapack', (_event, folderPath: string, name: string) => datapacks.remove(checkServerFolder(folderPath), String(name)))
ipcMain.handle('addDatapackFile', (_event, folderPath: string, file: string) => datapacks.addFile(checkServerFolder(folderPath), String(file)))
ipcMain.handle('modVersions', (_event, folderPath: string, fileName: string) => mods.versionsOf(checkServerFolder(folderPath), String(fileName)))
ipcMain.handle('setModVersion', (_event, folderPath: string, fileName: string, versionId: string) => {
  const target = checkServerFolder(folderPath)
  return withLock(target, '모드 버전 바꾸기', () => mods.setVersion(target, String(fileName), String(versionId)))
})
ipcMain.handle('addModFile', (_event, folderPath: string, file: string) => mods.addFile(checkServerFolder(folderPath), String(file)))
ipcMain.handle('exportClientPack', (event, folderPath: string, format: string) =>
  mods.exportClientPack(checkServerFolder(folderPath), format === 'zip' ? 'zip' : 'mrpack', BrowserWindow.fromWebContents(event.sender))
)
ipcMain.handle('listMods', (_event, folderPath: string) => mods.list(checkServerFolder(folderPath)))
ipcMain.handle('offSuggestions', (_event, folderPath: string) => mods.offSuggestions(checkServerFolder(folderPath)))
ipcMain.handle('applyOffSuggestions', (_event, folderPath: string, fileNames: string[]) => {
  const target = checkServerFolder(folderPath)
  return withLock(target, '모드 끄기', () => mods.applyOffSuggestions(target, Array.isArray(fileNames) ? fileNames.map(String) : []))
})
// 기록 없는 모드를 Modrinth에서 알아본다 (새로 알아낸 게 있으면 true → 화면이 목록을 다시 읽는다)
ipcMain.handle('identifyMods', (_event, folderPath: string) => mods.identify(checkServerFolder(folderPath)).catch(() => null))
ipcMain.handle('checkModUpdates', (_event, folderPath: string) => mods.checkUpdates(checkServerFolder(folderPath)))
ipcMain.handle('updateMods', (_event, folderPath: string, fileNames: string[]) => {
  const target = checkServerFolder(folderPath)
  return withLock(target, '모드 업데이트', () => mods.updateMods(target, Array.isArray(fileNames) ? fileNames.map(String) : []))
})
ipcMain.handle('removeMod', (_event, folderPath: string, fileName: string) =>
  mods.remove(checkServerFolder(folderPath), String(fileName))
)
ipcMain.handle('setModEnabled', (_event, folderPath: string, fileName: string, enabled: boolean) =>
  mods.setEnabled(checkServerFolder(folderPath), String(fileName), !!enabled)
)

ipcMain.handle('copyText', (_event, text: string) => clipboard.writeText(String(text)))

// 서버 로그/상태/초대 정보를 열린 창 모두에 보낸다
const broadcast = (e: ServerEvent): void => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('serverEvent', e))
onServerEvent(broadcast)
initInvite(broadcast)

// ---------- 창 조작 (커스텀 타이틀바) ----------
ipcMain.handle('windowControl', (event, action: 'minimize' | 'maximize' | 'close') => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return
  if (action === 'minimize') win.minimize()
  else if (action === 'maximize') (win.isMaximized() ? win.unmaximize() : win.maximize())
  else if (action === 'close') win.close()
})
ipcMain.handle('getSiteStatus', () => getSiteStatus())
ipcMain.handle('preflight', (_event, folderPath: string) => runPreflight(checkServerFolder(folderPath)))
ipcMain.handle('isMaximized', (event) => BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false)

ipcMain.handle('getUpdate', () => getUpdateState())
// 업데이트: 월드를 저장하며 서버를 끄고, 공유기 포트를 닫은 뒤 새 버전을 설치하고 다시 켠다
ipcMain.handle('installUpdate', async () => {
  if (working()) throw new Error('서버 만들기·백업 같은 작업이 끝난 뒤에 업데이트할 수 있어요.')
  quitting = true
  cancelAutoRestarts()
  stopAllSamplers()
  flushPlayerLog()
  await stopAll()
  await closeAllPorts()
  installUpdateNow()
})

// 확인 창에서 "끄고 닫기"를 누르면: stop으로 월드를 저장하게 하고, 공유기 포트를 닫은 뒤 앱을 끝낸다
ipcMain.handle('quitApp', async () => {
  quitting = true
  cancelAutoRestarts()
  stopAllSamplers()
  flushPlayerLog()
  await stopAll()
  await closeAllPorts()
  app.quit()
})

// 앱은 하나만 켠다. 두 개가 켜지면 같은 서버를 둘이서 켜고 끄려고 한다.
// 이미 켜져 있으면 새로 켠 쪽은 바로 끄고, 켜져 있던 창을 앞으로 가져온다 (트레이에 숨어 있어도)
if (!app.requestSingleInstanceLock()) {
  app.exit(0)
} else {
  app.on('second-instance', () => showWindow())
}

app.whenReady().then(() => {
  if (!app.hasSingleInstanceLock()) return
  // 윈도우 알림·작업 표시줄이 이 앱을 알아보는 이름. 개발용은 따로 둔다
  // (같으면 작업 표시줄 고정 아이콘이나 알림을 눌렀을 때 개발용 Electron이 앱 없이 켜져 기본 화면이 뜬다)
  app.setAppUserModelId(app.isPackaged ? 'com.mcservermanager.app' : 'com.mcservermanager.app.dev')
  applyLoginItem() // 윈도우 시작 시 실행 설정을 맞춘다 (앱 위치가 바뀌었을 수 있어서)
  cleanupUnfinished()
  cleanWorldTemp()
  cleanModpackTemp() // 지난번에 만들다 만 서버 폴더 정리
  createWindow()
  void autoStartServers() // "앱을 켜면 이 서버도 켜기"를 켠 서버 (하나씩 차례로)
  initUpdater() // 새 버전 확인 (설치한 앱에서만)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
