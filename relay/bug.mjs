// 버그 제보 중계: 앱은 여기로 보내고, 디스코드 웹훅 주소는 환경 변수(BUG_WEBHOOK)에만 둔다.
// Netlify 함수(netlify/functions)와 Cloudflare Pages 함수(functions/)가 같이 쓴다
// 글(JSON)이나 사진·영상 한 개(multipart)만 받는다. 아무도 부르지 않게(@everyone 등) 항상 막는다
// 답장: 디스코드에서 제보 메시지에 "답장"하면, 앱이 /api/bug/replies로 물어서 받아 간다.
//   답장을 읽으려면 봇이 필요하다 (환경 변수 DISCORD_BOT_TOKEN, 채널에서 메시지 기록 읽기 권한 + Message Content Intent)
const NAME = 'MC CubePanel Bug Report'
const NO_MENTIONS = { parse: [] }
const MAX_FILE = 4 * 1024 * 1024 // Netlify 함수 요청 한도(6MB) 안에 들어가게
const TYPES = /\.(png|jpe?g|gif|webp|mp4|mov|webm)$/i
const DISCORD = 'https://discord.com/api/v10'
const PAGES = 5 // 답장을 찾을 때 제보 뒤로 최대 500개 메시지까지 본다
let channelId = null

// 제보한 앱만 그 제보의 답장을 볼 수 있게 표를 준다 (웹훅 주소를 비밀 열쇠로 쓴다)
// Web Crypto라서 Node(Netlify)와 Cloudflare 둘 다에서 돈다
async function ticket(hook, id) {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(hook), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`bug-reply:${id}`)))
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// 길이가 같은 두 글자를 시간 차이 없이 비교한다
function same(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

async function send(req, hook) {
  const type = req.headers.get('content-type') || ''
  let body
  if (type.startsWith('application/json')) {
    let msg
    try {
      msg = JSON.parse(await req.text())
    } catch {
      return new Response('bad json', { status: 400 })
    }
    if (!Array.isArray(msg?.embeds) || msg.embeds.length !== 1) return new Response('bad report', { status: 400 })
    body = JSON.stringify({ username: NAME, allowed_mentions: NO_MENTIONS, embeds: msg.embeds })
  } else if (type.startsWith('multipart/form-data')) {
    const form = await req.formData()
    const file = form.get('files[0]')
    if (!file || typeof file === 'string' || !TYPES.test(file.name) || file.size > MAX_FILE) return new Response('bad file', { status: 400 })
    body = new FormData()
    body.append('payload_json', JSON.stringify({ username: NAME, allowed_mentions: NO_MENTIONS }))
    body.append('files[0]', file, file.name)
  } else return new Response('bad type', { status: 415 })
  const res = await fetch(`${hook}?wait=true`, {
    method: 'POST',
    body,
    headers: typeof body === 'string' ? { 'Content-Type': 'application/json' } : undefined
  })
  if (!res.ok) return new Response('discord error', { status: res.status === 429 ? 429 : 502 })
  // 글 제보에는 답장을 받아 갈 번호와 표를 돌려준다
  const sent = await res.json().catch(() => null)
  return sent?.id && typeof body === 'string' ? json({ id: sent.id, ticket: await ticket(hook, sent.id) }) : new Response('ok')
}

async function replies(url, hook, bot) {
  if (!bot) return json({ replies: [] }) // 봇을 아직 안 넣었으면 답장 없음
  const id = url.searchParams.get('id') || ''
  const given = url.searchParams.get('ticket') || ''
  if (!/^\d{5,25}$/.test(id) || !same(given, await ticket(hook, id)))
    return new Response('forbidden', { status: 403 })
  // 웹훅이 보내는 채널 (웹훅 주소만 있으면 인증 없이 알 수 있다). 함수가 살아 있는 동안 기억한다
  channelId ??= await fetch(hook).then((r) => (r.ok ? r.json() : null)).then((w) => w?.channel_id ?? null).catch(() => null)
  if (!channelId) return new Response('relay not configured', { status: 503 })
  const headers = { Authorization: `Bot ${bot}` }
  const found = []
  let after = id
  for (let i = 0; i < PAGES; i++) {
    const res = await fetch(`${DISCORD}/channels/${channelId}/messages?after=${after}&limit=100`, { headers })
    if (res.status === 429) return new Response('busy', { status: 429 })
    if (!res.ok) return new Response('discord error', { status: 502 })
    const page = await res.json()
    if (!page.length) break
    for (const m of page)
      if (m.message_reference?.message_id === id && !m.author?.bot && m.content?.trim())
        found.push({ id: m.id, text: m.content.slice(0, 2000), at: m.timestamp })
    after = page.reduce((max, m) => (BigInt(m.id) > BigInt(max) ? m.id : max), after) // 다음 쪽
    if (page.length < 100) break
  }
  found.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
  return json({ replies: found })
}

export async function handleBug(req, env) {
  const hook = env.BUG_WEBHOOK
  if (!hook || !/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(hook)) return new Response('relay not configured', { status: 503 })
  const url = new URL(req.url)
  if (url.pathname.endsWith('/replies')) return req.method === 'GET' ? replies(url, hook, env.DISCORD_BOT_TOKEN) : new Response('method not allowed', { status: 405 })
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })
  return send(req, hook)
}
