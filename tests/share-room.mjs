// 서버 공유 방 규칙 시험: 진짜 웹소켓으로 시험용 중계(dev-relay.mjs)에 방장·친구를 붙여 본다
// 실행: node tests/share-room.mjs  (npm test가 같이 돌린다)
import { devSession, startDevRelay } from '../share/dev-relay.mjs'
import { sha256 } from '../share/room.mjs'

const PORT = 18788
const wss = startDevRelay(PORT)
const room = 'a'.repeat(32)
const hostKey = 'b'.repeat(64)
let failed = 0
const expect = (ok, msg) => {
  if (!ok) {
    failed++
    console.log('  ✗ ' + msg)
  }
}

// 메시지를 차례로 받아 두는 웹소켓
const all = []
function connect() {
  const ws = new WebSocket(`ws://localhost:${PORT}/api/share/${room}`)
  all.push(ws)
  const inbox = []
  const waiters = []
  let closed = null
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    const w = waiters.findIndex((x) => x.pred(m))
    if (w >= 0) waiters.splice(w, 1)[0].resolve(m)
    else inbox.push(m)
  }
  ws.onclose = (e) => {
    closed = e.code
    for (const w of waiters.splice(0)) w.resolve({ t: 'closed', code: e.code })
  }
  const open = new Promise((r) => (ws.onopen = r))
  return {
    open,
    send: (o) => ws.send(JSON.stringify(o)),
    // pred에 맞는 메시지를 기다린다 (이미 와 있으면 바로). 닫히면 { t: 'closed', code }
    next: (pred = () => true, ms = 2000) =>
      new Promise((resolve) => {
        const i = inbox.findIndex(pred)
        if (i >= 0) return resolve(inbox.splice(i, 1)[0])
        if (closed != null) return resolve({ t: 'closed', code: closed })
        waiters.push({ pred, resolve })
        setTimeout(() => resolve({ t: 'timeout' }), ms)
      }),
    close: () => ws.close()
  }
}

try {
  const hostS = await devSession('방장')
  const friendS = await devSession('친구')
  const otherS = await devSession('남')

  // 로그인하지 않으면 들어오지 못한다
  const anon = connect()
  await anon.open
  anon.send({ t: 'auth', as: 'host', key: hostKey })
  expect((await anon.next()).code === 4010, '로그인 없이 방장이 됐어요')

  // 방장
  const host = connect()
  await host.open
  host.send({ t: 'auth', as: 'host', key: hostKey, session: hostS })
  expect((await host.next((m) => m.t === 'ok')).as === 'host', '방장으로 들어가지 못했어요')

  // 남이 같은 방에 방장으로 들어오려 하면 막는다
  const thief = connect()
  await thief.open
  thief.send({ t: 'auth', as: 'host', key: 'c'.repeat(64), session: otherS })
  expect((await thief.next()).code === 4003, '다른 열쇠로 방장이 됐어요')

  // 초대 코드 등록 → 친구가 그 코드로 들어온다
  const code = 'JOIN-ME-1234'
  host.send({ t: 'invite', codeHash: await sha256(code), role: 'view' })
  expect((await host.next((m) => m.t === 'invited')).t === 'invited', '초대 코드를 등록하지 못했어요')
  const friend = connect()
  await friend.open
  friend.send({ t: 'auth', as: 'join', code, name: '친구 PC', session: friendS })
  const welcome = await friend.next((m) => m.t === 'ok')
  expect(welcome.role === 'view' && /^[0-9a-f]{64}$/.test(welcome.token ?? ''), `친구가 열쇠를 받지 못했어요: ${JSON.stringify(welcome)}`)
  expect((await friend.next((m) => m.t === 'host')).online === true, '방장이 켜져 있다고 알려 주지 않았어요')
  expect((await host.next((m) => m.t === 'joined')).name === '친구', '방장에게 친구 계정 이름으로 알리지 않았어요')

  // 같은 코드는 두 번 못 쓴다
  const again = connect()
  await again.open
  again.send({ t: 'auth', as: 'join', code, name: 'x', session: otherS })
  expect((await again.next()).code === 4004, '쓴 초대 코드를 또 받아 줬어요')

  // 친구의 요청은 방이 권한을 붙여서 방장에게 넘기고, 답은 그 친구에게만 간다
  friend.send({ t: 'rpc', id: 1, m: 'getLog', a: ['x'], role: 'admin' })
  const rpc = await host.next((m) => m.t === 'rpc')
  expect(rpc.role === 'view' && rpc.m === 'getLog' && rpc.from === welcome.device, `요청이 이상하게 넘어왔어요: ${JSON.stringify(rpc)}`)
  host.send({ t: 'res', to: rpc.from, id: rpc.id, ok: true, value: ['line'] })
  const res = await friend.next((m) => m.t === 'res')
  expect(res.ok && res.value[0] === 'line', '답이 친구에게 가지 않았어요')

  // 저장한 열쇠로 다시 들어오기
  const friend2 = connect()
  await friend2.open
  friend2.send({ t: 'auth', as: 'client', token: welcome.token, session: friendS })
  expect((await friend2.next((m) => m.t === 'ok')).device === welcome.device, '열쇠로 다시 들어오지 못했어요')

  // 열쇠를 다른 계정이 쓰면 막는다
  const stolen = connect()
  await stolen.open
  stolen.send({ t: 'auth', as: 'client', token: welcome.token, session: otherS })
  expect((await stolen.next()).code === 4011, '다른 계정이 친구 열쇠로 들어왔어요')

  // 방장이 보내는 알림은 친구 모두에게
  host.send({ t: 'ev', e: { type: 'status', state: 'running' } })
  expect((await friend.next((m) => m.t === 'ev')).e.state === 'running' && (await friend2.next((m) => m.t === 'ev')).e.state === 'running', '알림이 친구에게 가지 않았어요')

  // 권한 바꾸기 → 다음 요청부터 관리자로 넘어간다
  host.send({ t: 'role', device: welcome.device, role: 'admin' })
  await friend.next((m) => m.t === 'role')
  friend.send({ t: 'rpc', id: 2, m: 'sendCommand', a: [] })
  expect((await host.next((m) => m.t === 'rpc')).role === 'admin', '권한이 바뀌지 않았어요')

  // 방장이 나가면 친구 요청은 "방장 꺼짐"
  host.close()
  expect((await friend.next((m) => m.t === 'host')).online === false, '방장이 나갔다고 알리지 않았어요')
  friend.send({ t: 'rpc', id: 3, m: 'getLog', a: [] })
  expect((await friend.next((m) => m.t === 'res' && m.id === 3)).error === 'host-offline', '방장이 없는데 답이 왔어요')

  // 방장이 다시 들어와서 친구를 끊으면 그 친구의 연결이 닫히고 열쇠도 못 쓴다
  const host2 = connect()
  await host2.open
  host2.send({ t: 'auth', as: 'host', key: hostKey, session: hostS })
  await host2.next((m) => m.t === 'ok')
  host2.send({ t: 'revoke', device: welcome.device })
  expect((await friend.next((m) => m.t === 'closed')).code === 4003, '끊은 친구의 연결이 남았어요')
  const friend3 = connect()
  await friend3.open
  friend3.send({ t: 'auth', as: 'client', token: welcome.token, session: friendS })
  expect((await friend3.next()).code === 4003, '끊은 친구의 열쇠가 아직 돼요')

  // 인증 없이 다른 메시지를 먼저 보내면 끊는다
  const rude = connect()
  await rude.open
  rude.send({ t: 'rpc', id: 1, m: 'getLog' })
  expect((await rude.next()).code === 4001, '인증 없이 요청을 받았어요')
  host2.close()
} finally {
  // 연결을 모두 닫은 뒤 끝낸다 (바로 process.exit를 부르면 윈도우에서 닫는 중인 연결 때문에 오류가 난다)
  for (const ws of all) ws.close()
  for (const c of wss.clients) c.terminate()
  await new Promise((r) => wss.close(r))
}
console.log(failed ? `서버 공유 방: ${failed}개 실패` : '서버 공유 방: 모두 통과')
process.exitCode = failed ? 1 : 0
