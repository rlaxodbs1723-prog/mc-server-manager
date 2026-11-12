// 내 컴퓨터에서 서버 공유를 시험하는 중계 (Cloudflare 대신). 규칙은 room.mjs와 같다.
// 실행: node share/dev-relay.mjs  → 앱은 MCSM_SHARE_RELAY=ws://localhost:8788 로 켠다
import { WebSocketServer } from 'ws'
import { onClose, onMessage } from './room.mjs'

const PORT = Number(process.env.PORT) || 8788
const rooms = new Map() // 방 번호 → { store: Map, sockets: Set }

export function startDevRelay(port = PORT) {
  const wss = new WebSocketServer({ port })
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
      now: () => Date.now()
    }
    raw.on('message', (data) => onMessage(env, ws, data.toString()))
    raw.on('close', () => {
      room.sockets.delete(ws)
      onClose(env, ws)
    })
  })
  return wss
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/').replace(/^\//, '')}`) {
  startDevRelay()
  console.log(`서버 공유 시험용 중계: ws://localhost:${PORT}`)
}
