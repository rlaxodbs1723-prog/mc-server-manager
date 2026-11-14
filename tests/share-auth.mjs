// 로그인 흐름 시험: 시험용 중계(dev-relay.mjs)의 "dev" 로그인으로 시작 → 돌아오기 → 토큰 받기 → 내 정보 → 로그아웃·계정 삭제
// 실행: node tests/share-auth.mjs  (npm test가 같이 돌린다)
import crypto from 'crypto'
import { startDevRelay } from '../share/dev-relay.mjs'

const PORT = 18789
const base = `http://localhost:${PORT}`
const wss = startDevRelay(PORT)
let failed = 0
const expect = (ok, msg) => {
  if (!ok) {
    failed++
    console.log('  ✗ ' + msg)
  }
}
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')
const go = (url, init) => fetch(url.startsWith('http') ? url : base + url, { redirect: 'manual', ...init })

// 시작 → (dev 로그인 화면 대신) callback → 앱 주소로 돌아오기 까지 따라가서 한 번 쓰는 코드를 얻는다
async function loginCode(verifier, appPort = 45678) {
  const r1 = await go(`/api/auth/dev/start?port=${appPort}&challenge=${sha(verifier)}`)
  const r2 = await go(r1.headers.get('location'))
  const back = new URL(r2.headers.get('location'))
  return { back, c: back.searchParams.get('c') }
}
const token = (c, verifier) => go('/api/auth/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ c, verifier }) })
const me = (t) => go('/api/auth/me', { headers: { Authorization: `Bearer ${t}` } })

try {
  const verifier = crypto.randomBytes(32).toString('hex')
  const { back, c } = await loginCode(verifier)
  expect(back.origin === 'http://127.0.0.1:45678' && back.pathname === '/cb' && /^[0-9a-f]{64}$/.test(c ?? ''), `앱 주소로 돌아오지 않았어요: ${back}`)

  // verifier가 틀리면 토큰을 주지 않고, 그 코드는 다시 못 쓴다 (맞혀 보기 막기)
  expect((await token(c, 'x'.repeat(64))).status === 400, '틀린 verifier로 토큰을 받았어요')
  expect((await token(c, verifier)).status === 400, '한 번 실패한 코드를 다시 받아 줬어요')

  // 제대로 받기
  const v2 = crypto.randomBytes(32).toString('hex')
  const { c: c2 } = await loginCode(v2)
  const res = await (await token(c2, v2)).json()
  expect(/^[0-9a-f]{64}$/.test(res.token ?? '') && res.account?.name === '시험 계정', `토큰을 받지 못했어요: ${JSON.stringify(res)}`)
  expect((await token(c2, v2)).status === 400, '같은 코드로 토큰을 두 번 받았어요')

  const who = await (await me(res.token)).json()
  expect(who.account?.provider === 'dev', '내 정보를 받지 못했어요')
  expect((await (await go('/api/auth/providers')).json()).providers?.join() === 'dev', '로그인 방식 목록이 이상해요')
  expect((await me('a'.repeat(64))).status === 401, '아무 토큰이나 받아 줬어요')

  // 관리자 통계: 열쇠가 있어야만, 숫자만
  expect((await go('/api/auth/stats')).status === 403, '열쇠 없이 통계가 열렸어요')
  expect((await go('/api/auth/stats', { headers: { Authorization: 'Bearer wrong-key-xxxx' } })).status === 403, '틀린 열쇠로 통계가 열렸어요')
  const st = await (await go('/api/auth/stats', { headers: { Authorization: 'Bearer dev-admin-key' } })).json()
  expect(st.accounts >= 1 && st.loggedInDevices >= 1 && st.byProvider?.dev >= 1 && !JSON.stringify(st).includes('시험 계정'), `통계가 이상해요: ${JSON.stringify(st)}`)

  // 잘못된 시작 요청
  expect((await go('/api/auth/dev/start?port=80&challenge=' + sha('x'))).status === 400, '이상한 포트를 받아 줬어요')
  expect((await go('/api/auth/nope/start?port=45678&challenge=' + sha('x'))).status === 404, '없는 로그인 방식을 받아 줬어요')
  expect((await go('/api/auth/dev/callback?state=' + 'f'.repeat(32) + '&code=dev')).status === 400, '시작하지 않은 로그인을 받아 줬어요')

  // 로그아웃하면 그 토큰은 끝
  await go('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${res.token}` } })
  expect((await me(res.token)).status === 401, '로그아웃했는데 토큰이 아직 돼요')

  // 계정 삭제: 모든 기기의 로그인이 끝난다
  const v3 = crypto.randomBytes(32).toString('hex')
  const t3 = (await (await token((await loginCode(v3)).c, v3)).json()).token
  const v4 = crypto.randomBytes(32).toString('hex')
  const t4 = (await (await token((await loginCode(v4)).c, v4)).json()).token
  expect((await go('/api/auth/delete', { method: 'POST', headers: { Authorization: `Bearer ${t3}` } })).status === 200, '계정을 지우지 못했어요')
  expect((await me(t4)).status === 401, '계정을 지웠는데 다른 기기 로그인이 남았어요')
} finally {
  await new Promise((r) => wss.close(r))
}
console.log(failed ? `로그인: ${failed}개 실패` : '로그인: 모두 통과')
process.exitCode = failed ? 1 : 0
