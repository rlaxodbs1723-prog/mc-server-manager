// 자동 테스트 실행기: npm test (빠른 것만) / npm run test:full (서버를 실제로 만들고 켜 본다)
import { build } from 'esbuild'
import { spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const full = process.argv.includes('--full')

// .env의 CurseForge 키 (있으면 CurseForge 검색도 확인한다). \$는 글자 $
let cfKey
try {
  const line = fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/).find((l) => l.startsWith('MAIN_VITE_CURSEFORGE_KEY='))
  cfKey = line?.slice(line.indexOf('=') + 1).trim().split('\\$').join('$') || undefined
} catch {
  /* 없음 */
}

const out = path.join(os.tmpdir(), 'mcsm-test-build', 'test.cjs')
await build({
  entryPoints: [path.join(root, 'tests', 'test.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: out,
  alias: { electron: path.join(root, 'tests', 'electron-stub', 'index.js') },
  define: { 'import.meta.env.MAIN_VITE_CURSEFORGE_KEY': cfKey ? JSON.stringify(cfKey) : 'undefined' },
  logLevel: 'warning'
})

// 받은 Java·서버 파일은 다음 실행 때 다시 쓰려고 남겨 둔다 (서버 폴더는 매번 새로)
const home = path.join(os.tmpdir(), 'mcsm-test-home')
fs.rmSync(path.join(home, 'servers'), { recursive: true, force: true })
fs.rmSync(path.join(home, 'backups'), { recursive: true, force: true })
fs.mkdirSync(home, { recursive: true })
const r = spawnSync(process.execPath, [out, ...(full ? ['--full'] : [])], { stdio: 'inherit', env: { ...process.env, TEST_HOME: home } })
process.exit(r.status ?? 1)
