// Modrinth API (https://docs.modrinth.com/api/)
import type { ModSearchHit, Side } from '../shared-types'
import { HEADERS } from './download'
import { registerPing, watchSite } from './sitestatus'

const API = 'https://api.modrinth.com/v2'

// Modrinth가 가끔 잠깐 502·503을 돌려준다. 그럴 땐 1초, 2초 쉬고 두 번 더 해 본다
// 마지막 결과로 사이트 상태(연결 안 됨 표시)를 정한다
function withRetry(send: () => Promise<Response>): Promise<Response> {
  return watchSite('modrinth', async () => {
    for (let i = 0; ; i++) {
      const res = await send()
      if (![502, 503, 504].includes(res.status) || i >= 2) return res
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)))
    }
  })
}

// 다른 파일에서도 Modrinth에 물을 때는 이것을 쓴다 (다시 시도·연결 안 됨 표시가 같이 된다)
export async function apiGet<T>(pathAndQuery: string): Promise<T> {
  const res = await withRetry(() => fetch(`${API}${pathAndQuery}`, { headers: HEADERS, signal: AbortSignal.timeout(20_000) }))
  if (res.status === 429) throw new Error('Modrinth 요청이 너무 많아요. 잠시 후 다시 시도해 주세요.')
  if (!res.ok) throw new Error(`Modrinth 요청 실패 (${res.status})`)
  return (await res.json()) as T
}

async function apiPost<T>(pathAndQuery: string, body: unknown): Promise<T> {
  const res = await withRetry(() =>
    fetch(`${API}${pathAndQuery}`, {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000)
    })
  )
  if (res.status === 429) throw new Error('Modrinth 요청이 너무 많아요. 잠시 후 다시 시도해 주세요.')
  if (!res.ok) throw new Error(`Modrinth 요청 실패 (${res.status})`)
  return (await res.json()) as T
}

// 연결 안 됨 표시를 풀려고 가볍게 물어볼 때 쓴다
registerPing('modrinth', () => apiGet('/tag/loader'))

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
function checkId(id: string): string {
  if (!ID_RE.test(String(id))) throw new Error('잘못된 프로젝트/버전 ID예요.')
  return id
}

export interface SearchOptions {
  query: string
  projectType: 'mod' | 'plugin' | 'datapack' | 'modpack'
  mcVersion?: string // 없으면 모든 버전
  loaders?: string[] // 하나라도 맞으면 통과 (없으면 모두)
  offset?: number
  limit?: number
}

interface RawHit {
  project_id: string
  slug: string
  title: string
  description: string
  author: string
  icon_url: string | null
  downloads: number
  client_side: Side
  server_side: Side
}

// 서버에서 돌아가는(server_side가 required/optional) 것만 검색한다. 클라이언트 전용 모드는 여기서 빠진다.
export async function search(o: SearchOptions): Promise<{ total: number; hits: ModSearchHit[] }> {
  const facets = [
    [`project_type:${o.projectType}`],
    ...(o.mcVersion ? [[`versions:${o.mcVersion}`]] : []),
    ...(o.loaders?.length ? [o.loaders.map((l) => `categories:${l}`)] : []),
    ['server_side:required', 'server_side:optional']
  ]
  const params = new URLSearchParams({
    query: o.query.slice(0, 100),
    facets: JSON.stringify(facets),
    index: o.query.trim() ? 'relevance' : 'downloads', // 검색어가 없으면 인기순
    offset: String(Math.max(0, o.offset ?? 0)),
    limit: String(Math.min(50, Math.max(1, o.limit ?? 20)))
  })
  const data = await apiGet<{ total_hits: number; hits: RawHit[] }>(`/search?${params}`)
  return {
    total: data.total_hits,
    hits: data.hits
      // 검색 색인이 가끔 틀려서 한 번 더 거른다
      .filter((h) => h.server_side !== 'unsupported')
      .map((h) => ({
        projectId: h.project_id,
        slug: h.slug,
        title: h.title,
        description: h.description,
        author: h.author,
        iconUrl: h.icon_url || null,
        downloads: h.downloads,
        clientSide: h.client_side,
        serverSide: h.server_side
      }))
  }
}

export interface Project {
  projectId: string
  title: string
  iconUrl: string | null
  clientSide: Side
  serverSide: Side
}

export async function getProject(projectId: string): Promise<Project> {
  const p = await apiGet<{ id: string; title: string; icon_url: string | null; client_side: Side; server_side: Side }>(`/project/${checkId(projectId)}`)
  return { projectId: p.id, title: p.title, iconUrl: p.icon_url || null, clientSide: p.client_side, serverSide: p.server_side }
}

export interface Version {
  id: string
  projectId: string
  versionNumber: string
  versionType: 'release' | 'beta' | 'alpha'
  datePublished: string
  gameVersions: string[]
  loaders: string[]
  file: { url: string; fileName: string; sha1: string | null } | null
  dependencies: { projectId: string | null; versionId: string | null; type: 'required' | 'optional' | 'incompatible' | 'embedded' }[]
}

interface RawVersion {
  id: string
  project_id: string
  version_number: string
  version_type: Version['versionType']
  date_published: string
  game_versions: string[]
  loaders: string[]
  files: { url: string; filename: string; primary: boolean; size?: number; hashes?: { sha1?: string; sha512?: string } }[]
  dependencies: { project_id: string | null; version_id: string | null; dependency_type: Version['dependencies'][number]['type'] }[]
}

function toVersion(v: RawVersion): Version {
  const f = v.files.find((x) => x.primary) ?? v.files[0]
  return {
    id: v.id,
    projectId: v.project_id,
    versionNumber: v.version_number,
    versionType: v.version_type,
    datePublished: v.date_published,
    gameVersions: v.game_versions,
    loaders: v.loaders,
    file: f ? { url: f.url, fileName: f.filename, sha1: f.hashes?.sha1 ?? null } : null,
    dependencies: v.dependencies.map((d) => ({ projectId: d.project_id, versionId: d.version_id, type: d.dependency_type }))
  }
}

// 이 서버 버전·로더에 맞는 버전 목록 (정식 → 베타 → 알파, 각각 최신순)
export async function getCompatibleVersions(projectId: string, mcVersion: string, loaders: string[]): Promise<Version[]> {
  const params = new URLSearchParams({ game_versions: JSON.stringify([mcVersion]), loaders: JSON.stringify(loaders) })
  const list = (await apiGet<RawVersion[]>(`/project/${checkId(projectId)}/version?${params}`)).map(toVersion)
  const rank = { release: 0, beta: 1, alpha: 2 }
  return list.filter((v) => v.file).sort((a, b) => rank[a.versionType] - rank[b.versionType]) // 정렬은 안정적이라 최신순이 유지된다
}

export const searchAny = search

// 모든 버전 (모드팩처럼 버전을 가리지 않고 고를 때)
export async function getAllVersions(projectId: string): Promise<Version[]> {
  return (await apiGet<RawVersion[]>(`/project/${checkId(projectId)}/version`)).map(toVersion)
}

export async function getVersion(versionId: string): Promise<Version> {
  return toVersion(await apiGet<RawVersion>(`/version/${checkId(versionId)}`))
}

// 파일 지문(sha1)으로 어떤 모드의 어떤 버전인지 찾는다. 찾은 것만 돌려준다 (지문 -> 버전)
export async function versionsByHash(sha1s: string[]): Promise<Map<string, Version>> {
  const map = new Map<string, Version>()
  if (!sha1s.length) return map
  const data = await apiPost<Record<string, RawVersion>>('/version_files', { hashes: sha1s, algorithm: 'sha1' })
  for (const [hash, v] of Object.entries(data)) map.set(hash, toVersion(v))
  return map
}

// 정식 마인크래프트 버전 목록 (모드팩 찾아보기의 버전 필터)
export async function releaseVersions(): Promise<string[]> {
  const list = await apiGet<{ version: string; version_type: string }[]>('/tag/game_version')
  return list.filter((v) => v.version_type === 'release').map((v) => v.version)
}

export async function getProjects(ids: string[]): Promise<Project[]> {
  if (!ids.length) return []
  const list = await apiGet<{ id: string; title: string; icon_url: string | null; client_side: Side; server_side: Side }[]>(
    `/projects?ids=${encodeURIComponent(JSON.stringify(ids.map(checkId)))}`
  )
  return list.map((p) => ({ projectId: p.id, title: p.title, iconUrl: p.icon_url || null, clientSide: p.client_side, serverSide: p.server_side }))
}

// mrpack을 만들 때 쓰는 파일 정보 (버전 번호 -> 주 파일)
export interface PackFileInfo {
  url: string
  fileName: string
  size: number
  sha1: string
  sha512: string
}

export async function versionFiles(versionIds: string[]): Promise<Map<string, PackFileInfo>> {
  const map = new Map<string, PackFileInfo>()
  for (let i = 0; i < versionIds.length; i += 100) {
    const ids = versionIds.slice(i, i + 100).map(checkId)
    const list = await apiGet<RawVersion[]>(`/versions?ids=${encodeURIComponent(JSON.stringify(ids))}`)
    for (const v of list) {
      const f = v.files.find((x) => x.primary) ?? v.files[0]
      if (f?.hashes?.sha1 && f.hashes.sha512)
        map.set(v.id, { url: f.url, fileName: f.filename, size: f.size ?? 0, sha1: f.hashes.sha1, sha512: f.hashes.sha512 })
    }
  }
  return map
}
