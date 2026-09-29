// CurseForge 맵(Worlds) 검색·다운로드. API 키가 있어야 한다.
// 키는 빌드할 때 넣은 것(.env의 CURSEFORGE_KEY, 섞어서 넣는다)을 먼저 쓰고, 없으면 사용자가 넣은 키(userData/curseforge-key.txt)를 쓴다.
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import type { MapFile, MapHit, MapSort, ModSearchHit, ModpackBrowseHit, ModpackBrowseOptions, ModpackSort, ModpackVersion } from '../shared-types'
import { downloadFile, HEADERS } from './download'
import { registerPing, watchSite } from './sitestatus'
import { tempRoot } from './worldzip'

const API = 'https://api.curseforge.com/v1'
const GAME_MINECRAFT = 432
const CLASS_WORLDS = 17
const keyFile = (): string => path.join(app.getPath('userData'), 'curseforge-key.txt')

// 빌드할 때 섞어서 넣은 키를 푼다 (섞는 쪽: build-tools/cfkey.mjs. MASK가 같아야 한다)
declare const __CF_KEY_ENC__: string
const MASK = 'mc-server-manager/cf'
let builtCache: string | null | undefined
function builtKey(): string | null {
  if (builtCache !== undefined) return builtCache
  const enc = typeof __CF_KEY_ENC__ === 'string' ? __CF_KEY_ENC__ : ''
  builtCache = enc ? Buffer.from([...Buffer.from(enc, 'base64').reverse()].map((b, i) => b ^ MASK.charCodeAt(i % MASK.length))).toString('utf8') : null
  return builtCache
}

function apiKey(): string | null {
  const built = builtKey()
  if (built) return built
  try {
    return fs.readFileSync(keyFile(), 'utf8').trim() || null
  } catch {
    return null
  }
}

export const hasCurseForgeKey = (): boolean => !!apiKey()
// 키가 어디서 왔는지 (앱 설정 창에 보여 주려고)
export const curseForgeKeySource = (): 'built' | 'user' | null => (builtKey() ? 'built' : apiKey() ? 'user' : null)
export function removeCurseForgeKey(): void {
  fs.rmSync(keyFile(), { force: true })
}

async function call<T>(url: string, key = apiKey(), body?: unknown): Promise<T> {
  if (!key) throw new Error('CurseForge API 키가 필요해요.')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20000)
  try {
    const res = await watchSite('curseforge', () =>
      fetch(API + url, {
      method: body ? 'POST' : 'GET',
      headers: { ...HEADERS, 'x-api-key': key, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal
    })
    )
    // 앱에 들어 있는 키가 막혔으면 사용자가 할 수 있는 게 없으니 잠시 못 쓴다고만 알린다 (Modrinth는 그대로 된다)
    if (res.status === 401 || res.status === 403)
      throw new Error(key === builtKey() ? 'CurseForge를 지금 쓸 수 없어요. Modrinth에서 찾아 주세요. (앱을 업데이트하면 다시 될 수 있어요)' : 'CurseForge API 키가 맞지 않아요.')
    if (!res.ok) throw new Error(`CurseForge에서 오류가 났어요 (${res.status}).`)
    return (await res.json()) as T
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('CurseForge 응답이 너무 느려요. 잠시 뒤에 다시 해 보세요.')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

// 연결 안 됨 표시를 풀려고 가볍게 물어볼 때 쓴다 (키가 없으면 CurseForge는 쓰지 않으므로 묻지 않는다)
registerPing('curseforge', async () => (apiKey() ? call('/games/432') : undefined))

// 키를 확인하고 저장한다
export async function setCurseForgeKey(key: string): Promise<void> {
  const k = String(key).trim()
  if (!/^[\w$./+=-]{20,200}$/.test(k)) throw new Error('API 키 모양이 아니에요.')
  await call('/games/' + GAME_MINECRAFT, k)
  fs.writeFileSync(keyFile(), k)
}

interface CfMod {
  id: number
  name: string
  summary: string
  downloadCount: number
  logo?: { thumbnailUrl?: string }
  links?: { websiteUrl?: string }
  authors?: { name: string }[]
  latestFilesIndexes?: { gameVersion: string }[]
  allowModDistribution?: boolean | null
}

// CurseForge 정렬 번호: 2 인기, 11 새로 올라온, 3 최근 업데이트, 6 다운로드 수, 4 이름
const SORT: Record<MapSort, [string, 'asc' | 'desc']> = {
  popular: ['2', 'desc'],
  newest: ['11', 'desc'],
  updated: ['3', 'desc'],
  downloads: ['6', 'desc'],
  name: ['4', 'asc']
}

export async function searchMaps(query: string, sort: MapSort, offset = 0): Promise<{ total: number; hits: MapHit[] }> {
  const q = new URLSearchParams({
    gameId: String(GAME_MINECRAFT),
    classId: String(CLASS_WORLDS),
    searchFilter: String(query).slice(0, 100),
    sortField: (SORT[sort] ?? SORT.popular)[0],
    sortOrder: (SORT[sort] ?? SORT.popular)[1],
    pageSize: '20',
    index: String(Math.max(0, Math.floor(offset)))
  })
  const res = await call<{ data: CfMod[]; pagination: { totalCount: number } }>('/mods/search?' + q)
  return {
    total: Math.min(res.pagination.totalCount, 10000), // CurseForge는 앞의 1만 개까지만 넘겨 볼 수 있다
    // 제작자가 다른 앱에서 받는 것을 막은 맵(allowModDistribution: false)은 받을 수 없어서 목록에서 뺀다
    hits: res.data.filter((m) => m.allowModDistribution !== false).map((m) => ({
      id: m.id,
      title: m.name,
      summary: m.summary,
      author: m.authors?.[0]?.name ?? '',
      downloads: m.downloadCount,
      iconUrl: m.logo?.thumbnailUrl ?? null,
      url: m.links?.websiteUrl ?? `https://www.curseforge.com/minecraft/worlds`,
      versions: [...new Set((m.latestFilesIndexes ?? []).map((f) => f.gameVersion))].filter((v) => /^\d/.test(v)).slice(0, 6)
    }))
  }
}

interface CfFile {
  id: number
  fileName: string
  displayName: string
  fileLength: number
  fileDate: string
  downloadUrl: string | null
  gameVersions: string[]
  hashes?: { value: string; algo: number }[] // algo 1 = SHA-1, 2 = MD5
}

// CurseForge가 알려 주는 SHA-1 (받은 파일이 깨지거나 바뀌지 않았는지 확인한다). 없으면 undefined
export const cfSha1 = (f: { hashes?: { value: string; algo: number }[] }): string | undefined =>
  f.hashes?.find((h) => h.algo === 1 && /^[0-9a-f]{40}$/i.test(h.value))?.value

export async function mapFiles(modId: number): Promise<MapFile[]> {
  const res = await call<{ data: CfFile[] }>(`/mods/${Math.floor(modId)}/files?pageSize=30`)
  return res.data
    .filter((f) => /\.zip$/i.test(f.fileName) && !!f.downloadUrl) // 받을 수 없는 파일은 보여 주지 않는다
    .map((f) => ({
      id: f.id,
      name: f.displayName || f.fileName,
      size: f.fileLength,
      date: Date.parse(f.fileDate),
      versions: f.gameVersions.filter((v) => /^\d/.test(v)),
      canDownload: !!f.downloadUrl // 제작자가 다른 앱에서 받는 것을 막았으면 null
    }))
}

// 받은 zip의 경로를 돌려준다
export async function downloadMap(modId: number, fileId: number, onBytes?: (done: number, total?: number) => void): Promise<string> {
  const res = await call<{ data: CfFile }>(`/mods/${Math.floor(modId)}/files/${Math.floor(fileId)}`)
  const f = res.data
  if (!f.downloadUrl) throw new Error('이 맵은 제작자가 다른 앱에서 받는 것을 막아 두었어요. CurseForge 사이트에서 받아서 zip으로 가져와 주세요.')
  if (!/^https:\/\/[^/]*(forgecdn\.net|curseforge\.com)\//.test(f.downloadUrl)) throw new Error('알 수 없는 다운로드 주소예요.')
  const dest = path.join(tempRoot(), `map-${f.id}.zip`)
  fs.mkdirSync(tempRoot(), { recursive: true })
  await downloadFile({ url: f.downloadUrl, dest, onBytes, sha1: cfSha1(f) })
  return dest
}

// ---------- 모드팩(manifest.json)의 파일들 ----------
export interface PackFile {
  modId: number
  fileId: number
  fileName: string
  downloadUrl: string | null // 제작자가 다른 앱에서 받는 것을 막았으면 null
  size: number
  sha1?: string
  clientOnly: boolean // 파일에 "Client"만 표시돼 있으면 서버에는 필요 없다
}

export async function packFiles(fileIds: number[]): Promise<PackFile[]> {
  const out: PackFile[] = []
  for (let i = 0; i < fileIds.length; i += 500) {
    const res = await call<{ data: (CfFile & { modId: number })[] }>('/mods/files', apiKey(), { fileIds: fileIds.slice(i, i + 500) })
    for (const f of res.data) {
      const env = f.gameVersions.map((v) => v.toLowerCase())
      out.push({
        modId: f.modId,
        fileId: f.id,
        fileName: f.fileName,
        downloadUrl: f.downloadUrl,
        size: f.fileLength,
        sha1: cfSha1(f),
        clientOnly: env.includes('client') && !env.includes('server')
      })
    }
  }
  return out
}

export async function modNames(modIds: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>()
  if (!modIds.length) return map
  const res = await call<{ data: { id: number; name: string }[] }>('/mods', apiKey(), { modIds })
  for (const m of res.data) map.set(m.id, m.name)
  return map
}

// ---------- 모드팩 찾아보기 (classId 4471) ----------
const CLASS_MODPACKS = 4471
// 로더 번호: 1 Forge, 4 Fabric, 5 Quilt, 6 NeoForge
const LOADER_TYPE: Record<string, number> = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 }
const LOADER_NAME: Record<number, string> = { 1: 'forge', 4: 'fabric', 5: 'quilt', 6: 'neoforge' }
// 정렬: 1 추천, 2 인기, 3 최근 업데이트, 6 다운로드 수, 11 새로 올라온
const PACK_SORT: Record<ModpackSort, string> = { relevance: '1', downloads: '6', follows: '2', newest: '11', updated: '3' }

interface CfPack {
  id: number
  name: string
  summary: string
  downloadCount: number
  dateModified: string
  logo?: { thumbnailUrl?: string }
  authors?: { name: string }[]
  categories?: { name: string }[]
  latestFilesIndexes?: { gameVersion: string; modLoader?: number }[]
  allowModDistribution?: boolean | null
}

export async function browseModpacks(o: ModpackBrowseOptions): Promise<{ total: number; hits: ModpackBrowseHit[] }> {
  const q = new URLSearchParams({
    gameId: String(GAME_MINECRAFT),
    classId: String(CLASS_MODPACKS),
    searchFilter: String(o.query ?? '').slice(0, 100),
    sortField: PACK_SORT[o.sort] ?? '1',
    sortOrder: 'desc',
    pageSize: '20',
    index: String(Math.max(0, Math.floor(o.offset)))
  })
  if (o.gameVersion) q.set('gameVersion', o.gameVersion)
  // CurseForge는 로더를 하나만 거를 수 있다 (여러 개 고르면 첫 번째)
  const loader = o.loaders.map((l) => LOADER_TYPE[l]).find(Boolean)
  if (loader) q.set('modLoaderType', String(loader))
  const res = await call<{ data: CfPack[]; pagination: { totalCount: number } }>('/mods/search?' + q)
  return {
    total: Math.min(res.pagination.totalCount, 10000),
    hits: res.data
      .filter((m) => m.allowModDistribution !== false) // 다른 앱에서 받는 것을 막은 모드팩은 받을 수 없다
      .map((m) => ({
        projectId: String(m.id),
        title: m.name,
        description: m.summary,
        author: m.authors?.[0]?.name ?? '',
        iconUrl: m.logo?.thumbnailUrl ?? null,
        downloads: m.downloadCount,
        follows: 0,
        updated: Date.parse(m.dateModified),
        loaders: [...new Set((m.latestFilesIndexes ?? []).map((f) => LOADER_NAME[f.modLoader ?? 0]).filter(Boolean))],
        tags: (m.categories ?? []).map((c) => c.name).slice(0, 3),
        clientAndServer: true
      }))
  }
}

export async function modpackFiles(modId: number): Promise<ModpackVersion[]> {
  const res = await call<{ data: (CfFile & { releaseType?: number })[] }>(`/mods/${Math.floor(modId)}/files?pageSize=40`)
  return res.data
    .filter((f) => /\.zip$/i.test(f.fileName) && !!f.downloadUrl)
    .map((f) => ({
      id: String(f.id),
      versionNumber: f.displayName || f.fileName,
      gameVersions: f.gameVersions.filter((v) => /^\d/.test(v)),
      loaders: f.gameVersions.map((v) => v.toLowerCase()).filter((v) => ['forge', 'fabric', 'quilt', 'neoforge'].includes(v)),
      type: f.releaseType === 2 ? 'beta' : f.releaseType === 3 ? 'alpha' : 'release',
      date: Date.parse(f.fileDate)
    }))
}

// 모드팩 zip을 받아 dest에 저장한다
export async function downloadPackFile(modId: number, fileId: number, dest: string): Promise<void> {
  const res = await call<{ data: CfFile }>(`/mods/${Math.floor(modId)}/files/${Math.floor(fileId)}`)
  const f = res.data
  if (!f.downloadUrl) throw new Error('이 모드팩은 제작자가 다른 앱에서 받는 것을 막아 두었어요.')
  if (!/^https:\/\/[^/]*(forgecdn\.net|curseforge\.com)\//.test(f.downloadUrl)) throw new Error('알 수 없는 다운로드 주소예요.')
  await downloadFile({ url: f.downloadUrl, dest, sha1: cfSha1(f) })
}

// ---------- 모드·플러그인·데이터팩 (모드 탭 등에서 쓰는 공통 기능) ----------
// 앱 안에서는 Modrinth ID와 섞이지 않게 CurseForge 번호 앞에 "cf:"를 붙여 쓴다
export const CF_PREFIX = 'cf:'
export const isCf = (id: string): boolean => id.startsWith(CF_PREFIX)
export const cfNum = (id: string): number => Number(id.slice(CF_PREFIX.length))
export const CF_CLASS = { mod: 6, plugin: 5, datapack: 6945 } as const
const CF_LOADER_TYPE: Record<string, number> = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 }
// 로더 이름 목록에서 CurseForge 로더 번호들 (Quilt 서버는 Fabric 모드도 된다)
export const cfLoaderTypes = (loaders: string[]): number[] => loaders.map((l) => CF_LOADER_TYPE[l]).filter(Boolean)

interface CfProject {
  id: number
  name: string
  slug: string
  summary: string
  downloadCount: number
  logo?: { thumbnailUrl?: string }
  authors?: { name: string }[]
  allowModDistribution?: boolean | null
}

export interface CfFileFull {
  id: number
  fileName: string
  displayName: string
  fileLength: number
  fileDate: string
  downloadUrl: string | null
  gameVersions: string[]
  releaseType: number // 1 정식, 2 베타, 3 알파
  hashes?: { value: string; algo: number }[]
  dependencies: { modId: number; relationType: number }[] // 3 = 꼭 필요
}

export async function searchProjects(o: { classId: number; query: string; gameVersion: string; loaderType?: number; offset: number }): Promise<{ total: number; hits: ModSearchHit[] }> {
  const q = new URLSearchParams({
    gameId: String(GAME_MINECRAFT),
    classId: String(o.classId),
    searchFilter: String(o.query ?? '').slice(0, 100),
    sortField: o.query.trim() ? '1' : '6', // 검색어가 없으면 다운로드 순
    sortOrder: 'desc',
    pageSize: '20',
    index: String(Math.max(0, Math.floor(o.offset))),
    gameVersion: o.gameVersion
  })
  if (o.loaderType) q.set('modLoaderType', String(o.loaderType))
  const res = await call<{ data: CfProject[]; pagination: { totalCount: number } }>('/mods/search?' + q)
  return {
    total: Math.min(res.pagination.totalCount, 10000),
    hits: res.data
      .filter((m) => m.allowModDistribution !== false) // 다른 앱에서 받는 것을 막은 것은 설치할 수 없다
      .map((m) => ({
        projectId: CF_PREFIX + m.id,
        slug: m.slug,
        title: m.name,
        description: m.summary,
        author: m.authors?.[0]?.name ?? '',
        iconUrl: m.logo?.thumbnailUrl ?? null,
        downloads: m.downloadCount,
        clientSide: 'unknown',
        serverSide: 'unknown'
      }))
  }
}

// 이 버전·로더에 맞는 파일 (최신순, 받을 수 있는 것만). 로더 번호를 앞에서부터 차례로 시도한다
export async function projectFiles(modId: number, gameVersion?: string, loaderTypes: number[] = []): Promise<CfFileFull[]> {
  for (const lt of loaderTypes.length ? loaderTypes : [0]) {
    const q = new URLSearchParams({ pageSize: '50' })
    if (gameVersion) q.set('gameVersion', gameVersion)
    if (lt) q.set('modLoaderType', String(lt))
    const res = await call<{ data: CfFileFull[] }>(`/mods/${Math.floor(modId)}/files?${q}`)
    const list = res.data.filter((f) => !!f.downloadUrl).sort((a, b) => Date.parse(b.fileDate) - Date.parse(a.fileDate))
    if (list.length) return list
  }
  return []
}

export async function getFile(modId: number, fileId: number): Promise<CfFileFull> {
  return (await call<{ data: CfFileFull }>(`/mods/${Math.floor(modId)}/files/${Math.floor(fileId)}`)).data
}

export async function projectsInfo(ids: number[]): Promise<Map<number, { name: string; icon: string | null }>> {
  const map = new Map<number, { name: string; icon: string | null }>()
  if (!ids.length) return map
  const res = await call<{ data: CfProject[] }>('/mods', apiKey(), { modIds: ids })
  for (const m of res.data) map.set(m.id, { name: m.name, icon: m.logo?.thumbnailUrl ?? null })
  return map
}

export const checkCfUrl = (url: string | null): string => {
  if (!url || !/^https:\/\/[^/]*(forgecdn\.net|curseforge\.com)\//.test(url)) throw new Error('CurseForge에서 받을 수 없는 파일이에요.')
  return url
}

// CurseForge 파일 지문: 공백 문자(9,10,13,32)를 뺀 바이트의 MurmurHash2 (seed 1)
export function fingerprintOf(buf: Buffer): number {
  const f = Buffer.allocUnsafe(buf.length)
  let len = 0
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i]
    if (b !== 9 && b !== 10 && b !== 13 && b !== 32) f[len++] = b
  }
  const m = 0x5bd1e995
  let h = (1 ^ len) >>> 0
  let i = 0
  while (len - i >= 4) {
    let k = f[i] | (f[i + 1] << 8) | (f[i + 2] << 16) | (f[i + 3] << 24)
    k = Math.imul(k, m)
    k ^= k >>> 24
    k = Math.imul(k, m)
    h = Math.imul(h, m) ^ k
    i += 4
  }
  switch (len - i) {
    case 3:
      h ^= f[i + 2] << 16
    // falls through
    case 2:
      h ^= f[i + 1] << 8
    // falls through
    case 1:
      h ^= f[i]
      h = Math.imul(h, m)
  }
  h ^= h >>> 13
  h = Math.imul(h, m)
  h ^= h >>> 15
  return h >>> 0
}

// 지문 -> { 모드 번호, 파일 }
export async function matchFingerprints(fps: number[]): Promise<Map<number, { modId: number; file: CfFileFull }>> {
  const map = new Map<number, { modId: number; file: CfFileFull }>()
  if (!fps.length || !hasCurseForgeKey()) return map
  const res = await call<{ data: { exactMatches: { id: number; file: CfFileFull & { fileFingerprint: number } }[] } }>('/fingerprints/432', apiKey(), { fingerprints: fps })
  for (const m of res.data.exactMatches) map.set(m.file.fileFingerprint, { modId: m.id, file: m.file })
  return map
}
