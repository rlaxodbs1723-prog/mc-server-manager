// 이름 주소 중계: 앱이 "내서버" 같은 이름을 정하면 Cloudflare DNS에 내서버.<DOMAIN_BASE> 기록을 만들어 준다.
// 환경 변수: CF_DNS_TOKEN(DNS 편집 권한만 있는 Cloudflare 키), CF_ZONE_ID(도메인의 구역 번호), DOMAIN_BASE(기본 cubepanel.kr)
// - 주소는 요청한 사람의 공인 IP(cf-connecting-ip)로만 연결한다. 남이 정한 IP로 보내게 할 수 없다
// - 이름의 주인은 앱이 만든 비밀 열쇠로 가린다. 기록의 메모(comment)에 열쇠의 해시만 적어 두어서 따로 저장소(DB)가 필요 없다
// - 우리가 만든 기록(메모가 cp:로 시작)만 건드린다. 사이트 주소(www 등)나 남의 기록은 절대 바꾸지 않는다
// - 포트가 25565가 아니면 SRV 기록(_minecraft._tcp)도 만들어 주소만 써도 접속되게 한다
const API = 'https://api.cloudflare.com/client/v4'
const NAME_RE = /^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$/ // 3~20자: 영문 소문자, 숫자, 가운데 하이픈
const RESERVED = new Set([
  'www', 'api', 'app', 'mail', 'smtp', 'imap', 'pop', 'ftp', 'ns', 'ns1', 'ns2', 'admin', 'administrator', 'root', 'support', 'help', 'status', 'download', 'downloads',
  'cubepanel', 'cube', 'panel', 'mc', 'minecraft', 'mojang', 'microsoft', 'discord', 'official', 'staff', 'mod', 'moderator', 'dev', 'test', 'localhost', 'server', 'play', 'join'
])
const MAX_RECORDS = 900 // 무료 DNS의 기록 개수 한도에 닿기 전에 새 이름을 막는다
const MAX_PER_IP = 3 // 같은 인터넷 주소로 만들 수 있는 이름 수 (이름을 마구 선점하는 것을 막는다)
const DEFAULT_PORT = 25565

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

async function ownerTag(key) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`cubepanel-domain:${key}`))
  return 'cp:' + [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}

export async function handleDomain(req, env, doFetch = fetch) {
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  const token = env.CF_DNS_TOKEN
  const zone = env.CF_ZONE_ID
  if (!token || !zone) return json({ error: 'not-configured' }, 503)
  const base = String(env.DOMAIN_BASE || 'cubepanel.kr').toLowerCase()

  let body
  try {
    const text = await req.text()
    if (text.length > 1024) return json({ error: 'big' }, 413)
    body = JSON.parse(text)
  } catch {
    return json({ error: 'bad-request' }, 400)
  }
  const action = body?.action
  const name = String(body?.name ?? '').toLowerCase()
  const key = String(body?.key ?? '')
  const port = body?.port == null ? DEFAULT_PORT : Number(body.port)
  if (action !== 'claim' && action !== 'release') return json({ error: 'bad-request' }, 400)
  if (!NAME_RE.test(name)) return json({ error: 'name' }, 400)
  if (RESERVED.has(name)) return json({ error: 'reserved' }, 400)
  if (!/^[0-9a-f]{32}$/.test(key)) return json({ error: 'bad-request' }, 400)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return json({ error: 'port' }, 400)

  const ip = req.headers.get('cf-connecting-ip') || ''
  if (action === 'claim' && !/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) return json({ error: 'ipv4' }, 400) // 지금은 IPv4 주소만 연결한다

  const tag = await ownerTag(key)
  const host = `${name}.${base}`
  const srvName = `_minecraft._tcp.${host}`

  const cf = async (method, path, data) => {
    const res = await doFetch(`${API}/zones/${zone}/dns_records${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: data ? JSON.stringify(data) : undefined,
      signal: AbortSignal.timeout(10000)
    })
    const out = await res.json().catch(() => null)
    if (!out?.success) throw new Error(`cloudflare ${method} ${path} ${res.status}`)
    return out
  }
  const find = async (n) => (await cf('GET', `?name=${encodeURIComponent(n)}&per_page=100`)).result ?? []

  try {
    // 서버를 켤 때마다 불리므로 Cloudflare API 한도(5분에 1,200회)를 아끼려고 조회는 한꺼번에, 바뀐 것만 쓴다
    const have = (await Promise.all([find(host), find(srvName)])).flat()
    // 같은 이름에 우리가 만들지 않았거나 다른 주인의 기록이 하나라도 있으면 남의 이름이다
    if (have.some((r) => r.comment !== tag)) return json({ error: action === 'release' ? 'forbidden' : 'taken' }, action === 'release' ? 403 : 409)

    if (action === 'release') {
      for (const r of have) await cf('DELETE', `/${r.id}`)
      return json({ ok: true })
    }

    const a = have.find((r) => r.type === 'A')
    const srv = have.find((r) => r.type === 'SRV')
    if (!a) {
      const total = (await cf('GET', '?per_page=1')).result_info?.total_count ?? 0
      if (total >= MAX_RECORDS) return json({ error: 'full' }, 503)
      const mine = (await cf('GET', `?type=A&content=${encodeURIComponent(ip)}&per_page=100`)).result ?? []
      if (mine.filter((r) => String(r.comment || '').startsWith('cp:')).length >= MAX_PER_IP) return json({ error: 'limit' }, 429)
    }
    if (a && a.content === ip) {
      // 주소가 그대로면 쓰지 않는다
    } else if (a) await cf('PATCH', `/${a.id}`, { content: ip })
    else await cf('POST', '', { type: 'A', name: host, content: ip, ttl: 60, proxied: false, comment: tag })

    if (port !== DEFAULT_PORT) {
      const data = { priority: 0, weight: 5, port, target: host }
      if (srv && srv.data?.port === port) {
        // 포트가 그대로면 쓰지 않는다
      } else if (srv) await cf('PATCH', `/${srv.id}`, { data })
      else await cf('POST', '', { type: 'SRV', name: srvName, data, ttl: 60, comment: tag })
    } else if (srv) {
      await cf('DELETE', `/${srv.id}`)
    }
    return json({ ok: true, host, ip, port })
  } catch {
    return json({ error: 'dns' }, 502)
  }
}
