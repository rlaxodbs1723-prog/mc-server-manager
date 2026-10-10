// CurseForge 중계: 앱은 키 없이 여기로 묻고, 키는 환경 변수(CURSEFORGE_KEY)에서 붙인다.
// Netlify 함수(netlify/functions)와 Cloudflare Pages 함수(functions/)가 같이 쓴다
// 앱이 실제로 쓰는 주소만 받는다 (아무 요청이나 대신 보내 주지 않게)
const API = 'https://api.curseforge.com/v1'
const ALLOWED = [
  /^\/games\/432$/,
  /^\/mods\/search$/,
  /^\/mods$/,
  /^\/mods\/\d+(\/files(\/\d+)?)?$/,
  /^\/mods\/files$/,
  /^\/fingerprints\/432$/
]
const MAX_BODY = 200_000

export async function handleCf(req, env) {
  const key = env.CURSEFORGE_KEY
  if (!key) return new Response('relay not configured', { status: 503 })
  const url = new URL(req.url)
  const sub = url.pathname.replace(/^\/api\/cf/, '') || '/'
  if (!ALLOWED.some((re) => re.test(sub))) return new Response('not allowed', { status: 404 })
  if (req.method !== 'GET' && req.method !== 'POST') return new Response('method not allowed', { status: 405 })
  let body
  if (req.method === 'POST') {
    body = await req.text()
    if (body.length > MAX_BODY) return new Response('too large', { status: 413 })
  }
  const res = await fetch(API + sub + url.search, {
    method: req.method,
    headers: { 'x-api-key': key, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body
  })
  return new Response(res.body, { status: res.status, headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/json' } })
}
