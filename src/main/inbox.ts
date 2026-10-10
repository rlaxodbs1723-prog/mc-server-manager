// 알림함: 디스코드의 공지·패치노트 채널에 쓴 글을 중계 서버(/api/inbox)에서 받아 온다.
import type { Inbox, InboxPost } from '../shared-types'

const URL_INBOX = process.env.MCSM_INBOX_URL ?? 'https://cubepanel.kr/api/inbox'
const CACHE_MS = 10 * 60 * 1000
let cache: { at: number; data: Inbox } | null = null

const DISCORD_FILE = /^https:\/\/(cdn|media)\.discordapp\.(com|net)\//

function clean(list: unknown): InboxPost[] {
  if (!Array.isArray(list)) return []
  return list.slice(0, 50).map((p) => ({
    id: String(p.id),
    date: String(p.date),
    title: String(p.title ?? ''),
    body: String(p.body ?? ''),
    files: (Array.isArray(p.files) ? p.files : [])
      .filter((f: { url?: unknown }) => DISCORD_FILE.test(String(f.url)))
      .map((f: { url: unknown; name: unknown; type: unknown }) => ({ url: String(f.url), name: String(f.name), type: String(f.type) }))
  }))
}

export async function getInbox(): Promise<Inbox> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data
  const res = await fetch(URL_INBOX, { signal: AbortSignal.timeout(10000) })
  if (!res.ok) throw new Error(`알림함을 불러오지 못했어요. (${res.status})`)
  const raw = (await res.json()) as { notices?: unknown; patches?: unknown }
  const data: Inbox = { notices: clean(raw.notices), patches: clean(raw.patches) }
  cache = { at: Date.now(), data }
  return data
}
