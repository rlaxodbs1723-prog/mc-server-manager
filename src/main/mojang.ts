import type { McVersion } from '../shared-types'
import { fetchJson } from './download'

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
const CACHE_TTL_MS = 10 * 60 * 1000

interface Manifest {
  latest: { release: string; snapshot: string }
  versions: (McVersion & { sha1: string })[]
}

// 버전별 상세 정보 (필요한 부분만)
export interface VersionMeta {
  id: string
  javaVersion?: { component: string; majorVersion: number }
  downloads: { server?: { url: string; sha1: string; size: number } }
}

let cache: { at: number; data: Manifest } | null = null

async function fetchManifest(): Promise<Manifest> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data
  const data = await fetchJson<Manifest>(MANIFEST_URL)
  cache = { at: Date.now(), data }
  return data
}

export async function getVersions(includeSnapshots: boolean): Promise<McVersion[]> {
  const manifest = await fetchManifest()
  return manifest.versions
    .filter((v) => v.type === 'release' || (includeSnapshots && v.type === 'snapshot'))
    .map(({ id, type, url, releaseTime }) => ({ id, type, url, releaseTime }))
}

export async function getVersionMeta(mcVersion: string): Promise<VersionMeta> {
  const entry = (await fetchManifest()).versions.find((v) => v.id === mcVersion)
  if (!entry) throw new Error(`알 수 없는 마인크래프트 버전: ${mcVersion}`)
  return fetchJson<VersionMeta>(entry.url)
}
