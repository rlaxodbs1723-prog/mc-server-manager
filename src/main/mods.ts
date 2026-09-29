// 서버에 모드(Fabric/Quilt/Forge/NeoForge) 또는 플러그인(Paper/Purpur)을 Modrinth에서 받아 설치한다.
// 무엇을 왜 설치했는지는 서버 폴더의 .server-manager-mods.json에 적어 둔다. (필수 모드를 같이 지우기 위해)
import crypto from 'crypto'
import { app, dialog, shell, type BrowserWindow } from 'electron'
import yazl from 'yazl'
import fs from 'fs'
import path from 'path'
import type { InstallResult, InstalledMod, OffSuggestion, ModKindInfo, ModSearchHit, ModVersionItem, Software } from '../shared-types'
import { nameKey, type SearchSite } from '../shared-types'
import { checkJars, localInfo, type OffReason } from './clientjar'
import { downloadFile } from './download'
import * as modrinth from './modrinth'
import * as cf from './curseforge'
import { mergedSearch, sameNameOtherSite, squash } from './merge'
import { getState } from './runner'
import { readServerInfo, patchServerInfo } from './servers'

const TRACK_FILE = '.server-manager-mods.json'
const CLIENT_ONLY_FILE = '.server-manager-clientonly.json' // 서버에 안 맞아서 앱이 꺼 둔 파일 이름과 이유

function readOff(folderPath: string): Record<string, OffReason> {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(folderPath, CLIENT_ONLY_FILE), 'utf8'))
    if (Array.isArray(j)) return Object.fromEntries(j.map((f: string) => [f, 'client'])) // 예전 형식: 파일 이름 목록
    return j && typeof j === 'object' ? j : {}
  } catch {
    return {}
  }
}

// 앱이 꺼 둔 파일을 적어 둔다 (모드 탭에서 이유를 보여 주려고)
export function recordOff(folderPath: string, entries: [string, OffReason][]): void {
  if (!entries.length) return
  fs.writeFileSync(path.join(folderPath, CLIENT_ONLY_FILE), JSON.stringify({ ...readOff(folderPath), ...Object.fromEntries(entries) }))
}

// ---------- 끌지 물어볼 모드 ----------
// 서버에 맞지 않아 보이는 모드는 바로 끄지 않고 적어 두었다가, 서버 화면에서 끌지 물어본다
const SUGGEST_FILE = '.server-manager-suggest-off.json'

function readSuggest(folderPath: string): Record<string, OffReason> {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(folderPath, SUGGEST_FILE), 'utf8'))
    return j && typeof j === 'object' && !Array.isArray(j) ? j : {}
  } catch {
    return {}
  }
}

export function suggestOff(folderPath: string, entries: [string, OffReason][]): void {
  if (!entries.length) return
  fs.writeFileSync(path.join(folderPath, SUGGEST_FILE), JSON.stringify({ ...readSuggest(folderPath), ...Object.fromEntries(entries) }))
}

// 아직 켜져 있는 것만 (이미 끄거나 지운 것은 묻지 않는다)
export function offSuggestions(folderPath: string): OffSuggestion[] {
  const s = readSuggest(folderPath)
  if (!Object.keys(s).length) return []
  let dir: string
  try {
    dir = load(folderPath).dir
  } catch {
    return []
  }
  const track = readTrack(folderPath)
  return Object.entries(s)
    .filter(([f]) => fs.existsSync(path.join(dir, f)))
    .map(([fileName, reason]) => ({ fileName, reason, title: track.find((t) => t.fileName === fileName)?.title ?? fileName.replace(/\.jar$/i, '') }))
}

// 사용자가 켜 두기로 한 파일 (다시 묻지 않는다)
const KEEP_FILE = '.server-manager-keep-on.json'
function readKeep(folderPath: string): string[] {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(folderPath, KEEP_FILE), 'utf8'))
    return Array.isArray(j) ? j : []
  } catch {
    return []
  }
}

// 서버 켜기 전: 켜진 모드 중 아직 묻지 않은 것을 jar 안만 보고 검사한다. 끌지 물어볼 것이 있으면 true
export async function scanForOff(folderPath: string): Promise<boolean> {
  const { dir } = load(folderPath)
  if (!fs.existsSync(dir)) return false
  const keep = readKeep(folderPath) // 파일 이름과 "id:모드ID" (업데이트로 파일 이름이 바뀌어도 다시 묻지 않게)
  const skip = new Set([...keep, ...Object.keys(readOff(folderPath)), ...Object.keys(readSuggest(folderPath))])
  const jars: string[] = []
  for (const f of fs.readdirSync(dir).filter((x) => /\.jar$/i.test(x) && !skip.has(x))) {
    const id = (await localInfo(path.join(dir, f))).id
    if (!id || !skip.has(`id:${id}`)) jars.push(path.join(dir, f))
  }
  const off = await checkJars(jars, false)
  suggestOff(folderPath, [...off].map(([jar, why]) => [path.basename(jar), why]))
  return offSuggestions(folderPath).length > 0
}

// 고른 것만 끄고 목록을 비운다 (고르지 않은 것은 사용자가 켜 두기로 한 것이라 다시 묻지 않는다)
export function applyOffSuggestions(folderPath: string, fileNames: string[]): Promise<void> {
  return serial(folderPath, async () => {
    const s = readSuggest(folderPath)
    const pick = fileNames.filter((f) => f in s)
    const keep = Object.keys(s).filter((f) => !pick.includes(f))
    if (keep.length) {
      const { dir } = load(folderPath)
      const ids: string[] = []
      for (const f of keep) {
        const id = fs.existsSync(path.join(dir, f)) ? (await localInfo(path.join(dir, f))).id : null
        if (id) ids.push(`id:${id}`)
      }
      fs.writeFileSync(path.join(folderPath, KEEP_FILE), JSON.stringify([...new Set([...readKeep(folderPath), ...keep, ...ids])]))
    }
    if (pick.length) assertStopped(folderPath)
    const { dir } = load(folderPath)
    for (const f of pick) {
      const p = path.join(dir, f)
      if (fs.existsSync(p)) fs.renameSync(p, p + DISABLED)
    }
    recordOff(folderPath, pick.map((f) => [f, s[f]]))
    fs.rmSync(path.join(folderPath, SUGGEST_FILE), { force: true })
  })
}
const DISABLED = '.disabled'
const MAX_DEPTH = 5 // 필수 모드의 필수 모드… 순환을 막는 깊이 제한

interface Spec extends ModKindInfo {
  projectType: 'mod' | 'plugin'
  loaders: string[] // Modrinth 로더 이름. 하나라도 맞으면 설치할 수 있다
}

// 서버 종류에 맞는 폴더와 검색 조건. 바닐라는 null
function specOf(software: Software): Spec | null {
  switch (software) {
    case 'fabric':
      return { kind: '모드', folder: 'mods', projectType: 'mod', loaders: ['fabric'] }
    case 'quilt':
      return { kind: '모드', folder: 'mods', projectType: 'mod', loaders: ['quilt', 'fabric'] } // Quilt는 Fabric 모드도 돌린다
    case 'forge':
      return { kind: '모드', folder: 'mods', projectType: 'mod', loaders: ['forge'] }
    case 'neoforge':
      return { kind: '모드', folder: 'mods', projectType: 'mod', loaders: ['neoforge'] }
    case 'paper':
      return { kind: '플러그인', folder: 'plugins', projectType: 'plugin', loaders: ['paper', 'spigot', 'bukkit'] }
    case 'purpur':
      return { kind: '플러그인', folder: 'plugins', projectType: 'plugin', loaders: ['purpur', 'paper', 'spigot', 'bukkit'] }
    default:
      return null
  }
}

function load(folderPath: string) {
  const server = readServerInfo(folderPath)
  const spec = specOf(server.software ?? 'vanilla')
  if (!spec) throw new Error('Vanilla 서버에는 모드나 플러그인을 설치할 수 없어요. Fabric·Paper 같은 서버를 새로 만들어 주세요.')
  return { server, spec, dir: path.join(folderPath, spec.folder) }
}

export function modKind(folderPath: string): ModKindInfo | null {
  const spec = specOf(readServerInfo(folderPath).software ?? 'vanilla')
  return spec && { kind: spec.kind, folder: spec.folder }
}

// ---------- 설치 기록 ----------
interface Track {
  projectId: string
  versionId: string
  title: string
  iconUrl: string | null
  versionNumber: string
  fileName: string
  clientSide: string
  isDependency: boolean // 다른 것 때문에 자동으로 설치됨
  requiredBy: string[] // 이것을 필요로 하는 projectId들
}

function readTrack(folderPath: string): Track[] {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(folderPath, TRACK_FILE), 'utf8'))
    if (!Array.isArray(data)) return []
    // 폴더에서 파일을 직접 지웠으면 기록도 없는 것으로 본다 (그래야 다시 설치할 수 있다)
    const { dir } = load(folderPath)
    return (data as Track[]).filter((t) => fs.existsSync(path.join(dir, t.fileName)) || fs.existsSync(path.join(dir, t.fileName + DISABLED)))
  } catch {
    return []
  }
}
const writeTrack = (folderPath: string, list: Track[]): void =>
  fs.writeFileSync(path.join(folderPath, TRACK_FILE), JSON.stringify(list, null, 2))

function safeFileName(name: string): string {
  const base = path.basename(String(name ?? ''))
  if (!/\.jar$/i.test(base) || base.includes('..')) throw new Error('jar 파일만 설치할 수 있어요.')
  return base
}

function assertStopped(folderPath: string): void {
  if (getState(folderPath) !== 'stopped') throw new Error('서버가 켜져 있을 때는 바꿀 수 없어요. 먼저 서버를 꺼 주세요.')
}

// 같은 서버에 대한 변경은 한 번에 하나씩 처리한다. (설치 기록 파일을 동시에 고치면 서로 덮어쓴다)
const queues = new Map<string, Promise<unknown>>()
function serial<T>(folderPath: string, fn: () => Promise<T> | T): Promise<T> {
  const next = (queues.get(folderPath) ?? Promise.resolve()).catch(() => {}).then(fn)
  queues.set(folderPath, next)
  next.finally(() => queues.get(folderPath) === next && queues.delete(folderPath)).catch(() => {})
  return next
}

// ---------- 검색 ----------
// CurseForge는 서버 지원 여부를 알려 주지 않아서, 같은 모드를 Modrinth에서 찾아 보고 서버 미지원이면 뺀다.
// Modrinth에 없거나 확인이 안 되면 그대로 둔다
async function dropClientOnly(hits: ModSearchHit[]): Promise<ModSearchHit[]> {
  const slugs = [...new Set(hits.map((h) => h.slug).filter((x) => /^[A-Za-z0-9_-]{1,64}$/.test(x)))]
  if (!slugs.length) return hits
  try {
    const found = await modrinth.getProjects(slugs)
    const side = new Map(found.map((p) => [nameKey(p.title), p]))
    return hits.flatMap((h) => {
      const p = side.get(nameKey(h.title))
      if (!p) return [h]
      if (p.serverSide === 'unsupported') return []
      return [{ ...h, clientSide: p.clientSide, serverSide: p.serverSide }]
    })
  } catch {
    return hits
  }
}

// Modrinth와 CurseForge를 같이 찾는다 (page마다 양쪽 20개씩)
export async function search(folderPath: string, query: string, page = 0, site: SearchSite = 'all'): Promise<{ total: number; more: boolean; hits: ModSearchHit[] }> {
  const { server, spec } = load(folderPath)
  const track = readTrack(folderPath)
  const installed = new Set(track.map((t) => t.projectId))
  // 다른 사이트에서 이미 설치한 같은 모드도 설치됨으로 본다 (두 번 깔려서 크래시 나지 않게)
  const dupOf = sameNameOtherSite(track)
  const res = await mergedSearch(
    page,
    () => modrinth.search({ query, projectType: spec.projectType, mcVersion: server.mcVersion, loaders: spec.loaders, offset: page * 20, limit: 20 }),
    async () => {
      const r = await cf.searchProjects({
        classId: spec.projectType === 'plugin' ? cf.CF_CLASS.plugin : cf.CF_CLASS.mod,
        query,
        gameVersion: server.mcVersion,
        loaderType: spec.projectType === 'mod' ? cf.cfLoaderTypes(spec.loaders)[0] : undefined,
        offset: page * 20
      })
      return spec.projectType === 'mod' ? { ...r, hits: await dropClientOnly(r.hits) } : r
    },
    site
  )
  return {
    ...res,
    hits: res.hits
      .filter((h) => !isBaseMod(h.projectId) && !/^fabric api$|^qsl$/i.test(h.title)) // 기본 모드는 자동으로 깔리므로 검색에서 뺀다
      .map((h) => ({ ...h, installed: installed.has(h.projectId), sameNameInstalled: !installed.has(h.projectId) && dupOf(h) }))
  }
}

// ---------- 설치 ----------
interface Ctx {
  folderPath: string
  dir: string
  mcVersion: string
  spec: Spec
  track: Track[]
  result: InstallResult
}

const cfLoaders = (spec: Spec): number[] => (spec.projectType === 'mod' ? cf.cfLoaderTypes(spec.loaders) : [])

async function installOne(ctx: Ctx, projectId: string, pinnedVersionId: string | null, parentId: string | null, depth: number): Promise<void> {
  const existing = ctx.track.find((t) => t.projectId === projectId)
  if (existing) {
    // 이미 설치됨. 다른 항목이 이것을 필요로 한다는 기록만 남긴다
    if (parentId && !existing.requiredBy.includes(parentId)) existing.requiredBy.push(parentId)
    return
  }
  if (cf.isCf(projectId)) return installOneCf(ctx, projectId, parentId, depth)

  const project = await modrinth.getProject(projectId)
  // 다른 모드가 필요로 하는 부속 모드가 게임 화면 전용이면 서버에는 안 깔면 된다 (실패가 아니다)
  if (project.serverSide === 'unsupported' && parentId) return
  if (project.serverSide === 'unsupported') {
    throw new Error(`"${project.title}"은(는) 게임하는 사람 컴퓨터에만 설치하는 ${ctx.spec.kind}라서 서버에는 필요 없어요.`)
  }

  // 의존성이 특정 버전을 지정해도, 이 서버에 안 맞으면 맞는 최신 버전을 쓴다
  let version: modrinth.Version | undefined
  if (pinnedVersionId) {
    const pinned = await modrinth.getVersion(pinnedVersionId).catch(() => undefined)
    const fits = pinned?.gameVersions.includes(ctx.mcVersion) && pinned.loaders.some((l) => ctx.spec.loaders.includes(l))
    if (fits) version = pinned
  }
  version ??= (await modrinth.getCompatibleVersions(projectId, ctx.mcVersion, ctx.spec.loaders))[0]
  if (!version?.file) throw new Error(`"${project.title}"은(는) 이 서버(${ctx.mcVersion})에 맞는 버전이 없어요.`)

  const fileName = safeFileName(version.file.fileName)
  await downloadFile({ url: version.file.url, dest: path.join(ctx.dir, fileName), sha1: version.file.sha1 ?? undefined })
  ctx.track.push({
    projectId,
    versionId: version.id,
    title: project.title,
    iconUrl: project.iconUrl,
    versionNumber: version.versionNumber,
    fileName,
    clientSide: project.clientSide,
    isDependency: !!parentId,
    requiredBy: parentId ? [parentId] : []
  })
  writeTrack(ctx.folderPath, ctx.track) // 중간에 실패해도 받은 것까지는 기록이 남게
  ;(parentId ? ctx.result.dependencies : ctx.result.installed).push(project.title)

  // 필수 의존성을 같이 설치한다
  for (const dep of version.dependencies) {
    if (dep.type !== 'required' || !dep.projectId) continue
    if (depth >= MAX_DEPTH) continue
    try {
      await installOne(ctx, dep.projectId, dep.versionId, projectId, depth + 1)
    } catch (e) {
      // 의존성 하나를 못 받아도 본체는 남기고, 무엇이 빠졌는지 알려 준다
      ctx.result.failed.push((e as Error).message)
    }
  }
}

// CurseForge: 이 버전·로더에 맞는 최신 파일을 받고, 꼭 필요한 모드(relationType 3)도 같이 설치한다
async function installOneCf(ctx: Ctx, projectId: string, parentId: string | null, depth: number): Promise<void> {
  const modId = cf.cfNum(projectId)
  const info = (await cf.projectsInfo([modId])).get(modId)
  const file = (await cf.projectFiles(modId, ctx.mcVersion, cfLoaders(ctx.spec)))[0]
  const title = info?.name ?? projectId
  if (!file) throw new Error(`"${title}"은(는) 이 서버(${ctx.mcVersion})에 맞는 파일이 없거나, 다른 앱에서 받을 수 없게 막혀 있어요.`)
  const fileName = safeFileName(file.fileName)
  await downloadFile({ url: cf.checkCfUrl(file.downloadUrl), dest: path.join(ctx.dir, fileName), sha1: cf.cfSha1(file) })
  ctx.track.push({
    projectId,
    versionId: cf.CF_PREFIX + file.id,
    title,
    iconUrl: info?.icon ?? null,
    versionNumber: file.displayName || file.fileName,
    fileName,
    clientSide: 'unknown',
    isDependency: !!parentId,
    requiredBy: parentId ? [parentId] : []
  })
  writeTrack(ctx.folderPath, ctx.track)
  ;(parentId ? ctx.result.dependencies : ctx.result.installed).push(title)
  for (const dep of file.dependencies) {
    if (dep.relationType !== 3 || depth >= MAX_DEPTH) continue
    await installOne(ctx, cf.CF_PREFIX + dep.modId, null, projectId, depth + 1).catch((e) => ctx.result.failed.push((e as Error).message))
  }
}

export function install(folderPath: string, projectId: string): Promise<InstallResult> {
  return serial(folderPath, async () => {
    assertStopped(folderPath)
    const { server, spec, dir } = load(folderPath)
    fs.mkdirSync(dir, { recursive: true })
    const ctx: Ctx = {
      folderPath,
      dir,
      mcVersion: server.mcVersion,
      spec,
      track: readTrack(folderPath),
      result: { installed: [], dependencies: [], failed: [] }
    }
    const before = new Set(ctx.track.map((t) => t.fileName))
    await installOne(ctx, projectId, null, null, 0)
    writeTrack(folderPath, ctx.track)
    // 받은 파일 중 서버에서 튕기는 것은 적어 두고 끌지 물어본다 (검색 결과는 대부분 걸러지지만 모드 쪽 실수는 받아 봐야 안다)
    await suggestForNew(ctx, before)
    return ctx.result
  })
}

// ---------- 기본 모드 자동 설치 ----------
// 거의 모든 모드가 필요로 하는 기본 라이브러리. 서버를 만들 때 미리 깔아 둔다.
// Quilt 전용 QSL은 새 버전 지원이 끊겨서, 없으면 Fabric API를 쓴다(Quilt는 Fabric 모드를 돌린다).
const BASE_MODS: Partial<Record<Software, string[]>> = {
  fabric: ['P7dR8mSH'], // Fabric API
  quilt: ['qvIfYCYJ', 'P7dR8mSH'] // QSL, 없으면 Fabric API
}
const BASE_IDS = new Set(Object.values(BASE_MODS).flat())
// 기록이 없는 파일(직접 넣은 것)은 파일 이름으로 알아본다
const BASE_FILE = /^(fabric-api|qsl|quilted-fabric-api)[-_+]/i

function isBaseMod(projectId?: string, fileName?: string): boolean {
  return (!!projectId && BASE_IDS.has(projectId)) || (!!fileName && BASE_FILE.test(fileName))
}

// 설치했거나 이미 있으면 그 이름, 이 서버 버전에 맞는 것이 없으면 null
// onlyFirstTime: 이 앱으로 모드를 관리한 적이 없는 서버(설치 기록 파일이 없음)에만 설치한다.
//   이전에 만든 서버를 처음 켤 때 한 번 깔아 주고, 사용자가 일부러 지운 뒤에는 다시 깔지 않기 위해서다.
export function installBaseMods(folderPath: string, onlyFirstTime = false): Promise<string | null> {
  return serial(folderPath, async () => {
    const server = readServerInfo(folderPath)
    const candidates = BASE_MODS[server.software ?? 'vanilla'] ?? []
    if (!candidates.length) return null
    if (onlyFirstTime && fs.existsSync(path.join(folderPath, TRACK_FILE))) return null
    const { spec, dir } = load(folderPath)
    let track = readTrack(folderPath)
    // 기록은 있는데 파일이 없으면(폴더에서 직접 지움) 기록을 지우고 다시 받는다
    const exists = (t: Track): boolean => fs.existsSync(path.join(dir, t.fileName)) || fs.existsSync(path.join(dir, t.fileName + DISABLED))
    const stale = track.filter((t) => candidates.includes(t.projectId) && !exists(t))
    if (stale.length) {
      track = track.filter((t) => !stale.includes(t))
      writeTrack(folderPath, track)
    }
    const have = track.find((t) => candidates.includes(t.projectId))
    if (have) return have.title
    for (const projectId of candidates) {
      const versions = await modrinth.getCompatibleVersions(projectId, server.mcVersion, spec.loaders)
      if (!versions.length) continue
      // 이미 폴더에 직접 넣어 둔 경우엔 또 받지 않는다
      if (fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f === versions[0].file?.fileName)) return null
      fs.mkdirSync(dir, { recursive: true })
      const ctx: Ctx = { folderPath, dir, mcVersion: server.mcVersion, spec, track, result: { installed: [], dependencies: [], failed: [] } }
      await installOne(ctx, projectId, null, null, 0) // 직접 설치한 것으로 기록 → 다른 모드를 지워도 같이 지워지지 않는다
      writeTrack(folderPath, ctx.track)
      return ctx.result.installed[0] ?? null
    }
    return null
  })
}

// 서버 버전을 바꾼 뒤: 기본 모드가 새 버전에 맞지 않으면 빼고 새 버전에 맞는 것으로 다시 깐다.
// (기본 모드는 목록에 안 보여서 사용자가 직접 바꿀 수 없다) 새 버전에 맞는 것이 없으면 그대로 둔다
export async function refreshBaseMods(folderPath: string): Promise<void> {
  const ready = await serial(folderPath, async (): Promise<boolean> => {
    const server = readServerInfo(folderPath)
    const candidates = BASE_MODS[server.software ?? 'vanilla'] ?? []
    if (!candidates.length) return false
    const { spec, dir } = load(folderPath)
    let available = false
    for (const projectId of candidates) if ((await modrinth.getCompatibleVersions(projectId, server.mcVersion, spec.loaders)).length) available = true
    if (!available) return false // 새 버전에 맞는 기본 모드가 아직 없으면 다음에 다시 본다
    const track = readTrack(folderPath)
    const names = fs.existsSync(dir) ? fs.readdirSync(dir) : []
    const ok = new Set<string>()
    for (const t of track.filter((x) => candidates.includes(x.projectId))) {
      const fits = await modrinth.getCompatibleVersions(t.projectId, server.mcVersion, spec.loaders)
      if (fits.some((v) => v.id === t.versionId)) ok.add(t.fileName)
    }
    const old = names.filter((f) => {
      const fileName = f.endsWith(DISABLED) ? f.slice(0, -DISABLED.length) : f
      const t = track.find((x) => x.fileName === fileName)
      return isBaseMod(t?.projectId, fileName) && !ok.has(fileName)
    })
    if (!old.length) return true
    for (const f of old) fs.rmSync(path.join(dir, f), { force: true })
    writeTrack(folderPath, track.filter((t) => !old.some((f) => f === t.fileName || f === t.fileName + DISABLED)))
    return true
  })
  if (!ready) return
  await installBaseMods(folderPath)
  patchServerInfo(folderPath, { baseModsFor: readServerInfo(folderPath).mcVersion })
}

// ---------- 설치된 목록 ----------
export function list(folderPath: string): InstalledMod[] {
  const { dir } = load(folderPath)
  let names: string[] = []
  try {
    names = fs.readdirSync(dir).filter((f) => /\.jar(\.disabled)?$/i.test(f))
  } catch {
    return []
  }
  const track = readTrack(folderPath)
  const titleOf = (projectId: string) => track.find((t) => t.projectId === projectId)?.title ?? projectId
  const off = readOff(folderPath)
  return names
    .flatMap((name) => {
      const enabled = !name.endsWith(DISABLED)
      const fileName = enabled ? name : name.slice(0, -DISABLED.length)
      const t = track.find((x) => x.fileName === fileName)
      if (isBaseMod(t?.projectId, fileName)) return [] // 기본 모드는 앱이 알아서 관리하므로 목록에 안 보인다
      return [{
        fileName,
        enabled,
        title: t?.title ?? fileName.replace(/\.jar$/i, ''),
        versionNumber: t?.versionNumber ?? '',
        iconUrl: t?.iconUrl ?? null,
        clientRequired: t?.clientSide === 'required' && off[fileName] !== 'client', // 클라이언트 전용은 서버에 들어오는 데 필요 없다
        offReason: off[fileName] ?? null,
        requiredBy: (t?.requiredBy ?? []).map(titleOf),
        tracked: !!t
      }]
    })
    .sort((a, b) => a.title.localeCompare(b.title))
}

// 지우면, 이것 때문에 같이 설치됐고 이제 아무도 안 쓰는 의존성도 같이 지운다. 지운 이름들을 돌려준다.
export function remove(folderPath: string, fileName: string): Promise<string[]> {
  return serial(folderPath, () => {
    assertStopped(folderPath)
    const { dir } = load(folderPath)
    const base = safeFileName(fileName)
    let track = readTrack(folderPath)
    const removedNames: string[] = []

    const drop = (file: string, title: string): void => {
      fs.rmSync(path.join(dir, file), { force: true })
      fs.rmSync(path.join(dir, file + DISABLED), { force: true })
      removedNames.push(title)
    }

    const target = track.find((t) => t.fileName === base)
    drop(base, target?.title ?? base)
    if (target) {
      // 연쇄적으로 고아가 된 의존성까지 정리
      const queue = [target.projectId]
      track = track.filter((t) => t !== target)
      while (queue.length) {
        const gone = queue.shift()!
        for (const t of track) t.requiredBy = t.requiredBy.filter((x) => x !== gone)
        const orphans = track.filter((t) => t.isDependency && t.requiredBy.length === 0 && !isBaseMod(t.projectId))
        for (const o of orphans) {
          drop(o.fileName, o.title)
          queue.push(o.projectId)
        }
        track = track.filter((t) => !orphans.includes(t))
      }
    }
    writeTrack(folderPath, track)
    return removedNames
  })
}

export function setEnabled(folderPath: string, fileName: string, enabled: boolean): void {
  assertStopped(folderPath)
  const { dir } = load(folderPath)
  const on = path.join(dir, safeFileName(fileName))
  const off = on + DISABLED
  if (enabled && fs.existsSync(off)) fs.renameSync(off, on)
  if (!enabled && fs.existsSync(on)) fs.renameSync(on, off)
}

// ---------- 업데이트 ----------
// 앱으로 설치한 것(기록이 있는 것)만 확인한다. 파일 이름 -> 새 버전 이름
export async function checkUpdates(folderPath: string): Promise<Record<string, string>> {
  const { server, spec } = load(folderPath)
  const track = readTrack(folderPath)
  const found: Record<string, string> = {}
  const queue = [...track]
  const worker = async (): Promise<void> => {
    for (let t = queue.shift(); t; t = queue.shift()) {
      if (cf.isCf(t.projectId)) {
        const latest = (await cf.projectFiles(cf.cfNum(t.projectId), server.mcVersion, cfLoaders(spec)).catch(() => []))[0]
        if (latest && cf.CF_PREFIX + latest.id !== t.versionId) found[t.fileName] = latest.displayName || latest.fileName
        continue
      }
      const latest = (await modrinth.getCompatibleVersions(t.projectId, server.mcVersion, spec.loaders).catch(() => []))[0]
      if (latest?.file && latest.id !== t.versionId) found[t.fileName] = latest.versionNumber
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker)) // 6개씩 동시에 물어본다
  return found
}

// fileNames가 비어 있으면 업데이트할 수 있는 것 전부. 업데이트한 이름들을 돌려준다
// 설치된 모드 파일을 다른 버전으로 바꾼다 (켜짐/꺼짐 상태는 그대로). 새 버전이 필요로 하는 모드도 설치한다
async function swapFile(ctx: Ctx, t: Track, f: { versionId: string; versionNumber: string; fileName: string; url: string; sha1?: string }): Promise<void> {
  const { dir, folderPath } = ctx
  const newName = safeFileName(f.fileName)
  const wasDisabled = fs.existsSync(path.join(dir, t.fileName + DISABLED))
  const tmp = path.join(dir, newName + '.download')
  await downloadFile({ url: f.url, dest: tmp, sha1: f.sha1 })
  fs.rmSync(path.join(dir, t.fileName), { force: true })
  fs.rmSync(path.join(dir, t.fileName + DISABLED), { force: true })
  fs.renameSync(tmp, path.join(dir, newName + (wasDisabled ? DISABLED : '')))
  Object.assign(t, { versionId: f.versionId, versionNumber: f.versionNumber, fileName: newName })
  writeTrack(folderPath, ctx.track)
  if (!isBaseMod(t.projectId)) ctx.result.installed.push(t.title)
}

async function swapVersion(ctx: Ctx, t: Track, v: modrinth.Version): Promise<void> {
  if (!v.file) throw new Error('받을 파일이 없는 버전이에요.')
  await swapFile(ctx, t, { versionId: v.id, versionNumber: v.versionNumber, fileName: v.file.fileName, url: v.file.url, sha1: v.file.sha1 ?? undefined })
  for (const dep of v.dependencies) {
    if (dep.type !== 'required' || !dep.projectId) continue
    await installOne(ctx, dep.projectId, dep.versionId, t.projectId, 1).catch((e) => ctx.result.failed.push((e as Error).message))
  }
}

async function swapCfFile(ctx: Ctx, t: Track, file: cf.CfFileFull): Promise<void> {
  await swapFile(ctx, t, { versionId: cf.CF_PREFIX + file.id, versionNumber: file.displayName || file.fileName, fileName: file.fileName, url: cf.checkCfUrl(file.downloadUrl), sha1: cf.cfSha1(file) })
  for (const dep of file.dependencies) {
    if (dep.relationType !== 3) continue
    await installOne(ctx, cf.CF_PREFIX + dep.modId, null, t.projectId, 1).catch((e) => ctx.result.failed.push((e as Error).message))
  }
}

// 이 서버(마인크래프트 버전·로더)에 맞는 버전 목록. 앱으로 설치한 것만 가능
export async function versionsOf(folderPath: string, fileName: string): Promise<ModVersionItem[]> {
  const { server, spec } = load(folderPath)
  const t = readTrack(folderPath).find((x) => x.fileName === fileName)
  if (!t) throw new Error('직접 넣은 파일이라 버전을 바꿀 수 없어요.')
  if (cf.isCf(t.projectId)) {
    const files = await cf.projectFiles(cf.cfNum(t.projectId), server.mcVersion, cfLoaders(spec))
    return files.slice(0, 40).map((f) => ({
      id: cf.CF_PREFIX + f.id,
      versionNumber: f.displayName || f.fileName,
      type: f.releaseType === 2 ? 'beta' : f.releaseType === 3 ? 'alpha' : 'release',
      date: Date.parse(f.fileDate),
      current: cf.CF_PREFIX + f.id === t.versionId
    }))
  }
  const list = await modrinth.getCompatibleVersions(t.projectId, server.mcVersion, spec.loaders)
  return list
    .sort((a, b) => Date.parse(b.datePublished) - Date.parse(a.datePublished))
    .slice(0, 40)
    .map((v) => ({ id: v.id, versionNumber: v.versionNumber, type: v.versionType, date: Date.parse(v.datePublished), current: v.id === t.versionId }))
}

export function setVersion(folderPath: string, fileName: string, versionId: string): Promise<InstallResult> {
  return serial(folderPath, async () => {
    assertStopped(folderPath)
    const { server, spec, dir } = load(folderPath)
    const track = readTrack(folderPath)
    const t = track.find((x) => x.fileName === fileName)
    if (!t) throw new Error('직접 넣은 파일이라 버전을 바꿀 수 없어요.')
    const ctx: Ctx = { folderPath, dir, mcVersion: server.mcVersion, spec, track, result: { installed: [], dependencies: [], failed: [] } }
    const before = new Set(track.map((x) => x.fileName))
    if (cf.isCf(t.projectId)) {
      if (!cf.isCf(versionId)) throw new Error('다른 모드의 버전이에요.')
      await swapCfFile(ctx, t, await cf.getFile(cf.cfNum(t.projectId), cf.cfNum(versionId)))
    } else {
      const v = await modrinth.getVersion(versionId)
      if (v.projectId !== t.projectId) throw new Error('다른 모드의 버전이에요.')
      await swapVersion(ctx, t, v)
    }
    writeTrack(folderPath, track)
    await suggestForNew(ctx, before)
    return ctx.result
  })
}

export function updateMods(folderPath: string, fileNames: string[] = []): Promise<InstallResult> {
  return serial(folderPath, async () => {
    assertStopped(folderPath)
    const { server, spec, dir } = load(folderPath)
    const track = readTrack(folderPath)
    const ctx: Ctx = { folderPath, dir, mcVersion: server.mcVersion, spec, track, result: { installed: [], dependencies: [], failed: [] } }
    const before = new Set(track.map((x) => x.fileName))
    const targets = fileNames.length ? track.filter((t) => fileNames.includes(t.fileName)) : [...track]
    for (const t of targets) {
      try {
        if (cf.isCf(t.projectId)) {
          const latest = (await cf.projectFiles(cf.cfNum(t.projectId), server.mcVersion, cfLoaders(spec)))[0]
          if (latest && cf.CF_PREFIX + latest.id !== t.versionId) await swapCfFile(ctx, t, latest)
          continue
        }
        const latest = (await modrinth.getCompatibleVersions(t.projectId, server.mcVersion, spec.loaders))[0]
        if (!latest?.file || latest.id === t.versionId) continue
        await swapVersion(ctx, t, latest)
      } catch (e) {
        ctx.result.failed.push(`${t.title}: ${(e as Error).message}`)
      }
    }
    writeTrack(folderPath, track)
    await suggestForNew(ctx, before)
    return ctx.result
  })
}

// 새로 생긴 파일(업데이트·버전 바꾸기로 바뀐 것 포함) 중 서버에 맞지 않는 것은 끌지 물어볼 목록에 넣는다
async function suggestForNew(ctx: Ctx, before: Set<string>): Promise<void> {
  if (ctx.spec.projectType !== 'mod') return
  const added = ctx.track.filter((t) => !before.has(t.fileName)).map((t) => path.join(ctx.dir, t.fileName))
  const jars = added.filter((j) => fs.existsSync(j)) // 꺼 둔 모드는 끌 필요가 없다
  const off = await checkJars(jars).catch(() => new Map<string, OffReason>())
  suggestOff(ctx.folderPath, [...off].map(([jar, why]) => [path.basename(jar), why]))
}

// ---------- 튕김 창: 모드 ID로 설치 ----------

export async function installById(folderPath: string, modId: string): Promise<string> {
  if (!/^[\w-]{2,64}$/.test(modId)) throw new Error('잘못된 모드 ID예요.')
  const { server, spec } = load(folderPath)
  // 기본 모드(Fabric API 등)는 기본 모드 설치로 (기록을 정리하고 다시 받는다)
  if (modId === 'fabric-api' || modId === 'qsl') {
    const name = await installBaseMods(folderPath)
    if (name) return name
  }
  let projectId: string | null = null
  try {
    projectId = (await modrinth.getProject(modId)).projectId // Modrinth 주소 이름이 모드 ID와 같은 경우가 많다
  } catch {
    const res = await modrinth.search({ query: modId.replace(/[_-]/g, ' '), projectType: spec.projectType, mcVersion: server.mcVersion, loaders: spec.loaders, limit: 10 })
    projectId = res.hits.find((h) => squash(h.slug) === squash(modId) || squash(h.title) === squash(modId))?.projectId ?? null
  }
  if (!projectId) throw new Error(`Modrinth에서 "${modId}"을(를) 찾지 못했어요. CurseForge에만 있는 모드일 수 있어요.`)
  const r = await install(folderPath, projectId)
  if (r.failed.length) throw new Error(r.failed.join(' / '))
  return r.installed[0] ?? modId
}

// ---------- 끌어다 놓은 jar 넣기 ----------
export function addFile(folderPath: string, source: string): Promise<string> {
  return serial(folderPath, async () => {
    assertStopped(folderPath)
    const { dir, spec } = load(folderPath)
    const src = path.resolve(String(source))
    if (!fs.existsSync(src) || fs.statSync(src).isDirectory() || !/\.jar$/i.test(src)) throw new Error(`${spec.kind} 파일(.jar)만 넣을 수 있어요.`)
    const name = path.basename(src)
    const target = path.join(dir, name)
    if (fs.existsSync(target) || fs.existsSync(target + DISABLED)) throw new Error(`같은 이름의 파일이 이미 있어요: ${name}`)
    const why = spec.projectType === 'mod' ? (await checkJars([src])).get(src) : undefined
    fs.mkdirSync(dir, { recursive: true })
    await fs.promises.copyFile(src, target)
    if (why) suggestOff(folderPath, [[name, why]]) // 넣기는 하고, 끌지 물어본다
    return name
  })
}

// ---------- 기록 없는 모드 알아보기 ----------
// 모드팩으로 받았거나 직접 넣은 파일은 기록이 없어서 파일 이름만 보인다.
// 파일 지문(sha1)으로 Modrinth에 물어봐서 찾으면 기록을 만든다 (아이콘·이름·버전 바꾸기가 된다).
// 못 찾은 파일은 다시 묻지 않도록 적어 둔다.
const UNKNOWN_FILE = '.server-manager-unknown.json'
const UNKNOWN_CF_FILE = '.server-manager-unknown-cf.json'
const identifying = new Map<string, Promise<boolean>>()

function sha1Of(file: string): string {
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex')
}

// 새로 알아낸 것이 있으면 true
export function identify(folderPath: string): Promise<boolean> {
  const running = identifying.get(folderPath)
  if (running) return running
  const job = serial(folderPath, async () => {
    const { dir } = load(folderPath)
    if (!fs.existsSync(dir)) return false
    const track = readTrack(folderPath)
    const unknownPath = path.join(folderPath, UNKNOWN_FILE)
    let unknown: string[] = []
    try {
      unknown = JSON.parse(fs.readFileSync(unknownPath, 'utf8'))
    } catch {
      unknown = []
    }
    // CurseForge로도 찾아본 파일 (키가 없을 때 Modrinth에서만 못 찾은 파일은 나중에 CurseForge로 다시 찾는다)
    const cfCheckedPath = path.join(folderPath, UNKNOWN_CF_FILE)
    let cfChecked: string[] = []
    try {
      cfChecked = JSON.parse(fs.readFileSync(cfCheckedPath, 'utf8'))
    } catch {
      cfChecked = []
    }
    const known = new Set(track.map((t) => t.fileName))
    const present = fs
      .readdirSync(dir)
      .filter((f) => /\.jar(\.disabled)?$/i.test(f))
      .map((f) => f.replace(/\.disabled$/i, ''))
      .filter((f) => !known.has(f))
    const files = present.filter((f) => !unknown.includes(f))
    const retryCf = cf.hasCurseForgeKey() ? present.filter((f) => unknown.includes(f) && !cfChecked.includes(f)) : []
    if (!files.length && !retryCf.length) return false

    const hashes = new Map<string, string>() // 지문 -> 파일 이름
    for (const f of files) {
      const p = fs.existsSync(path.join(dir, f)) ? path.join(dir, f) : path.join(dir, f + DISABLED)
      hashes.set(sha1Of(p), f)
    }
    const versions = hashes.size ? await modrinth.versionsByHash([...hashes.keys()]) : new Map<string, modrinth.Version>()
    const projects = new Map((await modrinth.getProjects([...new Set([...versions.values()].map((v) => v.projectId))])).map((p) => [p.projectId, p]))
    let found = false
    const notOnModrinth: string[] = [...retryCf]
    for (const [hash, fileName] of hashes) {
      const v = versions.get(hash)
      const project = v && projects.get(v.projectId)
      if (!v || !project) {
        notOnModrinth.push(fileName)
        continue
      }
      track.push({
        projectId: v.projectId,
        versionId: v.id,
        title: project.title,
        iconUrl: project.iconUrl,
        versionNumber: v.versionNumber,
        fileName,
        clientSide: project.clientSide,
        isDependency: false,
        requiredBy: []
      })
      found = true
    }
    // CurseForge 키가 있으면 지문으로 한 번 더 찾는다 (CurseForge 모드팩에서 온 파일)
    const byFp = new Map<number, string>()
    if (notOnModrinth.length && cf.hasCurseForgeKey()) {
      for (const f of notOnModrinth) {
        const p = fs.existsSync(path.join(dir, f)) ? path.join(dir, f) : path.join(dir, f + DISABLED)
        byFp.set(cf.fingerprintOf(fs.readFileSync(p)), f)
      }
    }
    const matches = await cf.matchFingerprints([...byFp.keys()]).catch(() => new Map<number, { modId: number; file: cf.CfFileFull }>())
    const infos = await cf.projectsInfo([...new Set([...matches.values()].map((m) => m.modId))]).catch(() => new Map<number, { name: string; icon: string | null }>())
    for (const f of notOnModrinth) {
      const fp = [...byFp].find(([, name]) => name === f)?.[0]
      const m = fp != null ? matches.get(fp) : undefined
      if (!unknown.includes(f)) unknown.push(f)
      if (byFp.size && !cfChecked.includes(f)) cfChecked.push(f)
      if (!m) continue
      unknown.splice(unknown.indexOf(f), 1)
      track.push({
        projectId: cf.CF_PREFIX + m.modId,
        versionId: cf.CF_PREFIX + m.file.id,
        title: infos.get(m.modId)?.name ?? m.file.displayName,
        iconUrl: infos.get(m.modId)?.icon ?? null,
        versionNumber: m.file.displayName || m.file.fileName,
        fileName: f,
        clientSide: 'unknown',
        isDependency: false,
        requiredBy: []
      })
      found = true
    }
    writeTrack(folderPath, track)
    fs.writeFileSync(unknownPath, JSON.stringify(unknown))
    fs.writeFileSync(cfCheckedPath, JSON.stringify(cfChecked))
    return found
  }).finally(() => identifying.delete(folderPath))
  identifying.set(folderPath, job)
  return job
}

// ---------- 플레이어용 모드팩(.mrpack) 만들기 ----------
// 플레이어 컴퓨터에 필요한 모드만 담는다: Modrinth에서 알아본 모드는 받을 주소로, 모르는 jar는 파일째로(overrides/mods).
// 서버 전용 모드(client_side = unsupported)는 뺀다. 로더 버전은 서버와 똑같이 적는다.
const PACK_LOADER: Partial<Record<Software, string>> = { fabric: 'fabric-loader', quilt: 'quilt-loader', forge: 'forge', neoforge: 'neoforge' }

// format: mrpack = 런처에 넣는 모드팩 / zip = 플레이어가 mods 폴더에 풀어 넣는 모드 파일 묶음
export async function exportClientPack(folderPath: string, format: 'mrpack' | 'zip', win: BrowserWindow | null): Promise<string | null> {
  const { server, dir } = load(folderPath)
  const loaderKey = PACK_LOADER[server.software ?? 'vanilla']
  if (!loaderKey || !server.loaderVersion) throw new Error('모드 서버에서만 플레이어용 모드팩을 만들 수 있어요.')
  const base = `${server.name.replace(/[<>:"/\\|?*]/g, '')} (플레이어용)`
  const opts =
    format === 'zip'
      ? { title: '플레이어용 모드 묶음 저장', defaultPath: path.join(app.getPath('desktop'), `${base} mods.zip`), filters: [{ name: 'zip', extensions: ['zip'] }] }
      : { title: '플레이어용 모드팩 저장', defaultPath: path.join(app.getPath('desktop'), `${base}.mrpack`), filters: [{ name: 'Modrinth 모드팩', extensions: ['mrpack'] }] }
  const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
  if (res.canceled || !res.filePath) return null

  const track = readTrack(folderPath)
  // 켜진 모드 + 앱이 "서버에 안 맞아서" 꺼 둔 모드(클라이언트 전용 등. 플레이어에게는 필요하다). 사용자가 직접 끈 모드는 넣지 않는다
  const off = readOff(folderPath)
  const names = fs.existsSync(dir) ? fs.readdirSync(dir) : []
  const enabled = names.filter((f) => /\.jar$/i.test(f) || (/\.jar\.disabled$/i.test(f) && off[f.slice(0, -DISABLED.length)]))
    .map((f) => f.replace(/\.disabled$/i, ''))
  const diskPath = (f: string): string => (fs.existsSync(path.join(dir, f)) ? path.join(dir, f) : path.join(dir, f + DISABLED))
  const byFile = new Map(track.map((t) => [t.fileName, t]))
  const known = enabled.map((f) => byFile.get(f)).filter((t): t is Track => !!t && t.clientSide !== 'unsupported')
  const unknownJars = enabled.filter((f) => !byFile.has(f))

  // zip: 서버의 모드 파일을 그대로 묶는다 (플레이어는 풀어서 mods 폴더에 넣는다)
  if (format === 'zip') {
    await new Promise<void>((resolve, reject) => {
      const zip = new yazl.ZipFile()
      for (const f of [...known.map((t) => t.fileName), ...unknownJars]) zip.addFile(diskPath(f), f)
      zip.addBuffer(
        Buffer.from(
          `${server.name} 플레이어용 모드\r\n\r\n마인크래프트 ${server.mcVersion}, ${server.software} ${server.loaderVersion}을(를) 설치한 뒤\r\n이 파일들을 .minecraft/mods 폴더에 넣으세요.\r\n`
        ),
        '읽어 주세요.txt'
      )
      zip.end()
      zip.outputStream.pipe(fs.createWriteStream(res.filePath!)).on('close', () => resolve()).on('error', reject)
    })
    shell.showItemInFolder(res.filePath)
    return res.filePath
  }
  const infos = await modrinth.versionFiles(known.map((t) => t.versionId))

  const files = known.flatMap((t) => {
    const f = infos.get(t.versionId)
    if (!f) return []
    return [{ path: `mods/${f.fileName}`, hashes: { sha1: f.sha1, sha512: f.sha512 }, env: { client: 'required', server: 'required' }, downloads: [f.url], fileSize: f.size }]
  })
  const missing = known.filter((t) => !infos.has(t.versionId)).map((t) => t.fileName) // 주소를 못 얻은 것은 파일째로
  const index = {
    formatVersion: 1,
    game: 'minecraft',
    versionId: '1.0.0',
    name: `${server.name} (플레이어용)`,
    summary: 'CraftPanel이 만든 플레이어용 모드팩',
    files,
    dependencies: { minecraft: server.mcVersion, [loaderKey]: server.loaderVersion }
  }

  await new Promise<void>((resolve, reject) => {
    const zip = new yazl.ZipFile()
    zip.addBuffer(Buffer.from(JSON.stringify(index, null, 2)), 'modrinth.index.json')
    for (const f of [...unknownJars, ...missing]) zip.addFile(diskPath(f), `overrides/mods/${f}`)
    zip.end()
    const out = fs.createWriteStream(res.filePath!)
    zip.outputStream.pipe(out).on('close', () => resolve()).on('error', reject)
  })
  shell.showItemInFolder(res.filePath)
  return res.filePath
}
