// 이름 주소 중계: 앱이 "내서버" 같은 이름을 정하면 Cloudflare DNS에 내서버.<DOMAIN_BASE> 기록을 만들어 준다.
// 환경 변수: CF_DNS_TOKEN(DNS 편집 권한만 있는 Cloudflare 키), CF_ZONE_ID(도메인의 구역 번호), DOMAIN_BASE(기본 cubepanel.kr)
//   선택: DNS_LIMIT(영역의 기록 개수 한도, 기본 200), STALE_ONLINE_HOURS(켜 둔 채로 이만큼 소식이 없으면 기록을 치운다, 기본 12)
// 연결(binding): DB = Cloudflare D1 데이터베이스. 없으면 예전 방식(DNS 기록의 메모로만 주인을 가림)으로 동작한다
//
// 구조
// - "이름 예약"(누구 이름인가)은 D1에 저장하고, DNS 기록은 서버가 켜져 있는 동안만 둔다 → 한도(200)가 가입자 수가 아니라 동시에 켜진 서버 수가 된다
//   · claim: 이름을 예약(처음이면)하고 DNS 기록을 만든다/갱신한다 (앱이 서버를 켤 때, 켜져 있는 동안 주기적으로)
//   · offline: DNS 기록만 지우고 예약은 둔다 (서버를 끌 때)
//   · release: 예약과 DNS 기록을 모두 지운다 (서버를 지울 때·이름을 바꿀 때)
//   · check: 쓸 수 있는 이름인지만 알려 준다
// - 예약은 30일 넘게 안 쓰면 풀린다. 켜졌다고 하고 소식이 끊긴(앱이 꺼진) 기록은 자리가 모자랄 때 치운다
// - 주소는 요청한 사람의 공인 IP(cf-connecting-ip)로만 연결한다. 남이 정한 IP로 보내게 할 수 없다
// - 이름의 주인은 앱이 만든 비밀 열쇠로 가린다. D1과 DNS 메모(comment)에는 열쇠의 해시만 적는다
// - 우리가 만든 기록(메모가 cp:로 시작)만 건드린다. 사이트 주소(www 등)나 남의 기록은 절대 바꾸지 않는다
// - 포트가 25565가 아니면 SRV 기록(_minecraft._tcp)도 만들어 주소만 써도 접속되게 한다
const API = 'https://api.cloudflare.com/client/v4'
const NAME_RE = /^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$/ // 3~20자: 영문 소문자, 숫자, 가운데 하이픈
const RESERVED = new Set([
  'www', 'api', 'app', 'mail', 'smtp', 'imap', 'pop', 'ftp', 'ns', 'ns1', 'ns2', 'admin', 'administrator', 'root', 'support', 'help', 'status', 'download', 'downloads',
  'cubepanel', 'cube', 'panel', 'mc', 'minecraft', 'mojang', 'microsoft', 'discord', 'official', 'staff', 'mod', 'moderator', 'dev', 'test', 'localhost', 'server', 'play', 'join'
])
const TUNNEL_HOST_RE = /^([a-z0-9-]+\.)+(joinmc\.link|ply\.gg|playit\.gg|playit\.cloud)$/ // 터널로 보낼 때 허용하는 주소 (남의 사이트로 보내지 못하게)
const DEFAULT_LIMIT = 200 // 무료 요금제의 영역당 DNS 기록 개수 (사이트 자체 기록도 포함)
const IDLE_DAYS = 30 // 켜지 않은 채 이만큼 지나면 이름 예약이 풀린다
const DEFAULT_ONLINE_STALE_HOURS = 12
const BEAT_MS = 15 * 60_000 // 이 안에 다시 불린 서버는 D1에 또 쓰지 않는다 (앱이 주기적으로 부른다)
const MAX_SWEEP_DELETES = 12 // 한 번에 치우는 기록 수 (요청 하나가 쓸 수 있는 외부 요청 수를 넘지 않게)
const MAX_SWEEP_PAGES = 6
const MAX_PER_IP = 10 // 같은 인터넷 주소로 예약할 수 있는 이름 수 (이름을 마구 선점하는 것을 막는다. 서버가 많은 사람과 한 주소를 같이 쓰는 통신사 환경을 위해 넉넉히)
const DEFAULT_PORT = 25565

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

async function ownerTag(key) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`cubepanel-domain:${key}`))
  return 'cp:' + [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}

// DNS 메모: "cp:열쇠해시" (예전에는 뒤에 ":날짜"가 붙기도 했다)
const COMMENT_RE = /^(cp:[0-9a-f]{32})(?::(\d{8}))?$/
const parseComment = (c) => COMMENT_RE.exec(String(c ?? ''))
const dayMs = (s) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)))

// ---------- 이름 예약 저장소 ----------
// 저장소가 없으면(D1을 아직 연결하지 않음) 예전처럼 DNS 기록의 메모로만 주인을 가린다
export const nullStore = {
  none: true,
  get: async () => null,
  put: async () => {},
  del: async () => {},
  countByIp: async () => null,
  staleOnline: async () => [],
  existing: async () => new Set(),
  markOffline: async () => {},
  purgeIdle: async () => 0
}

export function d1Store(db) {
  let ready
  const init = () =>
    (ready ??= db
      .prepare('CREATE TABLE IF NOT EXISTS names (name TEXT PRIMARY KEY, owner TEXT NOT NULL, ip TEXT, port INTEGER, bedrock INTEGER, target TEXT, online INTEGER, last_seen INTEGER, created INTEGER)')
      .run())
  const toRow = (r) => r && { name: r.name, owner: r.owner, ip: r.ip ?? '', port: r.port ?? DEFAULT_PORT, bedrock: !!r.bedrock, target: r.target ?? '', online: !!r.online, lastSeen: r.last_seen ?? 0, created: r.created ?? 0 }
  return {
    none: false,
    async get(name) {
      await init()
      return toRow(await db.prepare('SELECT * FROM names WHERE name = ?').bind(name).first())
    },
    async put(r) {
      await init()
      await db
        .prepare(
          'INSERT INTO names (name, owner, ip, port, bedrock, target, online, last_seen, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET owner = excluded.owner, ip = excluded.ip, port = excluded.port, bedrock = excluded.bedrock, target = excluded.target, online = excluded.online, last_seen = excluded.last_seen'
        )
        .bind(r.name, r.owner, r.ip, r.port, r.bedrock ? 1 : 0, r.target, r.online ? 1 : 0, r.lastSeen, r.created)
        .run()
    },
    async del(name) {
      await init()
      await db.prepare('DELETE FROM names WHERE name = ?').bind(name).run()
    },
    async countByIp(ip) {
      await init()
      return (await db.prepare('SELECT COUNT(*) AS n FROM names WHERE ip = ?').bind(ip).first())?.n ?? 0
    },
    async staleOnline(before, limit) {
      await init()
      const res = await db.prepare('SELECT * FROM names WHERE online = 1 AND last_seen < ? ORDER BY last_seen LIMIT ?').bind(before, limit).all()
      return (res.results ?? []).map(toRow)
    },
    async existing(names) {
      await init()
      const out = new Set()
      for (let i = 0; i < names.length; i += 90) {
        const part = names.slice(i, i + 90)
        const res = await db.prepare(`SELECT name FROM names WHERE name IN (${part.map(() => '?').join(',')})`).bind(...part).all()
        for (const r of res.results ?? []) out.add(r.name)
      }
      return out
    },
    async markOffline(name) {
      await init()
      await db.prepare('UPDATE names SET online = 0 WHERE name = ?').bind(name).run()
    },
    async purgeIdle(before, limit) {
      await init()
      const res = await db.prepare('DELETE FROM names WHERE name IN (SELECT name FROM names WHERE online = 0 AND last_seen < ? LIMIT ?)').bind(before, limit).run()
      return res.meta?.changes ?? 0
    }
  }
}

export async function handleDomain(req, env, doFetch = fetch, now = Date.now(), store = env.DB ? d1Store(env.DB) : nullStore) {
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  const token = env.CF_DNS_TOKEN
  const zone = env.CF_ZONE_ID
  if (!token || !zone) return json({ error: 'not-configured' }, 503)
  const base = String(env.DOMAIN_BASE || 'cubepanel.kr').toLowerCase()
  const limit = Number(env.DNS_LIMIT) || DEFAULT_LIMIT
  const onlineStaleMs = (Number(env.STALE_ONLINE_HOURS) || DEFAULT_ONLINE_STALE_HOURS) * 3600_000

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
  const bedrock = body?.bedrock === true // 배드락 클라이언트는 SRV 기록을 읽지 못한다. 주소(A 기록)만 만들고 접속할 때 포트를 따로 적게 한다
  const target = body?.target == null ? '' : String(body.target).toLowerCase()
  if (target && !TUNNEL_HOST_RE.test(target)) return json({ error: 'bad-request' }, 400)
  if (action !== 'claim' && action !== 'release' && action !== 'check' && action !== 'offline') return json({ error: 'bad-request' }, 400)
  if (!NAME_RE.test(name)) return json({ error: 'name' }, 400)
  if (RESERVED.has(name)) return json({ error: 'reserved' }, 400)
  if (action !== 'check' && !/^[0-9a-f]{32}$/.test(key)) return json({ error: 'bad-request' }, 400)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return json({ error: 'port' }, 400)

  const ip = req.headers.get('cf-connecting-ip') || ''
  if (action === 'claim' && !target && !/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) return json({ error: 'ipv4' }, 400) // 지금은 IPv4 주소만 연결한다

  const tag = action === 'check' ? '' : await ownerTag(key)
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
    if (!out?.success) throw new Error(`cloudflare ${method} ${path.split('?')[0] || '/'} ${res.status} ${(out?.errors ?? []).slice(0, 2).map((x) => `${x.code}: ${x.message}`).join(' | ')}`)
    return out
  }
  const find = async (n) => (await cf('GET', `?name=${encodeURIComponent(n)}&per_page=100`)).result ?? []

  // 마지막으로 쓴 때: DNS 메모의 날짜, 없으면(옛 기록) 만들거나 고친 때 중 늦은 쪽
  const lastUsed = (r) => {
    const d = parseComment(r.comment)?.[2]
    if (d) return dayMs(d)
    return Math.max(Date.parse(r.modified_on ?? '') || 0, Date.parse(r.created_on ?? '') || 0)
  }

  // 켜 둔 채로 소식이 끊긴 기록을 치워 자리를 만든다. 치운 기록 수를 돌려준다. 이름 예약은 지우지 않는다 (서버를 켜면 다시 만든다)
  async function sweep(needed) {
    const staleRows = new Map((await store.staleOnline(now - onlineStaleMs, MAX_SWEEP_DELETES)).map((r) => [r.name, r]))
    const ours = []
    for (let page = 1; page <= MAX_SWEEP_PAGES; page++) {
      const list = (await cf('GET', `?comment.startswith=cp:&per_page=100&page=${page}`)).result ?? []
      ours.push(...list.filter((r) => parseComment(r.comment)))
      if (list.length < 100) break
    }
    const groups = new Map() // 이름 → {A, SRV 기록들, 마지막으로 쓴 때}
    for (const r of ours) {
      const n = String(r.name).replace(/^_minecraft\._tcp\./, '')
      if (n === host) continue // 지금 만들려는 이름은 건드리지 않는다
      const g = groups.get(n) ?? { name: n, records: [], used: 0 }
      g.records.push(r)
      g.used = Math.max(g.used, lastUsed(r))
      groups.set(n, g)
    }
    // D1에 예약이 없는 옛 기록은 마지막으로 쓴 때로 판단한다
    const reserved = await store.existing([...groups.keys()].map((n) => n.replace(`.${base}`, '')))
    const victims = []
    for (const g of groups.values()) {
      const short = g.name.replace(`.${base}`, '')
      const row = staleRows.get(short)
      if (row) victims.push({ ...g, short, used: row.lastSeen, legacy: false })
      else if (!store.none && !reserved.has(short) && g.used < now - onlineStaleMs) victims.push({ ...g, short, legacy: true }) // (D1이 없으면 예약을 옮겨 둘 곳이 없어서 치우지 않는다)
    }
    victims.sort((a, b) => a.used - b.used)
    let freed = 0
    for (const v of victims) {
      if (freed >= needed || freed >= MAX_SWEEP_DELETES) break
      const a = v.records.find((r) => r.type === 'A')
      const srv = v.records.find((r) => r.type === 'SRV')
      for (const r of v.records) {
        await cf('DELETE', `/${r.id}`)
        freed++
      }
      if (v.legacy) {
        // 옛 기록은 예약을 D1로 옮겨 두어서 주인이 서버를 켜면 같은 이름을 다시 만들 수 있게 한다
        const tagOfRecord = parseComment(v.records[0].comment)?.[1]
        await store.put({ name: v.short, owner: tagOfRecord, ip: a?.content ?? '', port: srv?.data?.port ?? DEFAULT_PORT, bedrock: false, target: '', online: false, lastSeen: v.used, created: v.used })
      } else await store.markOffline(v.short)
    }
    return freed
  }

  // 새 DNS 기록을 만들 자리(count개)가 있는지. 모자라면 소식이 끊긴 기록을 치우고, 그래도 모자라면 false
  async function hasRoom(count) {
    const total = (await cf('GET', '?per_page=1')).result_info?.total_count ?? 0
    if (total + count <= limit) return true
    const freed = await sweep(total + count - limit)
    return total - freed + count <= limit
  }

  try {
    // 서버를 켤 때마다 불리므로 Cloudflare API 한도(5분에 1,200회)를 아끼려고 조회는 한꺼번에, 바뀐 것만 쓴다
    const [have, rowRaw] = await Promise.all([Promise.all([find(host), find(srvName)]).then((x) => x.flat()), action === 'check' || !store.none ? store.get(name) : null])
    // 30일 넘게 안 쓴 예약은 없는 것으로 본다 (건드릴 때 지운다)
    let row = rowRaw
    if (row && !row.online && row.lastSeen < now - IDLE_DAYS * 86400_000) {
      await store.del(name)
      row = null
    }
    // 쓸 수 있는 이름인지만 알려 준다 (서버를 만들기 전에 미리 보여 주려고). 아무것도 쓰지 않는다
    if (action === 'check') return json({ ok: true, free: !row && have.length === 0 })

    // 이 이름의 주인: D1의 예약, 없으면 DNS 기록의 메모(예전 방식). 우리가 만들지 않은 기록이 있으면 남의 이름이다
    let owner = row?.owner ?? null
    if (!owner && have.length) {
      const owners = new Set(have.map((r) => parseComment(r.comment)?.[1] ?? '-'))
      owner = owners.size === 1 && !owners.has('-') ? [...owners][0] : '-'
    }
    if (owner && owner !== tag) return json({ error: action === 'claim' ? 'taken' : 'forbidden' }, action === 'claim' ? 409 : 403)
    if (!owner && have.length) return json({ error: 'taken' }, 409)

    if (action === 'release') {
      for (const r of have) await cf('DELETE', `/${r.id}`)
      if (row) await store.del(name)
      return json({ ok: true })
    }
    if (action === 'offline') {
      // 예약을 저장할 곳(D1)이 없으면 DNS 기록을 지우지 않는다 (지우면 이름을 아무나 가져갈 수 있다)
      if (store.none) return json({ ok: true })
      for (const r of have) await cf('DELETE', `/${r.id}`)
      // 예약은 둔다. 예전 방식의 기록이었으면 이때 예약으로 옮긴다
      if (row) await store.markOffline(name)
      else if (owner) await store.put({ name, owner: tag, ip: '', port, bedrock, target: '', online: false, lastSeen: now, created: now })
      return json({ ok: true })
    }

    const a = have.find((r) => r.type === 'A')
    const srv = have.find((r) => r.type === 'SRV')
    const wantSrv = !bedrock && !target && port !== DEFAULT_PORT

    // 새 이름 예약: 같은 인터넷 주소로 예약한 이름 수를 본다
    if (!owner) {
      const reserved = await store.countByIp(ip)
      const used = reserved ?? ((await cf('GET', `?type=A&content=${encodeURIComponent(ip)}&per_page=100`)).result ?? []).filter((r) => String(r.comment || '').startsWith('cp:')).length
      if (used >= MAX_PER_IP) return json({ error: 'limit' }, 429)
      await store.purgeIdle(now - IDLE_DAYS * 86400_000, 20) // 안 쓰는 예약도 이때 치운다
    }

    // 터널(playit)로 열린 서버: IP 대신 터널 주소로 보내는 SRV 기록만 만든다 (접속 주소는 앱이 알아낸 터널의 호스트·포트)
    if (target && !bedrock) {
      if (!srv && !(await hasRoom(1))) return json({ error: 'full' }, 200)
      const data = { priority: 0, weight: 5, port, target }
      if (srv) {
        if (!(srv.data?.port === port && srv.data?.target === target)) await cf('PATCH', `/${srv.id}`, { data })
      } else await cf('POST', '', { type: 'SRV', name: srvName, data, ttl: 60, comment: tag })
    } else {
      if (!a) {
        if (!(await hasRoom(wantSrv && !srv ? 2 : 1))) return json({ error: 'full' }, 200)
        await cf('POST', '', { type: 'A', name: host, content: ip, ttl: 60, proxied: false, comment: tag })
      } else if (a.content !== ip) await cf('PATCH', `/${a.id}`, { content: ip })

      if (wantSrv) {
        const data = { priority: 0, weight: 5, port, target: host }
        if (srv) {
          if (srv.data?.port !== port) await cf('PATCH', `/${srv.id}`, { data })
        } else await cf('POST', '', { type: 'SRV', name: srvName, data, ttl: 60, comment: tag })
      } else if (srv) await cf('DELETE', `/${srv.id}`)
    }

    // 예약을 적는다. 값이 그대로이고 방금 적었으면 쓰지 않는다 (앱이 주기적으로 불러서 D1 쓰기를 아낀다)
    const next = { name, owner: tag, ip, port, bedrock, target, online: true, lastSeen: now, created: row?.created ?? now }
    const same = row && row.online && row.ip === ip && row.port === port && row.bedrock === bedrock && row.target === target && now - row.lastSeen < BEAT_MS
    if (!same) await store.put(next)
    return json(target && !bedrock ? { ok: true, host, target, port } : { ok: true, host, ip, port })
  } catch (e) {
    // 어떤 요청이 왜 거절됐는지(Cloudflare가 준 오류 번호·문구)를 함께 돌려준다. 토큰·열쇠는 들어 있지 않다
    // 영역의 DNS 기록 개수 한도(81045)가 찼으면(설정한 한도보다 실제 한도가 낮을 때) 새 이름을 만들 수 없다고 알린다
    if (/\b81045\b/.test(String(e?.message))) return json({ error: 'full' }, 200)
    // 5xx로 보내면 Cloudflare가 본문을 "error code: 502"로 바꿔 버려서 원인이 안 보인다. 앱은 상태 번호가 아니라 error 값으로 판단하므로 200으로 보낸다
    return json({ error: 'dns', detail: String(e?.message ?? e).slice(0, 300) }, 200)
  }
}
