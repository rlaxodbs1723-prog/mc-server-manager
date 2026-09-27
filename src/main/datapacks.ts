// 데이터팩: 월드의 datapacks 폴더를 관리한다. 끈 것은 datapacks-disabled로 옮겨 둔다.
// Modrinth에서 받은 것은 .server-manager-datapacks.json에 이름·아이콘을 적어 둔다.
// 서버가 켜져 있으면 바꾼 뒤 reload로 바로 적용한다 (새 데이터팩도 reload 때 자동으로 켜진다).
import { shell } from 'electron'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import type { InstalledDatapack, ModSearchHit, ModVersionItem, SearchSite } from '../shared-types'
import { downloadFile } from './download'
import * as modrinth from './modrinth'
import * as cf from './curseforge'
import { mergedSearch, sameNameOtherSite } from './merge'
import { readProperties } from './properties'
import { getState, sendCommand } from './runner'
import { readServerInfo } from './servers'

const TRACK = '.server-manager-datapacks.json'
const ON = 'datapacks'
const OFF = 'datapacks-disabled'

interface Track {
  projectId: string
  versionId?: string
  title: string
  iconUrl: string | null
  versionNumber: string
}

const worldDir = (folderPath: string): string => path.join(folderPath, readProperties(folderPath)['level-name'] || 'world')

function readTrack(folderPath: string): Record<string, Track> {
  try {
    return JSON.parse(fs.readFileSync(path.join(folderPath, TRACK), 'utf8')) ?? {}
  } catch {
    return {}
  }
}
const writeTrack = (folderPath: string, t: Record<string, Track>): void => fs.writeFileSync(path.join(folderPath, TRACK), JSON.stringify(t, null, 2))

function checkName(name: string): string {
  const n = String(name)
  if (!n || /[\\/]|\.\./.test(n)) throw new Error('잘못된 데이터팩 이름이에요.')
  return n
}

// 켜진 서버가 데이터팩 zip을 쥐고 있으면 옮기거나 지울 수 없다 (Windows). 잠깐씩 기다렸다 몇 번 더 해 본다
async function retryBusy<T>(folderPath: string, work: () => Promise<T> | T): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await work()
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      const busy = code === 'EBUSY' || code === 'EPERM' || /used by another process|다른 프로세스/i.test(String((e as Error).message))
      if (!busy) throw e
      if (i >= 4) {
        throw new Error(getState(folderPath) === 'stopped' ? '다른 프로그램이 이 데이터팩 파일을 쓰고 있어요. 그 프로그램을 닫고 다시 해 주세요.' : '서버가 이 데이터팩을 쓰고 있어서 지금은 바꿀 수 없어요. 서버를 끈 다음에 다시 해 주세요.')
      }
      await new Promise((r) => setTimeout(r, 400))
    }
  }
}

// 켜져 있으면 reload로 바로 적용한다
function applyNow(folderPath: string): void {
  if (getState(folderPath) === 'running') sendCommand(folderPath, 'reload')
}

// 폴더형이면 pack.mcmeta의 설명을 읽는다
function description(p: string): string {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(p, 'pack.mcmeta'), 'utf8'))
    const d = meta?.pack?.description
    return typeof d === 'string' ? d.replace(/§./g, '') : Array.isArray(d) ? d.map((x) => (typeof x === 'string' ? x : x?.text ?? '')).join('') : (d?.text ?? '')
  } catch {
    return ''
  }
}

export function list(folderPath: string): InstalledDatapack[] {
  const track = readTrack(folderPath)
  const out: InstalledDatapack[] = []
  for (const [sub, enabled] of [[ON, true], [OFF, false]] as const) {
    const dir = path.join(worldDir(folderPath), sub)
    if (!fs.existsSync(dir)) continue
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      const isPack = e.isDirectory() ? fs.existsSync(path.join(full, 'pack.mcmeta')) : /\.zip$/i.test(e.name)
      if (!isPack) continue
      const t = track[e.name]
      out.push({
        name: e.name,
        enabled,
        title: t?.title ?? e.name.replace(/\.zip$/i, ''),
        description: e.isDirectory() ? description(full) : '',
        versionNumber: t?.versionNumber ?? '',
        // Modrinth에서 받은 게 아니면 폴더 안의 pack.png를 아이콘으로 쓴다
        iconUrl: t?.iconUrl ?? (e.isDirectory() && fs.existsSync(path.join(full, "pack.png")) ? `data:image/png;base64,${fs.readFileSync(path.join(full, "pack.png")).toString("base64")}` : null),
        tracked: !!t
      })
    }
  }
  return out.sort((a, b) => a.title.localeCompare(b.title))
}

export async function search(folderPath: string, query: string, page = 0, site: SearchSite = 'all'): Promise<{ total: number; more: boolean; hits: ModSearchHit[] }> {
  const { mcVersion } = readServerInfo(folderPath)
  const track = Object.values(readTrack(folderPath))
  const installed = new Set(track.map((t) => t.projectId))
  const dupOf = sameNameOtherSite(track)
  const res = await mergedSearch(
    page,
    () => modrinth.search({ query, projectType: 'datapack', mcVersion, loaders: ['datapack'], offset: page * 20, limit: 20 }),
    () => cf.searchProjects({ classId: cf.CF_CLASS.datapack, query, gameVersion: mcVersion, offset: page * 20 }),
    site
  )
  return { ...res, hits: res.hits.map((h) => ({ ...h, installed: installed.has(h.projectId), sameNameInstalled: !installed.has(h.projectId) && dupOf(h) })) }
}

// CurseForge 데이터팩: 이 버전에 맞는 최신 zip
async function installCf(folderPath: string, projectId: string): Promise<string> {
  const { mcVersion } = readServerInfo(folderPath)
  const modId = cf.cfNum(projectId)
  const info = (await cf.projectsInfo([modId])).get(modId)
  const file = (await cf.projectFiles(modId, mcVersion)).find((f) => /\.zip$/i.test(f.fileName))
  const title = info?.name ?? projectId
  if (!file) throw new Error(`"${title}"은(는) 이 서버(${mcVersion})에 맞는 데이터팩 파일이 없어요.`)
  const fileName = path.basename(file.fileName)
  const dir = path.join(worldDir(folderPath), ON)
  fs.mkdirSync(dir, { recursive: true })
  await downloadFile({ url: cf.checkCfUrl(file.downloadUrl), dest: path.join(dir, fileName) })
  const track = readTrack(folderPath)
  track[fileName] = { projectId, versionId: cf.CF_PREFIX + file.id, title, iconUrl: info?.icon ?? null, versionNumber: file.displayName || file.fileName }
  writeTrack(folderPath, track)
  applyNow(folderPath)
  return title
}

export async function install(folderPath: string, projectId: string): Promise<string> {
  if (cf.isCf(projectId)) return installCf(folderPath, projectId)
  const { mcVersion } = readServerInfo(folderPath)
  const project = await modrinth.getProject(projectId)
  const version = (await modrinth.getCompatibleVersions(projectId, mcVersion, ['datapack']))[0]
  if (!version?.file) throw new Error(`"${project.title}"은(는) 이 서버(${mcVersion})에 맞는 데이터팩 버전이 없어요.`)
  const fileName = path.basename(version.file.fileName)
  if (!/\.zip$/i.test(fileName)) throw new Error('데이터팩 파일(zip)이 아니에요.')
  const dir = path.join(worldDir(folderPath), ON)
  fs.mkdirSync(dir, { recursive: true })
  await downloadFile({ url: version.file.url, dest: path.join(dir, fileName), sha1: version.file.sha1 ?? undefined })
  const track = readTrack(folderPath)
  track[fileName] = { projectId, versionId: version.id, title: project.title, iconUrl: project.iconUrl, versionNumber: version.versionNumber }
  writeTrack(folderPath, track)
  applyNow(folderPath)
  return project.title
}

export async function setEnabled(folderPath: string, name: string, enabled: boolean): Promise<void> {
  const n = checkName(name)
  const world = worldDir(folderPath)
  const from = path.join(world, enabled ? OFF : ON, n)
  const to = path.join(world, enabled ? ON : OFF, n)
  if (!fs.existsSync(from)) throw new Error('데이터팩을 찾을 수 없어요.')
  fs.mkdirSync(path.dirname(to), { recursive: true })
  await retryBusy(folderPath, () => fs.renameSync(from, to))
  applyNow(folderPath)
}

export async function remove(folderPath: string, name: string): Promise<void> {
  const n = checkName(name)
  const world = worldDir(folderPath)
  for (const sub of [ON, OFF]) {
    const p = path.join(world, sub, n)
    if (fs.existsSync(p)) await retryBusy(folderPath, () => shell.trashItem(p))
  }
  const track = readTrack(folderPath)
  delete track[n]
  writeTrack(folderPath, track)
  applyNow(folderPath)
}

// 끌어다 놓은 zip이나 폴더(pack.mcmeta가 있는)를 넣는다
export async function addFile(folderPath: string, source: string): Promise<string> {
  const src = path.resolve(String(source))
  if (!fs.existsSync(src)) throw new Error('파일을 찾을 수 없어요.')
  const isDir = fs.statSync(src).isDirectory()
  if (isDir ? !fs.existsSync(path.join(src, 'pack.mcmeta')) : !/\.zip$/i.test(src))
    throw new Error('데이터팩(zip 파일이나 pack.mcmeta가 있는 폴더)이 아니에요.')
  const dir = path.join(worldDir(folderPath), ON)
  const target = path.join(dir, path.basename(src))
  if (fs.existsSync(target)) throw new Error('같은 이름의 데이터팩이 이미 있어요.')
  fs.mkdirSync(dir, { recursive: true })
  await fs.promises.cp(src, target, { recursive: true })
  applyNow(folderPath)
  return path.basename(src)
}

// ---------- 버전 바꾸기 (Modrinth에서 받은 것만) ----------
export async function versionsOf(folderPath: string, name: string): Promise<ModVersionItem[]> {
  const t = readTrack(folderPath)[checkName(name)]
  if (!t) throw new Error('직접 넣은 데이터팩이라 버전을 바꿀 수 없어요.')
  const { mcVersion } = readServerInfo(folderPath)
  if (cf.isCf(t.projectId)) {
    const files = (await cf.projectFiles(cf.cfNum(t.projectId), mcVersion)).filter((f) => /\.zip$/i.test(f.fileName))
    return files.slice(0, 40).map((f) => ({
      id: cf.CF_PREFIX + f.id,
      versionNumber: f.displayName || f.fileName,
      type: f.releaseType === 2 ? 'beta' : f.releaseType === 3 ? 'alpha' : 'release',
      date: Date.parse(f.fileDate),
      current: cf.CF_PREFIX + f.id === t.versionId
    }))
  }
  const list = await modrinth.getCompatibleVersions(t.projectId, mcVersion, ['datapack'])
  return list
    .sort((a, b) => Date.parse(b.datePublished) - Date.parse(a.datePublished))
    .slice(0, 40)
    .map((v) => ({
      id: v.id,
      versionNumber: v.versionNumber,
      type: v.versionType,
      date: Date.parse(v.datePublished),
      current: t.versionId ? v.id === t.versionId : v.versionNumber === t.versionNumber
    }))
}

export async function setVersion(folderPath: string, name: string, versionId: string): Promise<void> {
  const n = checkName(name)
  const track = readTrack(folderPath)
  const t = track[n]
  if (!t) throw new Error('직접 넣은 데이터팩이라 버전을 바꿀 수 없어요.')
  let v: { id: string; versionNumber: string; file: { fileName: string; url: string; sha1: string | null } | null }
  if (cf.isCf(t.projectId)) {
    if (!cf.isCf(versionId)) throw new Error('다른 데이터팩의 버전이에요.')
    const f = await cf.getFile(cf.cfNum(t.projectId), cf.cfNum(versionId))
    v = { id: versionId, versionNumber: f.displayName || f.fileName, file: { fileName: f.fileName, url: cf.checkCfUrl(f.downloadUrl), sha1: null } }
  } else {
    const mv = await modrinth.getVersion(versionId)
    if (mv.projectId !== t.projectId) throw new Error('다른 데이터팩의 버전이에요.')
    v = mv
  }
  if (!v.file) throw new Error('받을 파일이 없는 버전이에요.')
  const newName = path.basename(v.file.fileName)
  if (!/\.zip$/i.test(newName)) throw new Error('데이터팩 파일(zip)이 아니에요.')
  const world = worldDir(folderPath)
  const sub = fs.existsSync(path.join(world, OFF, n)) ? OFF : ON // 꺼져 있었으면 꺼진 채로
  const dir = path.join(world, sub)
  const tmp = path.join(dir, newName + '.download')
  await downloadFile({ url: v.file.url, dest: tmp, sha1: v.file.sha1 ?? undefined })
  fs.rmSync(path.join(dir, n), { recursive: true, force: true })
  fs.renameSync(tmp, path.join(dir, newName))
  delete track[n]
  track[newName] = { ...t, versionId: v.id, versionNumber: v.versionNumber }
  writeTrack(folderPath, track)
  applyNow(folderPath)
}

// ---------- 기록 없는 데이터팩 알아보기 ----------
// 직접 넣은 zip은 파일 지문(sha1)으로 Modrinth에 물어봐서 찾으면 기록을 만든다 (폴더형은 알아볼 수 없다)
const UNKNOWN = '.server-manager-unknown-datapacks.json'
const UNKNOWN_CF = '.server-manager-unknown-datapacks-cf.json'

export async function identify(folderPath: string): Promise<boolean> {
  const world = worldDir(folderPath)
  const track = readTrack(folderPath)
  let unknown: string[] = []
  try {
    unknown = JSON.parse(fs.readFileSync(path.join(folderPath, UNKNOWN), 'utf8'))
  } catch {
    unknown = []
  }
  let cfChecked: string[] = []
  try {
    cfChecked = JSON.parse(fs.readFileSync(path.join(folderPath, UNKNOWN_CF), 'utf8'))
  } catch {
    cfChecked = []
  }
  const hasKey = cf.hasCurseForgeKey()
  const hashes = new Map<string, string>() // 지문 -> 이름
  const paths = new Map<string, string>() // 이름 -> 경로
  const retryCf: string[] = []
  for (const sub of [ON, OFF]) {
    const dir = path.join(world, sub)
    if (!fs.existsSync(dir)) continue
    for (const name of fs.readdirSync(dir)) {
      if (!/\.zip$/i.test(name) || track[name]) continue
      paths.set(name, path.join(dir, name))
      if (unknown.includes(name)) {
        if (hasKey && !cfChecked.includes(name)) retryCf.push(name)
        continue
      }
      hashes.set(crypto.createHash('sha1').update(fs.readFileSync(path.join(dir, name))).digest('hex'), name)
    }
  }
  if (!hashes.size && !retryCf.length) return false
  const versions = hashes.size ? await modrinth.versionsByHash([...hashes.keys()]) : new Map<string, modrinth.Version>()
  const projects = new Map((await modrinth.getProjects([...new Set([...versions.values()].map((v) => v.projectId))])).map((p) => [p.projectId, p]))
  let found = false
  for (const [hash, name] of hashes) {
    const v = versions.get(hash)
    const p = v && projects.get(v.projectId)
    if (!v || !p) {
      if (!unknown.includes(name)) unknown.push(name)
      retryCf.push(name)
      continue
    }
    track[name] = { projectId: v.projectId, versionId: v.id, title: p.title, iconUrl: p.iconUrl, versionNumber: v.versionNumber }
    found = true
  }
  // CurseForge 지문으로 한 번 더
  if (hasKey && retryCf.length) {
    const byFp = new Map(retryCf.map((n) => [cf.fingerprintOf(fs.readFileSync(paths.get(n)!)), n]))
    const matches = await cf.matchFingerprints([...byFp.keys()]).catch(() => new Map<number, { modId: number; file: cf.CfFileFull }>())
    const infos = await cf.projectsInfo([...new Set([...matches.values()].map((m) => m.modId))]).catch(() => new Map<number, { name: string; icon: string | null }>())
    for (const [fp, name] of byFp) {
      if (!cfChecked.includes(name)) cfChecked.push(name)
      const m = matches.get(fp)
      if (!m) continue
      unknown.splice(unknown.indexOf(name), 1)
      track[name] = {
        projectId: cf.CF_PREFIX + m.modId,
        versionId: cf.CF_PREFIX + m.file.id,
        title: infos.get(m.modId)?.name ?? m.file.displayName,
        iconUrl: infos.get(m.modId)?.icon ?? null,
        versionNumber: m.file.displayName || m.file.fileName
      }
      found = true
    }
  }
  writeTrack(folderPath, track)
  fs.writeFileSync(path.join(folderPath, UNKNOWN), JSON.stringify(unknown))
  fs.writeFileSync(path.join(folderPath, UNKNOWN_CF), JSON.stringify(cfChecked))
  return found
}
