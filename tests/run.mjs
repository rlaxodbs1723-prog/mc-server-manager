// 자동 테스트 실행기: npm test (빠른 것만) / npm run test:full (서버를 실제로 만들고 켜 본다)
import { build } from 'esbuild'
import { spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { encodeCfKey, readCfKey } from '../build-tools/cfkey.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const full = process.argv.includes('--full')

// .env의 CurseForge 키 (있으면 CurseForge 검색도 확인한다). 앱을 빌드할 때와 똑같이 섞어서 넣는다
const cfKey = encodeCfKey(readCfKey(root))

const out = path.join(os.tmpdir(), 'mcsm-test-build', 'test.cjs')
await build({
  entryPoints: [path.join(root, 'tests', 'test.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: out,
  alias: { electron: path.join(root, 'tests', 'electron-stub', 'index.js') },
  define: { __CF_KEY_ENC__: JSON.stringify(cfKey) },
  logLevel: 'warning'
})

// 받은 Java·서버 파일은 다음 실행 때 다시 쓰려고 남겨 둔다 (서버 폴더는 매번 새로)
const home = path.join(os.tmpdir(), 'mcsm-test-home')
// 이미 다른 테스트가 돌고 있으면(같은 폴더를 써서 서로 지워 버린다) 이번 것은 건너뛴다
const lock = path.join(os.tmpdir(), 'mcsm-test.lock')
try {
  const pid = Number(fs.readFileSync(lock, 'utf8'))
  process.kill(pid, 0) // 살아 있으면 오류가 안 난다
  console.log(`다른 테스트가 아직 돌고 있어서 건너뛰었어요 (pid ${pid})`)
  process.exit(0)
} catch {
  /* 잠금 없음 또는 끝난 테스트의 잠금 */
}
fs.writeFileSync(lock, String(process.pid))
process.on('exit', () => fs.rmSync(lock, { force: true }))
fs.rmSync(path.join(home, 'servers'), { recursive: true, force: true })
fs.rmSync(path.join(home, 'backups'), { recursive: true, force: true })
fs.mkdirSync(home, { recursive: true })
const r = spawnSync(process.execPath, [out, ...(full ? ['--full'] : [])], { stdio: 'inherit', env: { ...process.env, TEST_HOME: home } })
process.exit(r.status ?? 1)
