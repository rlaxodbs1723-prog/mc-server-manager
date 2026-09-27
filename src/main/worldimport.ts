// 싱글플레이 월드를 서버로 가져오기: .minecraft/saves의 월드(또는 사용자가 고른 폴더)를 서버 월드 자리에 복사한다.
// 지금 월드는 먼저 백업하고 휴지통으로 보낸다. 네더·엔드(DIM-1, DIM1)는 월드 안에 들어 있어 그대로 따라온다.
// (Paper·Purpur는 처음 켤 때 스스로 world_nether·world_the_end로 옮긴다)
import { app, dialog, shell, type BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import type { SaveWorld } from '../shared-types'
import { createBackup } from './backup'
import { child, parseNbt } from './nbt'
import { readProperties } from './properties'
import { getState } from './runner'
import { downloadMap } from './curseforge'
import { getVersions } from './mojang'
import { tempRoot, unpackWorld } from './worldzip'

// 화면이 아무 경로나 보내지 못하게, 목록이나 폴더 고르기로 보여 준 월드만 가져올 수 있다
const offered = new Set<string>()
const offer = (w: SaveWorld): SaveWorld => (offered.add(path.resolve(w.path)), w)

const savesDir = (): string => path.join(app.getPath('appData'), '.minecraft', 'saves')
const str = (t: ReturnType<typeof child>): string | undefined => (t?.type === 8 ? t.value.toString('utf8') : undefined)

function describe(dir: string): SaveWorld | null {
  const levelDat = path.join(dir, 'level.dat')
  if (!fs.existsSync(levelDat)) return null
  let name = path.basename(dir)
  let version: string | undefined
  let lastPlayed = fs.statSync(levelDat).mtimeMs
  try {
    const data = child(parseNbt(fs.readFileSync(levelDat)).root, 'Data')
    if (data?.type === 10) {
      name = str(child(data, 'LevelName')) || name
      const v = child(data, 'Version')
      if (v?.type === 10) version = str(child(v, 'Name'))
      const lp = child(data, 'LastPlayed')
      if (lp?.type === 4) lastPlayed = Number(lp.value)
    }
  } catch {
    // 이름을 못 읽어도 폴더 이름으로 보여 준다
  }
  const iconFile = path.join(dir, 'icon.png')
  const icon = fs.existsSync(iconFile) ? `data:image/png;base64,${fs.readFileSync(iconFile).toString('base64')}` : null
  return { path: dir, name, folder: path.basename(dir), version, lastPlayed, icon }
}

export function listSaves(): SaveWorld[] {
  const root = savesDir()
  if (!fs.existsSync(root)) return []
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => describe(path.join(root, e.name)))
    .filter((w): w is SaveWorld => !!w)
    .map(offer)
    .sort((a, b) => b.lastPlayed - a.lastPlayed)
}

// 맵 zip 파일을 골라 풀고, 풀린 월드를 돌려준다
export async function pickWorldZip(win: BrowserWindow | null): Promise<SaveWorld | null> {
  const opts = {
    title: '가져올 맵 zip 파일을 골라 주세요',
    properties: ['openFile' as const],
    filters: [{ name: '맵 압축 파일', extensions: ['zip'] }]
  }
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (res.canceled || !res.filePaths[0]) return null
  const w = describe(await unpackWorld(res.filePaths[0]))
  if (!w) throw new Error('zip 안에 마인크래프트 월드가 없어요.')
  return offer({ ...w, name: w.name || path.basename(res.filePaths[0], '.zip') })
}

// 끌어다 놓은 것: zip이면 풀고, 폴더면 월드인지 확인한다
export async function openDroppedWorld(p: string): Promise<SaveWorld> {
  if (!p || !fs.existsSync(p)) throw new Error('파일을 찾을 수 없어요.')
  if (fs.statSync(p).isDirectory()) {
    const w = describe(p)
    if (!w) throw new Error('이 폴더는 마인크래프트 월드가 아니에요 (level.dat이 없어요).')
    return offer(w)
  }
  if (!/\.zip$/i.test(p)) throw new Error('zip 파일이나 월드 폴더를 넣어 주세요.')
  const w = describe(await unpackWorld(p))
  if (!w) throw new Error('zip 안에 마인크래프트 월드가 없어요.')
  return offer({ ...w, name: w.name || path.basename(p, '.zip') })
}

// CurseForge 맵을 받아서 풀고, 풀린 월드를 돌려준다
export async function prepareMap(modId: number, fileId: number, title: string, onBytes?: (done: number, total?: number) => void): Promise<SaveWorld> {
  const zip = await downloadMap(modId, fileId, onBytes)
  try {
    const w = describe(await unpackWorld(zip))
    if (!w) throw new Error('받은 파일에 마인크래프트 월드가 없어요.')
    return offer({ ...w, name: String(title).slice(0, 100) || w.name })
  } finally {
    fs.rmSync(zip, { force: true })
  }
}

// 새 버전에서 만든 월드는 예전 버전 서버에서 열리지 않는다 (마인크래프트는 월드를 예전 버전으로 되돌리지 못한다).
// 가져오기 전에 막는다. 버전을 모르거나 목록에 없으면(인터넷 안 됨 등) 막지 않는다
export async function assertWorldFits(source: string, mcVersion: string): Promise<void> {
  const w = describe(path.resolve(source))?.version
  if (!w || w === mcVersion) return
  const list = await getVersions(true).catch(() => [])
  const time = (id: string): number | undefined => {
    const v = list.find((x) => x.id === id)
    return v ? Date.parse(v.releaseTime) : undefined
  }
  const wt = time(w)
  const st = time(mcVersion)
  if (wt != null && st != null && wt > st)
    throw new Error(`이 월드는 ${w}에서 만든 월드라 ${mcVersion} 서버에서는 열 수 없어요. 마인크래프트는 새 버전 월드를 예전 버전으로 열지 못해요. 서버 버전을 ${w} 이상으로 바꾼 뒤 가져와 주세요.`)
}

export async function importWorld(folderPath: string, source: string, mcVersion?: string): Promise<void> {
  if (getState(folderPath) !== 'stopped') throw new Error('서버를 끈 다음에 월드를 가져올 수 있어요.')
  const src = path.resolve(source)
  if (!offered.has(src)) throw new Error('목록에서 월드를 다시 골라 주세요.')
  if (!fs.existsSync(path.join(src, 'level.dat'))) throw new Error('월드 폴더가 아니에요 (level.dat이 없어요).')
  if (mcVersion) await assertWorldFits(src, mcVersion)
  if (path.resolve(folderPath).startsWith(src + path.sep) || src.startsWith(path.resolve(folderPath) + path.sep))
    throw new Error('서버 안의 폴더는 가져올 수 없어요.')

  const levelName = readProperties(folderPath)['level-name'] || 'world'
  const existing = [levelName, `${levelName}_nether`, `${levelName}_the_end`]
    .map((n) => path.join(folderPath, n))
    .filter((p) => p.startsWith(folderPath + path.sep) && fs.existsSync(p))
  if (existing.length) await createBackup(folderPath, false, '월드 가져오기 전') // 되돌릴 수 있게 지금 월드를 먼저 백업한다
  // 새 월드를 옆 임시 폴더에 다 복사한 다음에 바꿔 끼운다 (복사하다 실패해도 지금 월드는 그대로 남는다)
  const staging = path.join(folderPath, '.importing-world')
  fs.rmSync(staging, { recursive: true, force: true })
  try {
    await fs.promises.cp(src, staging, { recursive: true, filter: (p) => path.basename(p) !== 'session.lock' })
  } catch (e) {
    fs.rmSync(staging, { recursive: true, force: true })
    throw e
  }
  for (const p of existing) await shell.trashItem(p)
  fs.renameSync(staging, path.join(folderPath, levelName))
  // zip에서 풀어 둔 임시 폴더는 다 옮겼으면 지운다
  const temp = path.resolve(tempRoot())
  if (src.startsWith(temp + path.sep)) {
    fs.rmSync(path.join(temp, path.relative(temp, src).split(path.sep)[0]), { recursive: true, force: true })
    offered.delete(src)
  }
}
