import { nameKey, sameMod, type SearchSite } from '../shared-types'
// Modrinth와 CurseForge 검색 결과를 한 목록으로 합친다.
// 한 페이지에 양쪽을 20개씩 받아 번갈아 섞고, 이름이 같은 것은 Modrinth 쪽만 남긴다 (서버에 필요한지 정보가 있어서).
import { hasCurseForgeKey } from './curseforge'

// 이름 비교용 (대소문자·기호 무시)
export const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9가-힣]/g, '')

// 이 ID가 어느 사이트 것인지 (CurseForge는 "cf:"로 시작)
const siteOf = (projectId: string): string => (projectId.startsWith('cf:') ? 'curseforge' : 'modrinth')

// 설치된 것과 이름이 같은 다른 사이트 결과인지. 같은 모드일 수도 있어서 설치 전에 한 번 물어본다
export function sameNameOtherSite(installed: { projectId: string; title: string }[]): (hit: { projectId: string; title: string }) => boolean {
  const byName = new Map<string, Set<string>>()
  for (const t of installed) {
    const k = nameKey(t.title) // 막지 않고 한 번 물어보기만 하니, 로더 이름을 뺀 이름이 같아도 알려 준다
    byName.set(k, (byName.get(k) ?? new Set()).add(siteOf(t.projectId)))
  }
  return (h) => [...(byName.get(nameKey(h.title)) ?? [])].some((site) => site !== siteOf(h.projectId))
}

const PAGE = 20

export async function mergedSearch<T extends { title: string; author?: string }>(
  page: number,
  fromModrinth: () => Promise<{ total: number; hits: T[] }>,
  fromCurseForge: () => Promise<{ total: number; hits: T[] }>,
  site: SearchSite = 'all',
  // 같은 모드가 양쪽에 다 있을 때 CurseForge 쪽을 보여 줄지 (없으면 Modrinth 쪽. 서버에 필요한지 정보가 있어서)
  preferCf?: (mr: T, cf: T) => Promise<boolean>
): Promise<{ total: number; more: boolean; hits: (T & { source: 'modrinth' | 'curseforge' })[] }> {
  const useCf = hasCurseForgeKey() && site !== 'modrinth'
  const useMr = site !== 'curseforge'
  if (!useMr && !useCf) throw new Error('CurseForge API 키가 없어서 CurseForge에서 찾을 수 없어요.')
  const none = Promise.resolve({ total: 0, hits: [] as T[] })
  // 한쪽이 안 되면 다른 쪽 결과만 보여 준다. 둘 다 안 될 때만 오류
  const [mr, cr] = await Promise.allSettled([useMr ? fromModrinth() : none, useCf ? fromCurseForge() : none])
  if (mr.status === 'rejected' && (cr.status === 'rejected' || !useCf)) throw mr.reason
  if (cr.status === 'rejected' && !useMr) throw cr.reason
  const m = mr.status === 'fulfilled' ? mr.value : { total: 0, hits: [] as T[] }
  const c = cr.status === 'fulfilled' ? cr.value : { total: 0, hits: [] as T[] }
  const cOnly = c.hits.filter((h) => !m.hits.some((x) => sameMod(x, h)))
  // 양쪽에 다 있는 모드는 어느 쪽을 보여 줄지 고른다 (예: 한쪽에만 새 버전이 올라와 있으면 그쪽)
  const pick = await Promise.all(
    m.hits.map(async (x) => {
      const twin = c.hits.find((h) => sameMod(x, h))
      if (!twin || !preferCf) return null
      return (await preferCf(x, twin).catch(() => false)) ? twin : null
    })
  )
  const hits: (T & { source: 'modrinth' | 'curseforge' })[] = []
  for (let i = 0; i < Math.max(m.hits.length, cOnly.length); i++) {
    if (pick[i]) hits.push({ ...pick[i]!, source: 'curseforge' })
    else if (m.hits[i]) hits.push({ ...m.hits[i], source: 'modrinth' })
    if (cOnly[i]) hits.push({ ...cOnly[i], source: 'curseforge' })
  }
  // 어느 한쪽이라도 다음 페이지가 남아 있으면 더 불러온다
  const next = (page + 1) * PAGE
  return { total: m.total + c.total, more: next < m.total || next < c.total, hits }
}

// 같은 모드가 두 사이트에 다 있을 때 CurseForge 쪽을 쓸지.
// CurseForge 모드팩으로 만든 서버면 CurseForge (게임도 CurseForge에서 받았을 가능성이 높아서 버전이 맞는다).
// 아니면 이 서버 버전에 맞는 파일이 더 새로 올라온 쪽 (한쪽에만 새 버전이 올라오는 모드가 있다. 예: 1.12.2 CreativeCore)
export async function preferCurseForge(
  server: { modpack?: { source?: string } },
  _mrId: string,
  _cfId: string,
  mrFiles: () => Promise<{ datePublished: string }[]>,
  cfFiles: () => Promise<{ fileDate: string }[]>
): Promise<boolean> {
  const [m, c] = await Promise.all([mrFiles().catch(() => []), cfFiles().catch(() => [])])
  if (!c.length) return false // CurseForge에 맞는 파일이 없거나 받을 수 없게 막혀 있다
  if (!m.length || server.modpack?.source === 'curseforge') return true
  const newest = (xs: string[]): number => Math.max(...xs.map((d) => Date.parse(d) || 0))
  const DAY = 86_400_000
  return newest(c.map((f) => f.fileDate)) > newest(m.map((v) => v.datePublished)) + 3 * DAY // 조금 차이는 같은 버전을 두 곳에 올린 것
}
