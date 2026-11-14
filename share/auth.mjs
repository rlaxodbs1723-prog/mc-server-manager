// 로그인 (서버 공유를 쓰려면 필요). Cloudflare Durable Object(worker.mjs의 Auth)와 내 컴퓨터 시험용 중계(dev-relay.mjs)가 같이 쓴다.
//
// 흐름 (데스크톱 앱 로그인의 표준 방식: 내 컴퓨터 주소로 돌아오기 + PKCE)
//   1. 앱이 127.0.0.1의 빈 포트에서 기다리고, 무작위 verifier를 만든 뒤 브라우저로 연다:
//        /api/auth/<provider>/start?port=<포트>&challenge=<sha256(verifier) 16진수>
//   2. 중계가 Discord·Google 로그인 화면으로 보낸다
//   3. 로그인이 끝나면 /api/auth/<provider>/callback 으로 돌아오고, 중계가 계정을 확인한 뒤
//      브라우저를 http://127.0.0.1:<포트>/cb?c=<한 번 쓰는 코드> 로 보낸다
//   4. 앱이 POST /api/auth/token { c, verifier } 로 세션 토큰(30일)을 받는다
// 남이 만든 로그인 링크를 눌러도 브라우저가 "내 컴퓨터"로 돌아오고, verifier가 없으면 토큰을 못 받으므로 계정을 뺏기지 않는다.
// 비밀 값(세션 토큰·한 번 쓰는 코드)은 해시만 저장한다. 비밀번호는 받지 않는다 (로그인은 Discord·Google 화면에서 한다)
//
// 저장소 키: acct:<provider>:<id> 계정 · ss:<hash> 세션 · st:<state> 로그인 진행 중 · oc:<hash> 한 번 쓰는 코드

const SESSION_MS = 30 * 86400_000
const STATE_MS = 10 * 60_000
const CODE_MS = 5 * 60_000
const MAX_SESSIONS = 10 // 계정 하나에 기기 10대까지 (넘으면 오래된 것부터 로그아웃)

export async function hash(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`cubepanel-auth:${text}`))
  return hex(new Uint8Array(buf))
}
// PKCE: 앱이 보낸 challenge는 접두어 없는 sha256(verifier)
async function plainSha(text) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))))
}
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
const randomHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)))
const isHex = (s, len) => typeof s === 'string' && new RegExp(`^[0-9a-f]{${len}}$`).test(s)
const cleanName = (s) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 40) || '이름 없음'

// 로그인 방식들. env에 그 방식의 ID·비밀 값이 있어야 켜진다
export function realProviders(env) {
  const list = {}
  if (env.DISCORD_CLIENT_ID && env.DISCORD_SECRET) {
    list.discord = {
      authorize: (redirect, state) =>
        'https://discord.com/oauth2/authorize?' + new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, redirect_uri: redirect, response_type: 'code', scope: 'identify email', state }),
      async profile(code, redirect) {
        const tok = await postForm('https://discord.com/api/oauth2/token', { client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_SECRET, grant_type: 'authorization_code', code, redirect_uri: redirect })
        const me = await getJson('https://discord.com/api/users/@me', tok.access_token)
        const avatar = me.avatar ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=64` : ''
        return { id: String(me.id), name: me.global_name || me.username, email: me.verified ? me.email ?? '' : '', avatar }
      }
    }
  }
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_SECRET) {
    list.google = {
      authorize: (redirect, state) =>
        'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirect, response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account' }),
      async profile(code, redirect) {
        const tok = await postForm('https://oauth2.googleapis.com/token', { client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_SECRET, grant_type: 'authorization_code', code, redirect_uri: redirect })
        const me = await getJson('https://openidconnect.googleapis.com/v1/userinfo', tok.access_token)
        return { id: String(me.sub), name: me.name || (me.email ?? '').split('@')[0], email: me.email_verified ? me.email ?? '' : '', avatar: String(me.picture ?? '') }
      }
    }
  }
  return list
}

async function postForm(url, form) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams(form) })
  if (!res.ok) throw new Error(`token ${res.status}`)
  return res.json()
}
async function getJson(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`profile ${res.status}`)
  return res.json()
}

// store: { get(k), put(k, v), delete(k), list(prefix) → Map } (await 가능)
// base: 이 중계의 바깥 주소 (예: https://cubepanel.kr)
// adminKey: 관리자 통계(/api/auth/stats)를 여는 비밀 값 (없으면 통계는 닫혀 있다)
export async function handleAuth(req, { store, providers, base, adminKey = '', now = () => Date.now() }) {
  const url = new URL(req.url)
  const path = url.pathname.replace(/^\/api\/auth\//, '')

  // 관리자 통계: 숫자만 (이름·이메일 같은 개인 정보는 내보내지 않는다). Authorization: Bearer <ADMIN_KEY>
  if (path === 'stats' && req.method === 'GET') {
    const key = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '')
    if (!adminKey || key.length !== adminKey.length || !(await same(key, adminKey))) return json({ error: 'forbidden' }, 403)
    const t = now()
    const accts = [...(await store.list('acct:')).values()]
    const sessions = [...(await store.list('ss:')).values()].filter((x) => x?.exp > t)
    const byProvider = {}
    for (const a of accts) byProvider[a.provider] = (byProvider[a.provider] ?? 0) + 1
    const since = (ms) => accts.filter((a) => t - (a.created ?? 0) < ms).length
    return json({
      accounts: accts.length,
      byProvider,
      loggedInDevices: sessions.length,
      loggedInAccounts: new Set(sessions.map((x) => x.acct)).size,
      new1d: since(86400_000),
      new7d: since(7 * 86400_000),
      // 최근 30일 날짜별 새 가입 (한국 시간 기준 날짜)
      daily: Object.entries(
        accts.reduce((m, a) => {
          if (t - (a.created ?? 0) > 30 * 86400_000) return m
          const d = new Date((a.created ?? 0) + 9 * 3600_000).toISOString().slice(0, 10)
          m[d] = (m[d] ?? 0) + 1
          return m
        }, {})
      ).sort()
    })
  }

  // 쓸 수 있는 로그인 방식 (앱이 버튼을 만든다)
  if (path === 'providers' && req.method === 'GET') return json({ providers: Object.keys(providers) })

  // 1. 로그인 시작
  let m = /^([a-z]+)\/start$/.exec(path)
  if (m && req.method === 'GET') {
    const p = providers[m[1]]
    if (!p) return page('이 로그인 방식은 아직 쓸 수 없어요.', 404)
    const port = Number(url.searchParams.get('port'))
    const challenge = url.searchParams.get('challenge')
    if (!Number.isInteger(port) || port < 1024 || port > 65535 || !isHex(challenge, 64)) return page('잘못된 로그인 요청이에요. 앱에서 다시 눌러 주세요.', 400)
    await sweep(store, 'st:', now())
    const state = randomHex(16)
    await store.put(`st:${state}`, { provider: m[1], port, challenge, exp: now() + STATE_MS })
    return Response.redirect(p.authorize(`${base}/api/auth/${m[1]}/callback`, state), 302)
  }

  // 2. Discord·Google에서 돌아옴
  m = /^([a-z]+)\/callback$/.exec(path)
  if (m && req.method === 'GET') {
    const p = providers[m[1]]
    const state = url.searchParams.get('state') ?? ''
    const st = isHex(state, 32) ? await store.get(`st:${state}`) : null
    if (st) await store.delete(`st:${state}`)
    if (!p || !st || st.provider !== m[1] || st.exp < now()) return page('로그인 시간이 지났어요. 앱에서 다시 눌러 주세요.', 400)
    const back = (q) => Response.redirect(`http://127.0.0.1:${st.port}/cb?${new URLSearchParams(q)}`, 302)
    const code = url.searchParams.get('code')
    if (!code) return back({ error: 'cancel' }) // 로그인 화면에서 취소
    let prof
    try {
      prof = await p.profile(code, `${base}/api/auth/${m[1]}/callback`)
    } catch {
      return back({ error: 'provider' })
    }
    const id = `${m[1]}:${prof.id}`
    const old = await store.get(`acct:${id}`)
    await store.put(`acct:${id}`, { id, provider: m[1], name: cleanName(prof.name), email: String(prof.email ?? '').slice(0, 200), avatar: safeAvatar(prof.avatar), created: old?.created ?? now(), sessions: old?.sessions ?? [] })
    const c = randomHex(32)
    await sweep(store, 'oc:', now())
    await store.put(`oc:${await hash(c)}`, { acct: id, challenge: st.challenge, exp: now() + CODE_MS })
    return back({ c })
  }

  // 3. 앱이 세션 토큰을 받아 감
  if (path === 'token' && req.method === 'POST') {
    const body = await req.json().catch(() => ({}))
    if (!isHex(body.c, 64) || typeof body.verifier !== 'string' || body.verifier.length < 32 || body.verifier.length > 128) return json({ error: 'bad' }, 400)
    const key = `oc:${await hash(body.c)}`
    const oc = await store.get(key)
    if (!oc) return json({ error: 'bad' }, 400)
    await store.delete(key) // 한 번만 쓴다 (틀려도 지운다: 맞혀 보기 막기)
    if (oc.exp < now() || (await plainSha(body.verifier)) !== oc.challenge) return json({ error: 'bad' }, 400)
    const acct = await store.get(`acct:${oc.acct}`)
    if (!acct) return json({ error: 'bad' }, 400)
    const token = randomHex(32)
    const sh = await hash(token)
    await store.put(`ss:${sh}`, { acct: acct.id, exp: now() + SESSION_MS })
    acct.sessions = [...(acct.sessions ?? []), sh]
    while (acct.sessions.length > MAX_SESSIONS) await store.delete(`ss:${acct.sessions.shift()}`)
    await store.put(`acct:${acct.id}`, acct)
    return json({ token, account: pub(acct) })
  }

  // 4. 로그인한 사람만
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '')
  const who = await verify(store, token, now)
  if (path === 'me' && req.method === 'GET') return who ? json({ account: pub(who) }) : json({ error: 'login' }, 401)
  if (path === 'logout' && req.method === 'POST') {
    if (who) await dropSession(store, who, await hash(token))
    return json({ ok: true })
  }
  if (path === 'delete' && req.method === 'POST') {
    // 계정 지우기: 계정과 모든 기기의 로그인을 바로 지운다
    if (!who) return json({ error: 'login' }, 401)
    for (const sh of who.sessions ?? []) await store.delete(`ss:${sh}`)
    await store.delete(`acct:${who.id}`)
    return json({ ok: true })
  }
  return json({ error: 'not found' }, 404)
}

// 세션 토큰 → 계정 (없거나 지났으면 null). 15일 넘게 남지 않았으면 30일로 늘린다 (자주 쓰면 계속 로그인 유지)
export async function verify(store, token, now = () => Date.now()) {
  if (!isHex(token, 64)) return null
  const sh = await hash(token)
  const ss = await store.get(`ss:${sh}`)
  if (!ss) return null
  const acct = await store.get(`acct:${ss.acct}`)
  if (!acct || ss.exp < now()) {
    if (acct) await dropSession(store, acct, sh)
    else await store.delete(`ss:${sh}`)
    return null
  }
  if (ss.exp - now() < SESSION_MS / 2) await store.put(`ss:${sh}`, { ...ss, exp: now() + SESSION_MS })
  return acct
}

// 시험·개발용: 계정과 세션을 바로 만든다
export async function createSession(store, { provider, id, name }, now = () => Date.now()) {
  const acctId = `${provider}:${id}`
  const old = await store.get(`acct:${acctId}`)
  const token = randomHex(32)
  const sh = await hash(token)
  await store.put(`acct:${acctId}`, { id: acctId, provider, name: cleanName(name), email: '', created: old?.created ?? now(), sessions: [...(old?.sessions ?? []), sh] })
  await store.put(`ss:${sh}`, { acct: acctId, exp: now() + SESSION_MS })
  return token
}

async function dropSession(store, acct, sh) {
  await store.delete(`ss:${sh}`)
  acct.sessions = (acct.sessions ?? []).filter((x) => x !== sh)
  await store.put(`acct:${acct.id}`, acct)
}

// 지난 로그인 진행·한 번 쓰는 코드 치우기
async function sweep(store, prefix, t) {
  const list = await store.list(prefix)
  for (const [k, v] of list) if (v?.exp < t) await store.delete(k)
}

// 시간 차이 없이 비교 (해시끼리 비교한다)
async function same(a, b) {
  const [x, y] = await Promise.all([hash(a), hash(b)])
  let d = 0
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i)
  return d === 0
}

const pub = (a) => ({ id: a.id, provider: a.provider, name: a.name, avatar: a.avatar ?? '' })
// 프로필 사진은 Discord·Google 사진 서버 주소만 받는다
const safeAvatar = (u) => (/^https:\/\/(cdn\.discordapp\.com|lh3\.googleusercontent\.com)\//.test(String(u ?? '')) ? String(u).slice(0, 300) : '')
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const page = (msg, status) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MC CubePanel</title><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#101013;color:#f2f3f5;font-family:system-ui,'Malgun Gothic',sans-serif"><p>${msg}</p></body>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
  )
