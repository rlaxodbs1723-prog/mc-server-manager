// 내 컴퓨터에서 서버 공유를 시험하는 중계 (Cloudflare 대신). 규칙은 room.mjs·auth.mjs와 같다.
// 실행: node share/dev-relay.mjs  → 앱은 MCSM_SHARE_RELAY=ws://localhost:8788 로 켠다
// 로그인은 "dev" 방식만 있다: 누르면 Discord·Google 없이 바로 시험 계정으로 로그인된다
import http from 'http'
import { WebSocketServer } from 'ws'
import { createSession, handleAuth, verify } from './auth.mjs'
import { onClose, onMessage } from './room.mjs'

const PORT = Number(process.env.PORT) || 8788
const rooms = new Map() // 방 번호 → { data: Map, sockets: Set }
const accounts = new Map() // 로그인 저장소

const authStore = {
  get: async (k) => structuredClone(accounts.get(k)),
  put: async (k, v) => void accounts.set(k, structuredClone(v)),
  delete: async (k) => void accounts.delete(k),
  list: async (prefix) => new Map([...accounts].filter(([k]) => k.startsWith(prefix)))
}

// 시험 계정 로그인: 로그인 화면 없이 바로 callback으로 돌아간다
const providers = {
  dev: {
    authorize: (redirect, state) => `${redirect}?${new URLSearchParams({ state, code: 'dev' })}`,
    profile: async () => ({ id: 'tester', name: '시험 계정', email: '' })
  }
}

// 시험에서 쓰는 세션 바로 만들기
export const devSession = (name) => createSession(authStore, { provider: 'dev', id: name, name })

export function startDevRelay(port = PORT) {
  const server = http.createServer(async (req, res) => {
    if (!req.url?.startsWith('/api/auth/')) {
      res.writeHead(404).end('not found')
      return
    }
    const chunks = []
    for await (const c of req) chunks.push(c)
    const body = chunks.length ? Buffer.concat(chunks) : undefined
    const base = `http://localhost:${port}`
    const out = await handleAuth(new Request(base + req.url, { method: req.method, headers: req.headers, body }), { store: authStore, providers, base })
    res.writeHead(out.status, Object.fromEntries(out.headers))
    res.end(Buffer.from(await out.arrayBuffer()))
  })
  const wss = new WebSocketServer({ server })
  wss.on('connection', (raw, req) => {
    const m = /^\/api\/share\/([0-9a-f]{32})$/.exec(req.url ?? '')
    if (!m) return raw.close(1008, 'not found')
    let room = rooms.get(m[1])
    if (!room) rooms.set(m[1], (room = { data: new Map(), sockets: new Set() }))
    let attach = null
    const ws = {
      send: (obj) => raw.readyState === 1 && raw.send(JSON.stringify(obj)),
      close: (code, reason) => raw.close(code, reason),
      get attach() {
        return attach
      },
      setAttach: (obj) => (attach = obj)
    }
    room.sockets.add(ws)
    const env = {
      store: { get: async (k) => room.data.get(k), put: async (k, v) => void room.data.set(k, structuredClone(v)), delete: async (k) => void room.data.delete(k) },
      sockets: () => [...room.sockets],
      now: () => Date.now(),
      verify: async (session) => {
        const a = await verify(authStore, session)
        return a ? { id: a.id, name: a.name } : null
      }
    }
    raw.on('message', (data) => onMessage(env, ws, data.toString()))
    raw.on('close', () => {
      room.sockets.delete(ws)
      onClose(env, ws)
    })
  })
  server.listen(port)
  // 시험이 끝나면 닫을 수 있게 (예전처럼 wss.close()로 다 닫힌다)
  const close = wss.close.bind(wss)
  wss.close = (cb) => {
    for (const c of wss.clients) c.terminate()
    close()
    server.close(cb)
  }
  return wss
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/').replace(/^\//, '')}`) {
  startDevRelay()
  console.log(`서버 공유 시험용 중계: ws://localhost:${PORT} (로그인: dev 방식)`)
}
