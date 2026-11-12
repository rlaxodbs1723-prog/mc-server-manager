// 서버 공유 중계 (Cloudflare Worker + Durable Object). 규칙은 room.mjs에 있다.
// 주소: wss://cubepanel.kr/api/share/<방 번호>  (방 번호는 방장 앱이 만든 32자리 무작위 값)
// 웹소켓 잠자기(hibernation)를 써서, 아무도 말하지 않는 동안은 요금이 들지 않는다
import { DurableObject } from 'cloudflare:workers'
import { onClose, onMessage } from './room.mjs'

const ROOM_RE = /^\/api\/share\/([0-9a-f]{32})$/

export default {
  async fetch(req, env) {
    const m = ROOM_RE.exec(new URL(req.url).pathname)
    if (!m) return new Response('not found', { status: 404 })
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 })
    return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req)
  }
}

export class ShareRoom extends DurableObject {
  async fetch() {
    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1])
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  // (이름을 env로 하면 Durable Object가 원래 갖고 있는 this.env(설정 값)와 겹쳐서 덮어써진다)
  room() {
    const storage = this.ctx.storage
    return {
      store: { get: (k) => storage.get(k), put: (k, v) => storage.put(k, v), delete: (k) => storage.delete(k) },
      sockets: () => this.ctx.getWebSockets().map((ws) => this.wrap(ws)),
      now: () => Date.now()
    }
  }

  // 같은 웹소켓은 같은 감싸개를 돌려줘야 room.mjs의 "이 소켓 말고 다른 소켓" 비교가 맞는다
  wrap(ws) {
    this.wrapped ??= new WeakMap()
    let w = this.wrapped.get(ws)
    if (!w) {
      w = {
        raw: ws,
        send: (obj) => {
          try {
            ws.send(JSON.stringify(obj))
          } catch {
            // 이미 닫힌 소켓
          }
        },
        close: (code, reason) => {
          try {
            ws.close(code, reason)
          } catch {
            // 이미 닫힘
          }
        },
        get attach() {
          return ws.deserializeAttachment() ?? null
        },
        setAttach: (obj) => ws.serializeAttachment(obj)
      }
      this.wrapped.set(ws, w)
    }
    return w
  }

  async webSocketMessage(ws, message) {
    if (typeof message === 'string' && message.length > 256_000) return ws.close(1009, 'too big')
    await onMessage(this.room(), this.wrap(ws), message)
  }

  async webSocketClose(ws) {
    await onClose(this.room(), this.wrap(ws))
  }

  async webSocketError(ws) {
    await onClose(this.room(), this.wrap(ws))
  }
}
