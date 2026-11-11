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
  // 같은 GET 요청(인기 목록·모드 정보 등)은 잠깐 저장해 두고 바로 돌려준다. CurseForge가 한 번에 몇~십몇 초씩 걸려서
  // 모드 탭을 열 때마다 기다리게 된다. 저장소(Cloudflare 캐시)가 없는 곳(Netlify)에서는 그냥 매번 묻는다
  const ttl = req.method === 'GET' ? cacheSeconds(sub) : 0
  const cache = ttl ? globalThis.caches?.default : undefined
  const cacheKey = cache ? new Request(url.toString(), { method: 'GET' }) : undefined
  if (cache) {
    const hit = await cache.match(cacheKey).catch(() => undefined)
    if (hit) return hit
  }
  const res = await fetch(API + sub + url.search, {
    method: req.method,
    headers: { 'x-api-key': key, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body
  })
  const headers = { 'Content-Type': res.headers.get('Content-Type') || 'application/json' }
  if (!cache || !res.ok) return new Response(res.body, { status: res.status, headers })
  const text = await res.text()
  await cache.put(cacheKey, new Response(text, { status: 200, headers: { ...headers, 'Cache-Control': `public, max-age=${ttl}` } })).catch(() => undefined)
  return new Response(text, { status: res.status, headers })
}

// 얼마나 저장해 둘지 (초). 검색은 새 모드가 금방 보이게 짧게, 게임 정보는 거의 안 바뀐다
function cacheSeconds(sub) {
  if (sub === '/games/432') return 3600
  if (sub === '/mods/search') return 600
  if (/^\/mods\/\d+/.test(sub)) return 900
  return 0
}
