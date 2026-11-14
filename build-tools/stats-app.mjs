// 통계 보기: 내 컴퓨터에서만 도는 작은 대시보드. 켜면 브라우저가 열리고 모든 통계를 한 번에 모아 보여 준다.
// 실행: node build-tools/stats-app.mjs  (바탕화면 CubePanel 폴더의 "통계 보기.bat")
//   - 다운로드: GitHub 릴리스 (지운 릴리스의 횟수는 stats/downloads.csv 기록에서 이어 센다)
//   - 계정: 로그인 중계의 관리자 통계 (열쇠는 ~/.cubepanel-admin-key, 저장소에는 넣지 않는다)
//   - 앱 사용: GoatCounter의 익명 사용 통계 (앱 켜기·서버 만들기·서버 켜기 횟수. 토큰은 ~/.cubepanel-goatcounter-token)
//     통계 보내기를 끈 사용자와 개발용 앱은 세지 않는다
// 127.0.0.1에서만 열린다 (같은 와이파이의 다른 기기도 못 본다)
import fs from 'fs'
import http from 'http'
import os from 'os'
import path from 'path'
import { exec } from 'child_process'
import { fileURLToPath } from 'url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO = 'rlaxodbs1723-prog/mc-server-manager'
const keyFile = path.join(os.homedir(), '.cubepanel-admin-key')
const goatFile = path.join(os.homedir(), '.cubepanel-goatcounter-token')

async function downloads() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100`, { headers: { 'User-Agent': 'mc-cubepanel-stats' } })
  if (!res.ok) throw new Error(`GitHub 응답 ${res.status}`)
  const releases = await res.json()
  const live = {}
  for (const r of releases) {
    const v = { tag: r.tag_name, date: r.published_at, win: 0, mac: 0 }
    for (const a of r.assets) {
      if (/\.exe$/i.test(a.name)) v.win += a.download_count
      if (/\.dmg$/i.test(a.name)) v.mac += a.download_count
    }
    live[r.tag_name] = v
  }
  // 지운 릴리스: 매일 기록(csv)에 남은 가장 큰 횟수
  const csv = path.join(root, 'stats', 'downloads.csv')
  const history = []
  const gone = {}
  if (fs.existsSync(csv)) {
    for (const line of fs.readFileSync(csv, 'utf8').trim().split('\n').slice(1)) {
      const [date, total, , vers] = line.split(',')
      history.push({ date, total: Number(total) })
      for (const kv of (vers ?? '').split(' ').filter(Boolean)) {
        const [tag, n] = kv.replace('(지움)', '').split('=')
        if (!live[tag]) gone[tag] = Math.max(gone[tag] ?? 0, Number(n) || 0)
      }
    }
  }
  const versions = Object.values(live).sort((a, b) => b.tag.localeCompare(a.tag, undefined, { numeric: true }))
  const win = versions.reduce((s, v) => s + v.win, 0)
  const mac = versions.reduce((s, v) => s + v.mac, 0)
  const removed = Object.values(gone).reduce((s, n) => s + n, 0)
  return { total: win + mac + removed, win, mac, removed, latest: versions[0] ?? null, versions, history }
}

async function accounts() {
  if (!fs.existsSync(keyFile)) throw new Error('관리자 열쇠 파일이 없어요 (~/.cubepanel-admin-key)')
  const key = fs.readFileSync(keyFile, 'utf8').trim()
  const res = await fetch(`https://cubepanel.kr/api/auth/stats?t=${Date.now()}`, { headers: { Authorization: `Bearer ${key}` } })
  if (!res.ok) throw new Error(`로그인 중계 응답 ${res.status}`)
  return res.json()
}

// 앱이 보내는 사용 기록: app-open(앱 켜기) · app-create-<종류>(서버 만들기) · app-start-<종류>(서버 켜기)
async function usage() {
  if (!fs.existsSync(goatFile)) throw new Error('GoatCounter 토큰 파일이 없어요 (~/.cubepanel-goatcounter-token)')
  const token = fs.readFileSync(goatFile, 'utf8').trim()
  const hits = async (start, end) => {
    const out = []
    let exclude = []
    // 한 번에 100개까지라, 더 있으면 받은 것을 빼고 이어서 받는다
    for (let i = 0; i < 5; i++) {
      const q = new URLSearchParams({ start: start.toISOString(), end: end.toISOString(), limit: '100', daily: 'true' })
      for (const id of exclude) q.append('exclude_paths', String(id))
      const res = await fetch(`https://cubepanel.goatcounter.com/api/v0/stats/hits?${q}`, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } })
      if (!res.ok) throw new Error(`GoatCounter 응답 ${res.status}`)
      const j = await res.json()
      out.push(...(j.hits ?? []))
      if (!j.more) break
      exclude = out.map((h) => h.path_id)
    }
    return out.filter((h) => String(h.path).startsWith('app-'))
  }
  const now = new Date()
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const sum = (list, prefix) => list.filter((h) => h.path.startsWith(prefix)).reduce((n, h) => n + (h.count ?? 0), 0)
  const today = await hits(midnight, now)
  const days14 = await hits(new Date(midnight - 13 * 86400_000), now)
  // 날짜별 서버 켜기
  const perDay = {}
  for (const h of days14.filter((x) => x.path.startsWith('app-start-')))
    for (const st of h.stats ?? []) perDay[st.day] = (perDay[st.day] ?? 0) + (st.daily ?? 0)
  // 오늘 켠 서버 종류별
  const bySoftware = today
    .filter((h) => h.path.startsWith('app-start-') && h.count)
    .map((h) => [h.path.slice('app-start-'.length), h.count])
    .sort((a, b) => b[1] - a[1])
  return {
    startsToday: sum(today, 'app-start-'),
    opensToday: sum(today, 'app-open'),
    createsToday: sum(today, 'app-create-'),
    starts14d: sum(days14, 'app-start-'),
    bySoftware,
    daily: Object.entries(perDay).sort()
  }
}

async function collect() {
  const [d, a, u] = await Promise.allSettled([downloads(), accounts(), usage()])
  return {
    at: new Date().toISOString(),
    downloads: d.status === 'fulfilled' ? d.value : { error: String(d.reason?.message ?? d.reason) },
    accounts: a.status === 'fulfilled' ? a.value : { error: String(a.reason?.message ?? a.reason) },
    usage: u.status === 'fulfilled' ? u.value : { error: String(u.reason?.message ?? u.reason) }
  }
}

const PAGE = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CubePanel 통계</title>
<style>
  :root { --bg:#101013; --s1:#1b1d23; --s2:#23262e; --line:#2d313a; --t1:#f2f3f5; --t2:#b0b6c0; --t3:#7d8591; --blue:#3182f6; --green:#35d07f; --violet:#a78bfa; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--t1); font-family:'Pretendard Variable',Pretendard,system-ui,'Malgun Gothic',sans-serif; -webkit-font-smoothing:antialiased; }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 28px 24px 48px; }
  header { display:flex; align-items:center; gap:12px; margin-bottom: 22px; }
  header h1 { font-size: 22px; margin:0; }
  header .at { color: var(--t3); font-size: 13px; }
  header button { margin-left:auto; font:inherit; font-weight:700; font-size:14px; padding:9px 16px; border:0; border-radius:10px; background:var(--s2); color:var(--t1); cursor:pointer; }
  header button:hover { background:#2d313a; }
  h2 { font-size: 15px; color: var(--t2); margin: 26px 0 10px; font-weight: 600; }
  .tiles { display:grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; }
  .tile { background:var(--s1); border:1px solid var(--line); border-radius:16px; padding:16px 18px; }
  .tile .k { color:var(--t3); font-size:13px; }
  .tile .v { font-size:30px; font-weight:800; margin-top:4px; font-variant-numeric: tabular-nums; letter-spacing:-0.01em; }
  .tile .d { color:var(--t3); font-size:12.5px; margin-top:2px; }
  .tile.big .v { color: var(--blue); }
  .card { background:var(--s1); border:1px solid var(--line); border-radius:16px; padding:18px; }
  .row2 { display:grid; grid-template-columns: 1.4fr 1fr; gap:12px; }
  @media (max-width: 800px) { .row2 { grid-template-columns: 1fr; } }
  table { width:100%; border-collapse:collapse; font-size:13.5px; font-variant-numeric: tabular-nums; }
  th, td { text-align:left; padding:8px 6px; border-bottom:1px solid var(--line); }
  th { color:var(--t3); font-weight:600; }
  td.n { text-align:right; }
  .bar { height:8px; border-radius:4px; background:var(--blue); }
  .err { color:#f87171; font-size:14px; }
  .legend { display:flex; gap:14px; color:var(--t3); font-size:12.5px; margin-top:8px; }
  .legend i { display:inline-block; width:10px; height:10px; border-radius:3px; margin-right:5px; vertical-align:-1px; }
  svg text { fill: var(--t3); font-size: 11px; }
  .tip { position: fixed; pointer-events:none; background:#000c; border:1px solid var(--line); padding:6px 9px; border-radius:8px; font-size:12.5px; display:none; }
</style></head>
<body><div class="wrap">
  <header><h1>CubePanel 통계</h1><span class="at" id="at">불러오는 중…</span><button id="re">새로 고침</button></header>
  <div id="app"></div>
</div><div class="tip" id="tip"></div>
<script>
const $ = (s) => document.querySelector(s)
const fmt = (n) => (n ?? 0).toLocaleString('ko-KR')
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const tile = (k, v, d = '', big = false) => '<div class="tile' + (big ? ' big' : '') + '"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="d">' + d + '</div></div>'

// 막대그래프 (날짜별)
function bars(points, color) {
  if (!points.length) return '<p class="d" style="color:var(--t3)">아직 기록이 없어요.</p>'
  const W = 640, H = 170, P = 26
  const max = Math.max(1, ...points.map((p) => p[1]))
  const bw = (W - P * 2) / points.length
  let out = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%">'
  points.forEach(([label, n], i) => {
    const h = (n / max) * (H - P * 2)
    const x = P + i * bw + bw * 0.15
    out += '<rect data-tip="' + esc(label) + ': ' + fmt(n) + '" x="' + x + '" y="' + (H - P - h) + '" width="' + bw * 0.7 + '" height="' + Math.max(h, 1) + '" rx="3" fill="' + color + '"/>'
    if (points.length <= 16 || i % Math.ceil(points.length / 10) === 0) out += '<text x="' + (x + bw * 0.35) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(label.slice(5)) + '</text>'
  })
  return out + '</svg>'
}

function render(d) {
  $('#at').textContent = new Date(d.at).toLocaleString('ko-KR') + ' 기준'
  const D = d.downloads, A = d.accounts, U = d.usage
  let h = ''
  h += '<h2>한눈에</h2><div class="tiles">'
  h += D.error ? '' : tile('전체 다운로드', fmt(D.total), '윈도우 ' + fmt(D.win + D.removed) + ' · 맥 ' + fmt(D.mac), true)
  h += D.error || !D.latest ? '' : tile('최신 버전 ' + esc(D.latest.tag), fmt(D.latest.win + D.latest.mac), new Date(D.latest.date).toLocaleDateString('ko-KR') + ' 출시')
  h += A.error ? '' : tile('로그인 계정', fmt(A.accounts), 'Discord ' + fmt(A.byProvider?.discord) + ' · Google ' + fmt(A.byProvider?.google), true)
  h += A.error ? '' : tile('오늘 새 가입', fmt(A.new1d), '최근 7일 ' + fmt(A.new7d))
  h += A.error ? '' : tile('로그인 중인 기기', fmt(A.loggedInDevices), '계정 ' + fmt(A.loggedInAccounts) + '명')
  h += U.error ? '' : tile('오늘 서버 켠 횟수', fmt(U.startsToday), '최근 14일 ' + fmt(U.starts14d), true)
  h += U.error ? '' : tile('오늘 앱 켠 횟수', fmt(U.opensToday), '새로 만든 서버 ' + fmt(U.createsToday))
  h += '</div>'

  h += '<h2>날짜별 서버 켠 횟수 (최근 14일)</h2><div class="card">'
  if (U.error) h += '<p class="err">' + esc(U.error) + '</p>'
  else {
    h += bars(U.daily, 'var(--violet)')
    if (U.bySoftware.length) h += '<div class="legend" style="flex-wrap:wrap">오늘: ' + U.bySoftware.map((x) => '<span>' + esc(x[0]) + ' ' + fmt(x[1]) + '</span>').join('') + '</div>'
    h += '<p style="color:var(--t3);font-size:12.5px;margin:8px 0 0">익명 사용 통계 기준이에요. 통계 보내기를 끈 사용자는 빠져 있어요.</p>'
  }
  h += '</div>'

  h += '<div class="row2">'
  // 다운로드
  h += '<div><h2>버전별 다운로드</h2><div class="card">'
  if (D.error) h += '<p class="err">' + esc(D.error) + '</p>'
  else {
    const top = Math.max(1, ...D.versions.map((v) => v.win + v.mac))
    h += '<table><tr><th>버전</th><th>출시</th><th class="n">윈도우</th><th class="n">맥</th><th style="width:30%"></th></tr>'
    for (const v of D.versions.slice(0, 12))
      h += '<tr><td><b>' + esc(v.tag) + '</b></td><td style="color:var(--t3)">' + new Date(v.date).toLocaleDateString('ko-KR') + '</td><td class="n">' + fmt(v.win) + '</td><td class="n">' + (v.mac ? fmt(v.mac) : '-') + '</td><td><div class="bar" style="width:' + ((v.win + v.mac) / top) * 100 + '%"></div></td></tr>'
    h += '</table>'
    if (D.removed) h += '<p class="d" style="color:var(--t3);font-size:12.5px;margin:10px 0 0">지운 예전 릴리스 ' + fmt(D.removed) + '회 포함 (매일 기록 기준)</p>'
  }
  h += '</div></div>'
  // 가입
  h += '<div><h2>날짜별 새 가입 (최근 30일)</h2><div class="card">'
  h += A.error ? '<p class="err">' + esc(A.error) + '</p>' : bars(A.daily ?? [], 'var(--green)')
  h += '</div>'
  h += '<h2>로그인 방식</h2><div class="card">'
  if (!A.error) {
    const total = Math.max(1, A.accounts)
    const parts = [['Discord', A.byProvider?.discord ?? 0, '#5865f2'], ['Google', A.byProvider?.google ?? 0, '#34a853']]
    h += '<div style="display:flex;height:14px;border-radius:7px;overflow:hidden;background:var(--s2)">' + parts.map((p) => '<div style="width:' + (p[1] / total) * 100 + '%;background:' + p[2] + '"></div>').join('') + '</div>'
    h += '<div class="legend">' + parts.map((p) => '<span><i style="background:' + p[2] + '"></i>' + p[0] + ' ' + fmt(p[1]) + ' (' + Math.round((p[1] / total) * 100) + '%)</span>').join('') + '</div>'
  }
  h += '</div></div></div>'

  // 다운로드 누적 기록
  if (!D.error && D.history.length) {
    h += '<h2>날마다 기록한 누적 다운로드</h2><div class="card">' + bars(D.history.map((x) => [x.date, x.total]), 'var(--blue)') + '</div>'
  }
  $('#app').innerHTML = h
}

async function load() {
  $('#re').disabled = true
  $('#at').textContent = '불러오는 중…'
  try {
    render(await (await fetch('/data')).json())
  } catch (e) {
    $('#app').innerHTML = '<p class="err">통계를 불러오지 못했어요: ' + esc(e.message) + '</p>'
  }
  $('#re').disabled = false
}
$('#re').onclick = load
document.addEventListener('mousemove', (e) => {
  const t = e.target.closest?.('[data-tip]'), tip = $('#tip')
  if (!t) return (tip.style.display = 'none')
  tip.textContent = t.dataset.tip
  tip.style.display = 'block'
  tip.style.left = e.clientX + 12 + 'px'
  tip.style.top = e.clientY + 12 + 'px'
})
load()
setInterval(load, 5 * 60_000) // 5분마다 저절로
</script></body></html>`

const server = http.createServer(async (req, res) => {
  if (req.url === '/data') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    return res.end(JSON.stringify(await collect()))
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(PAGE)
})
server.listen(0, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}`
  console.log(`CubePanel 통계: ${url}  (이 창을 닫으면 꺼져요)`)
  if (!process.env.STATS_NO_OPEN) exec(process.platform === 'win32' ? `start "" "${url}"` : `open "${url}"`)
})
