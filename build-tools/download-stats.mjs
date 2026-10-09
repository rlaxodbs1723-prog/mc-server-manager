// 매일 다운로드 수 기록: GitHub Releases의 설치 파일(.exe) 받은 횟수를 stats/downloads.csv에 한 줄씩 남긴다.
// GitHub은 누적 횟수만 알려 줘서, 날마다 적어 두고 어제와 빼서 "하루 동안 늘어난 수"를 본다.
// 실행: node build-tools/download-stats.mjs  (윈도우 작업 스케줄러가 매일 한 번 실행한다)
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const file = path.join(root, 'stats', 'downloads.csv')
const res = await fetch('https://api.github.com/repos/rlaxodbs1723-prog/mc-server-manager/releases', {
  headers: { 'User-Agent': 'mc-cubepanel-stats' }
})
if (!res.ok) throw new Error(`GitHub 응답 ${res.status}`)
const releases = await res.json()
let total = 0
const per = []
for (const r of releases)
  for (const a of r.assets)
    if (/\.exe$/i.test(a.name)) {
      total += a.download_count
      per.push(`${r.tag_name}=${a.download_count}`)
    }
const today = new Date().toLocaleDateString('sv-SE') // 2026-10-09
fs.mkdirSync(path.dirname(file), { recursive: true })
const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n') : ['date,total,today,versions']
const rows = old.filter((l, i) => i === 0 || !l.startsWith(today + ',')) // 같은 날 두 번 돌면 마지막 것만
const prev = rows.length > 1 ? Number(rows[rows.length - 1].split(',')[1]) : total
rows.push(`${today},${total},${total - prev},${per.join(' ')}`)
fs.writeFileSync(file, rows.join('\n') + '\n')
console.log(`${today} 누적 ${total} (오늘 +${total - prev})`)
