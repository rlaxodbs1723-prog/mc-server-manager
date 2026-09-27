// 모드팩으로 서버 만들기
// 모드팩을 받거나(Modrinth) 올리면(.mrpack / CurseForge zip) 풀어서 "설치 계획"(plan.json)을 만든다:
//   마인크래프트·로더 버전, 서버에 받을 파일 목록, 복사할 overrides 폴더
// 서버를 만들 때는 보통 서버처럼 로더를 설치한 뒤 이 계획대로 파일을 받고 복사한다 (installModpack)
import { app } from 'electron'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import type { ModpackBrowseHit, ModpackBrowseOptions, ModpackInfo, ModpackOrigin, ModpackVersion, Progress, Software } from '../shared-types'
import { throwIfCancelled } from './cancel'
import * as curseforge from './curseforge'
import { checkJars } from './clientjar'
import { suggestOff } from './mods'
import { downloadFile } from './download'
import * as modrinth from './modrinth'
import { extractZip } from './worldzip'
import { mergedSearch } from './merge'

const packRoot = (): string => path.join(app.getPath('userData'), 'modpack-temp')
const packDir = (id: string): string => path.join(packRoot(), id.replace(/[^\w-]/g, ''))

interface PlanFile {
  path: string // 서버 폴더 안 경로
  url: string
  sha1?: string
  size?: number
}
interface Plan {
  name: string
  mcVersion: string
  software: Software
  loaderVersion: string
  files: PlanFile[]
  overrides: string[] // 순서대로 서버 폴더에 덮어쓸 폴더 (packDir 기준)
  versionName?: string // 모드팩 안에 적힌 버전 이름
  skipped: number
  manual: string[] // 받을 수 없어서 직접 넣어야 하는 모드 이름
  origin?: Omit<ModpackOrigin, 'installedAt'>
}

// ---------- 찾아보기 (Modrinth 사이트처럼) ----------
interface RawHit {
  project_id: string
  title: string
  description: string
  author: string
  icon_url: string | null
  downloads: number
  follows: number
  date_modified: string
  categories: string[]
  display_categories?: string[]
  client_side: string
  server_side: string
}

const LOADER_KEYS = ['fabric', 'forge', 'neoforge', 'quilt']

// 모드팩도 Modrinth와 CurseForge를 같이 찾는다 (offset은 page 번호)
export async function browseModpacks(o: ModpackBrowseOptions): Promise<{ total: number; more: boolean; hits: ModpackBrowseHit[] }> {
  return mergedSearch(
    o.offset,
    () => browseModrinth({ ...o, offset: o.offset * 20 }),
    () => curseforge.browseModpacks({ ...o, offset: o.offset * 20 }),
    o.site
  )
}

async function browseModrinth(o: ModpackBrowseOptions): Promise<{ total: number; hits: ModpackBrowseHit[] }> {
  const facets: string[][] = [['project_type:modpack'], ['server_side:required', 'server_side:optional']]
  if (o.gameVersion) facets.push([`versions:${o.gameVersion}`])
  if (o.loaders.length) facets.push(o.loaders.filter((l) => LOADER_KEYS.includes(l)).map((l) => `categories:${l}`))
  const params = new URLSearchParams({
    query: String(o.query ?? '').slice(0, 100),
    facets: JSON.stringify(facets),
    index: ['relevance', 'downloads', 'follows', 'newest', 'updated'].includes(o.sort) ? o.sort : 'relevance',
    offset: String(Math.max(0, Math.floor(o.offset))),
    limit: '20'
  })
  const data = await modrinth.apiGet<{ total_hits: number; hits: RawHit[] }>(`/search?${params}`)
  return {
    total: data.total_hits,
    hits: data.hits.map((h) => ({
      projectId: h.project_id,
      title: h.title,
      description: h.description,
      author: h.author,
      iconUrl: h.icon_url || null,
      downloads: h.downloads,
      follows: h.follows,
      updated: Date.parse(h.date_modified),
      loaders: h.categories.filter((c) => LOADER_KEYS.includes(c)),
      tags: (h.display_categories ?? h.categories).filter((c) => !LOADER_KEYS.includes(c)).slice(0, 3),
      clientAndServer: h.client_side !== 'unsupported' && h.server_side !== 'unsupported'
    }))
  }
}

// 게임 버전 필터에 쓸 정식 버전 목록
let versionCache: string[] | null = null
export async function gameVersions(): Promise<string[]> {
  if (versionCache) return versionCache
  versionCache = await modrinth.releaseVersions()
  return versionCache
}

export async function modpackVersions(projectId: string, source = 'modrinth'): Promise<ModpackVersion[]> {
  if (source === 'curseforge') return curseforge.modpackFiles(Number(projectId))
  const list = await modrinth.getAllVersions(projectId)
  return list
    .filter((v) => v.file && /\.mrpack$/i.test(v.file.fileName))
    .sort((a, b) => Date.parse(b.datePublished) - Date.parse(a.datePublished))
    .slice(0, 40)
    .map((v) => ({ id: v.id, versionNumber: v.versionNumber, gameVersions: v.gameVersions, loaders: v.loaders, type: v.versionType, date: Date.parse(v.datePublished) }))
}

// ---------- 준비: 받거나 올린 모드팩을 풀고 계획을 만든다 ----------
const newId = (): string => crypto.randomBytes(6).toString('hex')

export async function prepareFromModrinth(versionId: string): Promise<ModpackInfo> {
  const v = await modrinth.getVersion(versionId)
  if (!v.file || !/\.mrpack$/i.test(v.file.fileName)) throw new Error('모드팩 파일(.mrpack)이 없는 버전이에요.')
  const id = newId()
  const file = path.join(packDir(id), 'pack.mrpack')
  fs.mkdirSync(packDir(id), { recursive: true })
  await downloadFile({ url: v.file.url, dest: file, sha1: v.file.sha1 ?? undefined })
  return prepareFile(id, file, { source: 'modrinth', projectId: v.projectId, versionId: v.id, versionName: v.versionNumber })
}

// CurseForge 모드팩을 받아서 준비한다
export async function prepareFromCurseForge(modId: number, fileId: number): Promise<ModpackInfo> {
  const id = newId()
  const file = path.join(packDir(id), 'pack.zip')
  fs.mkdirSync(packDir(id), { recursive: true })
  await curseforge.downloadPackFile(modId, fileId, file)
  return prepareFile(id, file, { source: 'curseforge', projectId: String(modId), versionId: String(fileId) })
}

// 사용자가 올린 파일 (.mrpack 또는 CurseForge 모드팩 .zip)
export async function prepareFromUpload(source: string): Promise<ModpackInfo> {
  const src = path.resolve(String(source))
  if (!fs.existsSync(src) || !/\.(mrpack|zip)$/i.test(src)) throw new Error('모드팩 파일(.mrpack 또는 .zip)을 넣어 주세요.')
  const id = newId()
  fs.mkdirSync(packDir(id), { recursive: true })
  return prepareFile(id, src)
}

async function prepareFile(id: string, file: string, origin: Omit<ModpackOrigin, 'installedAt' | 'name'> = { source: 'file' }): Promise<ModpackInfo> {
  const dir = packDir(id)
  const unpacked = path.join(dir, 'pack')
  try {
    await extractZip(file, unpacked)
    let plan: Plan
    if (fs.existsSync(path.join(unpacked, 'modrinth.index.json'))) plan = planModrinth(unpacked)
    else if (fs.existsSync(path.join(unpacked, 'manifest.json'))) plan = await planCurseForge(unpacked)
    else throw new Error('모드팩 파일이 아니에요. (modrinth.index.json이나 manifest.json이 없어요) 서버 팩이면 폴더를 직접 쓰는 게 좋아요.')
    plan.origin = { ...origin, name: plan.name, versionName: origin.versionName ?? plan.versionName }
    fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(plan))
    return {
      packId: id,
      name: plan.name,
      mcVersion: plan.mcVersion,
      software: plan.software,
      loaderVersion: plan.loaderVersion,
      modCount: plan.files.length,
      skipped: plan.skipped,
      manual: plan.manual
    }
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true })
    throw e
  }
}

const MR_LOADERS: [string, Software][] = [
  ['fabric-loader', 'fabric'],
  ['quilt-loader', 'quilt'],
  ['neoforge', 'neoforge'],
  ['forge', 'forge']
]
const ALLOWED_HOSTS = /^https:\/\/(cdn\.modrinth\.com|github\.com|raw\.githubusercontent\.com|gitlab\.com|objects\.githubusercontent\.com)\//

function planModrinth(dir: string): Plan {
  const index = JSON.parse(fs.readFileSync(path.join(dir, 'modrinth.index.json'), 'utf8')) as {
    name: string
    versionId?: string
    files: { path: string; hashes: { sha1?: string }; env?: { server?: string }; downloads: string[]; fileSize?: number }[]
    dependencies: Record<string, string>
  }
  const mcVersion = index.dependencies.minecraft
  if (!mcVersion) throw new Error('모드팩에 마인크래프트 버전 정보가 없어요.')
  const loader = MR_LOADERS.find(([k]) => index.dependencies[k])
  if (!loader) throw new Error('이 모드팩은 지원하지 않는 로더를 써요.')
  const server = index.files.filter((f) => f.env?.server !== 'unsupported') // "unsupported"는 게임하는 사람 전용
  return {
    name: index.name,
    versionName: index.versionId,
    mcVersion,
    software: loader[1],
    loaderVersion: index.dependencies[loader[0]],
    files: server.map((f) => {
      const url = f.downloads.find((u) => ALLOWED_HOSTS.test(u))
      if (!url) throw new Error(`허용되지 않은 곳에서 받는 파일이 있어요: ${f.path}`)
      return { path: f.path, url, sha1: f.hashes.sha1, size: f.fileSize }
    }),
    overrides: ['pack/overrides', 'pack/server-overrides'],
    skipped: index.files.length - server.length,
    manual: []
  }
}

// CurseForge manifest.json: { minecraft: { version, modLoaders: [{ id: "forge-47.2.0", primary }] }, files: [{ projectID, fileID, required }], overrides }
async function planCurseForge(dir: string): Promise<Plan> {
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as {
    name: string
    version?: string
    minecraft: { version: string; modLoaders: { id: string; primary?: boolean }[] }
    files: { projectID: number; fileID: number; required?: boolean }[]
    overrides?: string
  }
  if (!curseforge.hasCurseForgeKey()) throw new Error('CurseForge 모드팩은 CurseForge API 키가 필요해요. 맵 다운로드 화면에서 먼저 연결해 주세요.')
  const ml = (m.minecraft.modLoaders.find((l) => l.primary) ?? m.minecraft.modLoaders[0])?.id ?? ''
  const [, kind, ver] = /^(forge|neoforge|fabric|quilt)-(.+)$/.exec(ml) ?? []
  if (!kind) throw new Error(`이 모드팩은 지원하지 않는 로더를 써요 (${ml || '알 수 없음'}).`)
  const wanted = m.files.filter((f) => f.required !== false)
  const files = await curseforge.packFiles(wanted.map((f) => f.fileID))
  const server = files.filter((f) => !f.clientOnly)
  const blocked = server.filter((f) => !f.downloadUrl)
  const names = await curseforge.modNames(blocked.map((f) => f.modId))
  return {
    name: m.name,
    versionName: m.version,
    mcVersion: m.minecraft.version,
    software: kind as Software,
    loaderVersion: kind === 'neoforge' && /^1\.20\.1-/.test(ver) ? ver.replace(/^1\.20\.1-/, '') : ver,
    files: server
      .filter((f) => f.downloadUrl && /^https:\/\/[^/]*forgecdn\.net\//.test(f.downloadUrl))
      .map((f) => ({ path: `mods/${path.basename(f.fileName)}`, url: f.downloadUrl!, size: f.size })),
    overrides: [`pack/${m.overrides || 'overrides'}`],
    skipped: files.length - server.length,
    manual: blocked.map((f) => names.get(f.modId) ?? f.fileName)
  }
}

// ---------- 설치: 로더를 깐 서버 폴더에 계획대로 받고 복사한다 ----------
function inside(root: string, rel: string): string {
  const target = path.resolve(root, rel)
  if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error(`모드팩에 잘못된 경로가 있어요: ${rel}`)
  return target
}

// 설치한 모드팩이 무엇인지 돌려준다 (서버 정보에 적어 둔다)
export async function installModpack(folderPath: string, packId: string, report: (p: Progress) => void): Promise<ModpackOrigin | undefined> {
  const dir = packDir(packId)
  let plan: Plan
  try {
    plan = JSON.parse(fs.readFileSync(path.join(dir, 'plan.json'), 'utf8'))
  } catch {
    throw new Error('모드팩 준비 파일이 없어요. 모드팩을 다시 골라 주세요.')
  }
  const total = plan.files.reduce((n, f) => n + (f.size ?? 0), 0)
  let done = 0
  let count = 0
  const queue = [...plan.files]
  const worker = async (): Promise<void> => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      throwIfCancelled()
      await downloadFile({ url: f.url, dest: inside(folderPath, f.path), sha1: f.sha1 })
      done += f.size ?? 0
      count++
      report({ message: `모드팩 파일을 받고 있어요 (${count}/${plan.files.length})`, done, total: total || undefined, unit: 'bytes', phase: 'install' })
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))

  report({ message: '모드팩 설정 파일을 복사하고 있어요', phase: 'install' })
  for (const sub of plan.overrides) {
    const src = inside(dir, sub)
    if (fs.existsSync(src)) await fs.promises.cp(src, folderPath, { recursive: true, force: true })
  }
  // 모드팩에 섞여 온 클라이언트 전용 모드와 서버에서 튕기는 모드를 찾아 둔다 (끌지는 서버 화면에서 사용자에게 묻는다)
  const modsDir = path.join(folderPath, 'mods')
  if (fs.existsSync(modsDir)) {
    report({ message: '서버에 필요 없는 모드를 골라내고 있어요', phase: 'install' })
    const jars = fs.readdirSync(modsDir).filter((f) => /\.jar$/i.test(f)).map((f) => path.join(modsDir, f))
    const off = await checkJars(jars)
    suggestOff(folderPath, [...off].map(([jar, why]) => [path.basename(jar), why]))
  }
  fs.rmSync(dir, { recursive: true, force: true })
  return plan.origin && { ...plan.origin, installedAt: new Date().toISOString() }
}

export function cleanModpackTemp(): void {
  fs.rmSync(packRoot(), { recursive: true, force: true })
}
