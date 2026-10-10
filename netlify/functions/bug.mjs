// 버그 제보 중계: 앱은 여기로 보내고, 디스코드 웹훅 주소는 Netlify 환경 변수(BUG_WEBHOOK)에만 둔다.
// 글(JSON)이나 사진·영상 한 개(multipart)만 받는다. 아무도 부르지 않게(@everyone 등) 항상 막는다
const NAME = 'MC CubePanel Bug Report'
const NO_MENTIONS = { parse: [] }
const MAX_FILE = 4 * 1024 * 1024 // Netlify 함수 요청 한도(6MB) 안에 들어가게
const TYPES = /\.(png|jpe?g|gif|webp|mp4|mov|webm)$/i

export default async (req) => {
  const hook = process.env.BUG_WEBHOOK
  if (!hook || !/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(hook)) return new Response('relay not configured', { status: 503 })
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })
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
  return new Response(res.ok ? 'ok' : 'discord error', { status: res.ok ? 200 : res.status === 429 ? 429 : 502 })
}

export const config = { path: '/api/bug' }
