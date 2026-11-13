// 서버 공유 "방": 방장 앱 하나와 친구 앱 여럿이 웹소켓으로 이 방에 붙어서 메시지를 주고받는다.
// Cloudflare Durable Object(worker.mjs)와 내 컴퓨터 시험용 중계(dev-relay.mjs)가 이 규칙을 같이 쓴다.
//
// 연결하면 처음 보내는 메시지로 누구인지 밝힌다 (주소창에 비밀 값을 넣지 않으려고)
//   { t: 'auth', as: 'host', key, session }          방장. 처음 붙은 방장의 열쇠가 이 방의 주인이 된다
//   { t: 'auth', as: 'join', code, name, session }   초대 코드로 처음 들어오는 친구 → 이 기기 전용 열쇠(token)를 받는다
//   { t: 'auth', as: 'client', token, session }      한 번 들어온 친구
// session은 로그인 세션 토큰(auth.mjs). 로그인하지 않았으면 4010으로 닫는다. 친구 이름은 로그인한 계정 이름을 쓴다
// 방장 → 방: invite(초대 코드 등록) · devices(친구 목록) · revoke(친구 끊기) · ev(친구 모두에게 알림) · res(요청의 답)
// 친구 → 방: rpc(방장에게 보내는 요청). 방이 권한(role)을 붙여 넘기므로 친구가 권한을 속일 수 없다
// 비밀 값(열쇠·코드·토큰)은 해시만 저장한다

export const ROLES = ['view', 'admin']
const MAX_INVITES = 20
const MAX_DEVICES = 30
const INVITE_MS_MAX = 7 * 86400_000

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`cubepanel-share:${text}`))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const randomHex = (bytes) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('')
const isHex = (s, len) => typeof s === 'string' && new RegExp(`^[0-9a-f]{${len}}$`).test(s)
const cleanName = (s) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 40) || '이름 없는 기기'

// env: { store: { get(k), put(k, v), delete(k) } (await 가능), sockets(): 붙어 있는 소켓들, now(): 시각,
//        verify(session): 로그인한 계정 { id, name } 또는 null }
// 소켓: { send(obj), close(code, reason), attach (읽기), setAttach(obj) } — attach는 인증된 뒤의 정보 { as, device, role }
export async function onMessage(env, ws, raw) {
  let msg
  try {
    msg = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(new TextDecoder().decode(raw))
  } catch {
    return ws.close(1003, 'bad json')
  }
  if (!msg || typeof msg !== 'object') return ws.close(1003, 'bad message')
  const me = ws.attach
  if (!me) return auth(env, ws, msg)
  if (me.as === 'host') return fromHost(env, ws, msg)
  return fromClient(env, ws, me, msg)
}

export async function onClose(env, ws) {
  const me = ws.attach
  if (me?.as === 'host' && !env.sockets().some((s) => s !== ws && s.attach?.as === 'host')) broadcast(env, { t: 'host', online: false })
  if (me?.as === 'client') sendHost(env, { t: 'left', device: me.device })
}

const hostSocket = (env) => env.sockets().find((s) => s.attach?.as === 'host')
const clients = (env) => env.sockets().filter((s) => s.attach?.as === 'client')
const sendHost = (env, obj) => hostSocket(env)?.send(obj)
function broadcast(env, obj) {
  for (const s of clients(env)) s.send(obj)
}

async function auth(env, ws, msg) {
  if (msg.t !== 'auth') return ws.close(4001, 'auth first')
  const acct = await env.verify(msg.session)
  if (!acct) return ws.close(4010, 'login')
  if (msg.as === 'host') {
    if (!isHex(msg.key, 64)) return ws.close(4001, 'bad key')
    const hash = await sha256(msg.key)
    const owner = await env.store.get('host')
    if (owner && owner !== hash) return ws.close(4003, 'not owner')
    if (!owner) await env.store.put('host', hash)
    await env.store.put('hostAcct', acct.id)
    // 예전 방장 연결(앱을 다시 켜기 전의 것)은 닫는다. 방장 연결은 하나만
    for (const s of env.sockets()) if (s !== ws && s.attach?.as === 'host') s.close(4000, 'replaced')
    ws.setAttach({ as: 'host' })
    ws.send({ t: 'ok', as: 'host' })
    broadcast(env, { t: 'host', online: true })
    return
  }
  if (msg.as === 'join') {
    if (typeof msg.code !== 'string' || msg.code.length < 6 || msg.code.length > 64) return ws.close(4001, 'bad code')
    const invites = (await env.store.get('invites')) ?? {}
    const key = await sha256(msg.code)
    const inv = invites[key]
    if (!inv || inv.exp < env.now()) return ws.close(4004, 'invite')
    delete invites[key] // 초대 코드는 한 번만 쓴다
    await env.store.put('invites', invites)
    const devices = (await env.store.get('devices')) ?? {}
    if (Object.keys(devices).length >= MAX_DEVICES) return ws.close(4005, 'full')
    const device = randomHex(8)
    const token = randomHex(32)
    devices[device] = { tokenHash: await sha256(token), role: inv.role, name: cleanName(acct.name), pc: cleanName(msg.name), acct: acct.id, added: env.now() }
    await env.store.put('devices', devices)
    ws.setAttach({ as: 'client', device, role: inv.role })
    ws.send({ t: 'ok', as: 'client', token, device, role: inv.role })
    ws.send({ t: 'host', online: !!hostSocket(env) })
    sendHost(env, { t: 'joined', device, name: devices[device].name, role: inv.role, first: true, invite: key })
    return
  }
  if (msg.as === 'client') {
    if (!isHex(msg.token, 64)) return ws.close(4001, 'bad token')
    const devices = (await env.store.get('devices')) ?? {}
    const hash = await sha256(msg.token)
    const device = Object.keys(devices).find((id) => devices[id].tokenHash === hash)
    if (!device) return ws.close(4003, 'revoked')
    const d = devices[device]
    // 기기 열쇠는 처음 들어온 계정만 쓸 수 있다 (열쇠를 남에게 넘겨도 못 쓴다)
    if (d.acct && d.acct !== acct.id) return ws.close(4011, 'other account')
    if (!d.acct || d.name !== cleanName(acct.name)) {
      Object.assign(d, { acct: acct.id, name: cleanName(acct.name) })
      await env.store.put('devices', devices)
    }
    const role = d.role
    ws.setAttach({ as: 'client', device, role })
    ws.send({ t: 'ok', as: 'client', device, role })
    ws.send({ t: 'host', online: !!hostSocket(env) })
    sendHost(env, { t: 'joined', device, name: devices[device].name, role })
    return
  }
  return ws.close(4001, 'bad auth')
}

async function fromHost(env, ws, msg) {
  if (msg.t === 'invite') {
    if (!isHex(msg.codeHash, 64) || !ROLES.includes(msg.role)) return
    const ms = Math.min(INVITE_MS_MAX, Math.max(60_000, Number(msg.ms) || 86400_000))
    const invites = (await env.store.get('invites')) ?? {}
    for (const [k, v] of Object.entries(invites)) if (v.exp < env.now()) delete invites[k] // 지난 코드 치우기
    if (Object.keys(invites).length >= MAX_INVITES) return ws.send({ t: 'error', of: 'invite', error: 'too-many' })
    invites[msg.codeHash] = { role: msg.role, exp: env.now() + ms }
    await env.store.put('invites', invites)
    return ws.send({ t: 'invited', codeHash: msg.codeHash })
  }
  if (msg.t === 'devices') return ws.send({ t: 'devices', list: await deviceList(env) })
  if (msg.t === 'revoke') {
    const devices = (await env.store.get('devices')) ?? {}
    if (devices[msg.device]) {
      delete devices[msg.device]
      await env.store.put('devices', devices)
      for (const s of clients(env)) if (s.attach?.device === msg.device) s.close(4003, 'revoked')
    }
    return ws.send({ t: 'devices', list: await deviceList(env) })
  }
  if (msg.t === 'role') {
    // 친구 권한 바꾸기 (붙어 있는 연결에도 바로 적용)
    if (!ROLES.includes(msg.role)) return
    const devices = (await env.store.get('devices')) ?? {}
    if (!devices[msg.device]) return
    devices[msg.device].role = msg.role
    await env.store.put('devices', devices)
    for (const s of clients(env)) if (s.attach?.device === msg.device) {
      s.setAttach({ ...s.attach, role: msg.role })
      s.send({ t: 'role', role: msg.role })
    }
    return ws.send({ t: 'devices', list: await deviceList(env) })
  }
  if (msg.t === 'close-room') {
    // 공유를 끈다: 친구를 모두 끊고 초대·친구 목록을 비운다 (앱은 다음에 공유하면 새 방을 만든다)
    for (const s of clients(env)) s.close(4003, 'closed')
    await env.store.delete('devices')
    await env.store.delete('invites')
    return ws.send({ t: 'closed' })
  }
  if (msg.t === 'ev') {
    // 방장 → 친구 모두 (to가 있으면 그 기기에만)
    const out = { t: 'ev', e: msg.e }
    for (const s of clients(env)) if (!msg.to || s.attach?.device === msg.to) s.send(out)
    return
  }
  if (msg.t === 'res') {
    for (const s of clients(env)) if (s.attach?.device === msg.to) s.send({ t: 'res', id: msg.id, ok: !!msg.ok, value: msg.value, error: msg.error })
    return
  }
}

async function fromClient(env, ws, me, msg) {
  if (msg.t !== 'rpc' || typeof msg.m !== 'string' || msg.m.length > 64) return
  const host = hostSocket(env)
  if (!host) return ws.send({ t: 'res', id: msg.id, ok: false, error: 'host-offline' })
  // 권한은 방이 붙인다 (친구가 보낸 값은 쓰지 않는다)
  host.send({ t: 'rpc', from: me.device, role: me.role, id: msg.id, m: msg.m, a: Array.isArray(msg.a) ? msg.a : [] })
}

async function deviceList(env) {
  const devices = (await env.store.get('devices')) ?? {}
  const online = new Set(clients(env).map((s) => s.attach?.device))
  return Object.entries(devices).map(([id, d]) => ({ id, name: d.name, pc: d.pc ?? '', role: d.role, added: d.added, online: online.has(id) }))
}
