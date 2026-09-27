// 월드 백업·복원: 월드 폴더들을 userData/backups/<서버 폴더 이름>/<시각>/ 에 그대로 복사해 둔다.
// 켜진 서버는 save-off → save-all flush로 저장을 멈추고 복사한 다음 save-on으로 되돌린다.
import { app, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { friendlyError, type BackupItem, type BackupSettings } from '../shared-types'
import { readProperties } from './properties'
import { notify } from './notify'
import { emitEvent, getState, onServerEvent, quietQuery, sendCommand } from './runner'

const DEFAULT_KEEP = 10 // 자동 백업은 기본으로 최근 10개만 남긴다
const DEFAULT_EVERY_MIN = 60 // 켜져 있는 동안 1시간마다
const INFO_FILE = 'server-manager.json'

// 백업 설정은 서버 정보 파일에 적는다 (servers.ts를 불러오면 서로 불러오는 고리가 생겨서 직접 읽는다)
function readInfo(folderPath: string): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(path.join(folderPath, INFO_FILE), 'utf8'))
  } catch {
    return {}
  }
}

export function getBackupSettings(folderPath: string): BackupSettings {
  const info = readInfo(folderPath)
  return {
    everyMin: typeof info.backupEveryMin === 'number' ? info.backupEveryMin : DEFAULT_EVERY_MIN,
    keep: typeof info.backupKeep === 'number' ? info.backupKeep : DEFAULT_KEEP
  }
}

export function setBackupSettings(folderPath: string, s: BackupSettings): void {
  const everyMin = Math.max(0, Math.min(24 * 60, Math.round(Number(s.everyMin) || 0)))
  const keep = Math.max(1, Math.min(200, Math.round(Number(s.keep) || DEFAULT_KEEP)))
  const info = readInfo(folderPath)
  fs.writeFileSync(path.join(folderPath, INFO_FILE), JSON.stringify({ ...info, backupEveryMin: everyMin, backupKeep: keep }, null, 2))
  if (getState(folderPath) === 'running') schedule(folderPath) // 켜져 있으면 새 간격으로 다시 잡는다
}

// ---------- 정기 백업: 서버가 켜져 있는 동안 정해진 간격마다 ----------
const timers = new Map<string, ReturnType<typeof setInterval>>()

function schedule(folderPath: string): void {
  unschedule(folderPath)
  const { everyMin } = getBackupSettings(folderPath)
  if (!everyMin) return
  timers.set(
    folderPath,
    setInterval(() => {
      if (getState(folderPath) !== 'running') return
      createBackup(folderPath, true)
        .then(() => emitEvent({ type: 'log', folderPath, line: '[앱] 정기 백업을 했어요.' }))
        .catch((e) => {
          emitEvent({ type: 'log', folderPath, line: `[앱] 정기 백업을 하지 못했어요: ${(e as Error).message}` })
          notify('정기 백업을 하지 못했어요', `${path.basename(folderPath)}: ${friendlyError((e as Error).message)}`)
        })
    }, everyMin * 60_000)
  )
}

function unschedule(folderPath: string): void {
  clearInterval(timers.get(folderPath))
  timers.delete(folderPath)
}

onServerEvent((e) => {
  if (e.type !== 'status') return
  if (e.state === 'running') schedule(e.folderPath)
  if (e.state === 'stopped') unschedule(e.folderPath)
})
const META = 'backup.json'
const ID = /^[0-9]{8}-[0-9]{6}(-[0-9]{1,3})?(-auto)?$/

export const backupRoot = (folderPath: string): string => path.join(app.getPath('userData'), 'backups', path.basename(folderPath))

function worldNames(folderPath: string): string[] {
  const name = readProperties(folderPath)['level-name'] || 'world'
  return [name, `${name}_nether`, `${name}_the_end`].filter((n) => {
    const p = path.join(folderPath, n)
    return p.startsWith(folderPath + path.sep) && fs.existsSync(p)
  })
}

function sizeOf(dir: string): number {
  let total = 0
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    total += e.isDirectory() ? sizeOf(p) : fs.statSync(p).size
  }
  return total
}

const stamp = (d: Date): string => {
  const z = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`
}

export function listBackups(folderPath: string): BackupItem[] {
  const root = backupRoot(folderPath)
  if (!fs.existsSync(root)) return []
  return fs
    .readdirSync(root)
    .filter((id) => ID.test(id))
    .map((id) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(root, id, META), 'utf8')) as BackupItem
      } catch {
        return null // 복사하다 멈춘 백업
      }
    })
    .filter((b): b is BackupItem => !!b)
    .sort((a, b) => b.createdAt - a.createdAt)
}

const busy = new Set<string>()

// note: 무엇 때문에 만든 백업인지 (예: 버전 바꾸기 전)
export async function createBackup(folderPath: string, auto = false, note?: string): Promise<BackupItem> {
  if (busy.has(folderPath)) throw new Error('이미 백업하는 중이에요.')
  const state = getState(folderPath)
  // 켜지는 중·꺼지는 중에는 저장을 멈출 수 없어서, 반쯤 쓰인 파일이 백업될 수 있다
  if (state === 'starting' || state === 'stopping') throw new Error(state === 'starting' ? '서버가 다 켜진 다음에 백업할 수 있어요.' : '서버가 다 꺼진 다음에 백업할 수 있어요.')
  const worlds = worldNames(folderPath)
  if (!worlds.length) throw new Error('아직 월드가 없어요. 서버를 한 번 켠 다음에 백업할 수 있어요.')
  busy.add(folderPath)
  const on = getState(folderPath) === 'running'
  const now = new Date()
  // 같은 초에 두 번 만들면 이름이 겹치지 않게 번호를 붙인다
  let id = ''
  for (let n = 0; !id || fs.existsSync(path.join(backupRoot(folderPath), id)); n++) id = stamp(now) + (n ? `-${n + 1}` : '') + (auto ? '-auto' : '')
  const dir = path.join(backupRoot(folderPath), id)
  try {
    if (on) {
      // 저장을 멈추고 지금까지를 디스크에 모두 쓴다
      await quietQuery(folderPath, ['save-off', 'save-all flush'], (l) => /Saved the (game|world)|Automatic saving is now disabled|Turned off world auto-saving/i.test(l), {
        idleMs: 1500,
        maxMs: 30000
      })
    }
    fs.mkdirSync(dir, { recursive: true })
    for (const w of worlds) await fs.promises.cp(path.join(folderPath, w), path.join(dir, w), { recursive: true })
    const item: BackupItem = { id, createdAt: now.getTime(), auto, sizeBytes: sizeOf(dir), worlds, ...(note && { note }) }
    fs.writeFileSync(path.join(dir, META), JSON.stringify(item, null, 2))
    if (auto) await pruneAuto(folderPath)
    emitEvent({ type: 'backups', folderPath }) // 백업 탭·서버 목록이 다시 읽게
    return item
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true })
    throw e
  } finally {
    if (on && getState(folderPath) === 'running') sendCommand(folderPath, 'save-on')
    busy.delete(folderPath)
  }
}

// 자동 백업 중 오래된 것을 지운다. "버전 바꾸기 전"처럼 이유가 적힌 백업은 중요해서 남긴다
async function pruneAuto(folderPath: string): Promise<void> {
  const autos = listBackups(folderPath).filter((b) => b.auto && !b.note)
  for (const b of autos.slice(getBackupSettings(folderPath).keep)) fs.rmSync(path.join(backupRoot(folderPath), b.id), { recursive: true, force: true })
}

function backupDir(folderPath: string, id: string): string {
  if (!ID.test(id)) throw new Error('잘못된 백업이에요.')
  const dir = path.join(backupRoot(folderPath), id)
  if (!fs.existsSync(path.join(dir, META))) throw new Error('백업을 찾을 수 없어요.')
  return dir
}

// 백업을 먼저 서버 폴더 옆 임시 폴더에 다 복사한 다음, 지금 월드를 휴지통으로 보내고 바꿔 끼운다.
// (복사하다 실패하면 지금 월드는 그대로 남는다. 바꿔 끼우기는 같은 디스크 안 이름 바꾸기라 거의 실패하지 않는다)
export async function restoreBackup(folderPath: string, id: string): Promise<void> {
  if (getState(folderPath) !== 'stopped') throw new Error('서버를 끈 다음에 복원할 수 있어요.')
  const dir = backupDir(folderPath, id)
  const item = JSON.parse(fs.readFileSync(path.join(dir, META), 'utf8')) as BackupItem
  const worlds = item.worlds.filter((w) => path.join(folderPath, w).startsWith(folderPath + path.sep))
  const staging = path.join(folderPath, `.restoring-${id}`)
  fs.rmSync(staging, { recursive: true, force: true })
  try {
    for (const w of worlds) await fs.promises.cp(path.join(dir, w), path.join(staging, w), { recursive: true })
  } catch (e) {
    fs.rmSync(staging, { recursive: true, force: true })
    throw e
  }
  // 지금 월드도 먼저 백업해 둔다 (휴지통만 믿지 않는다. 큰 폴더는 휴지통에 안 들어갈 수 있다)
  if (worldNames(folderPath).length) {
    try {
      await createBackup(folderPath, false, '되돌리기 전')
    } catch (e) {
      fs.rmSync(staging, { recursive: true, force: true })
      throw e
    }
  }
  for (const w of worldNames(folderPath)) await shell.trashItem(path.join(folderPath, w))
  for (const w of worlds) fs.renameSync(path.join(staging, w), path.join(folderPath, w))
  fs.rmSync(staging, { recursive: true, force: true })
  emitEvent({ type: 'backups', folderPath })
}

export async function deleteBackup(folderPath: string, id: string): Promise<void> {
  await shell.trashItem(backupDir(folderPath, id))
  emitEvent({ type: 'backups', folderPath })
}

export function openBackupFolder(folderPath: string): void {
  const root = backupRoot(folderPath)
  fs.mkdirSync(root, { recursive: true })
  shell.openPath(root)
}

// 마지막으로 월드가 저장된 시각 (level.dat은 저장할 때마다 새로 쓰인다)
function worldSavedAt(folderPath: string): number {
  let t = 0
  for (const w of worldNames(folderPath)) {
    try {
      t = Math.max(t, fs.statSync(path.join(folderPath, w, 'level.dat')).mtimeMs)
    } catch {
      // 네더·엔드 폴더에는 level.dat이 없다
    }
  }
  return t
}

// 서버를 켜기 전에 자동 백업 (월드가 있을 때만, 실패해도 켜기는 계속한다)
// 마지막 백업 뒤로 월드가 바뀌지 않았으면 또 복사하지 않는다 (큰 월드는 켤 때마다 오래 걸린다)
export async function autoBackupBeforeStart(folderPath: string): Promise<void> {
  if (!worldNames(folderPath).length) return
  const last = listBackups(folderPath)[0]
  if (last && last.createdAt >= worldSavedAt(folderPath)) return
  await createBackup(folderPath, true).catch(() => undefined)
}
