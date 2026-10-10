// 알림함 중계: 디스코드의 공지 채널·패치노트 채널에 쓴 글을 앱에 보여 준다.
// 환경 변수: DISCORD_BOT_TOKEN(버그 답장과 같은 봇), NOTICE_CHANNEL_ID, PATCH_CHANNEL_ID
// 글의 첫 줄이 제목, 나머지가 내용이다. 많은 앱이 물어도 디스코드에는 3분에 한 번만 묻는다 (Cloudflare 캐시)
const DISCORD = 'https://discord.com/api/v10'
const CACHE_SEC = 180
const LIMIT = 30

async function channelPosts(raw, bot) {
  // 복사할 때 딸려 온 공백·줄바꿈은 떼고, 채널 링크를 통째로 넣었으면 마지막 번호를 쓴다
  const channel = String(raw ?? '').trim().match(/(\d{5,25})\/?$/)?.[1]
  if (!channel) return []
  const res = await fetch(`${DISCORD}/channels/${channel}/messages?limit=${LIMIT}`, { headers: { Authorization: `Bot ${bot}` } })
  if (!res.ok) throw new Error(`discord ${res.status}`)
  const list = await res.json()
  return list
    .filter((m) => !m.author?.bot && (m.content?.trim() || m.attachments?.length))
    .map((m) => {
      const [first, ...rest] = (m.content || '').trim().split('\n')
      return {
        id: m.id,
        date: String(m.timestamp).slice(0, 10),
        title: (first || '').slice(0, 200),
        body: rest.join('\n').trim().slice(0, 4000),
        files: (m.attachments || []).slice(0, 10).map((a) => ({ url: a.url, name: a.filename, type: a.content_type || '' }))
      }
    })
}

export async function handleInbox(req, env) {
  if (req.method !== 'GET') return new Response('method not allowed', { status: 405 })
  const bot = env.DISCORD_BOT_TOKEN
  if (!bot) return Response.json({ notices: [], patches: [] })
  // 설정 확인용: 채널 번호를 읽었는지와 디스코드 응답만 알려 준다 (비밀값은 보여 주지 않는다)
  if (new URL(req.url).searchParams.has('check')) {
    const look = async (raw) => {
      const id = String(raw ?? '').trim().match(/(\d{5,25})\/?$/)?.[1]
      if (!id) return { set: !!raw, id: false }
      const r = await fetch(`${DISCORD}/channels/${id}/messages?limit=5`, { headers: { Authorization: `Bot ${bot}` } })
      const list = r.ok ? await r.json() : []
      return { set: true, id: true, status: r.status, count: list.length, human: list.filter((m) => !m.author?.bot).length, withText: list.filter((m) => m.content?.trim()).length }
    }
    return Response.json({ notice: await look(env.NOTICE_CHANNEL_ID), patch: await look(env.PATCH_CHANNEL_ID) })
  }
  const cache = typeof caches !== 'undefined' ? caches.default : null
  const key = new Request(new URL('/api/inbox', req.url).toString())
  const hit = cache && (await cache.match(key))
  if (hit) return hit
  try {
    const [notices, patches] = await Promise.all([channelPosts(env.NOTICE_CHANNEL_ID, bot), channelPosts(env.PATCH_CHANNEL_ID, bot)])
    const res = new Response(JSON.stringify({ notices, patches }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${CACHE_SEC}` }
    })
    // 비어 있으면 (설정 중이거나 아직 글이 없으면) 기억하지 않아서 바로 다시 물을 수 있게 한다
    if (cache && (notices.length || patches.length)) await cache.put(key, res.clone())
    return res
  } catch {
    return new Response('discord error', { status: 502 })
  }
}
