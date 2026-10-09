// 빌드 전에 dist의 예전 버전 설치 파일(.exe, .blockmap)을 휴지통으로 보낸다 (이름에 버전이 들어가서 덮어써지지 않고 쌓인다)
import { spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const dir = path.resolve('dist')
const old = fs.existsSync(dir)
  ? fs
      .readdirSync(dir)
      .filter((f) => /^MC-CubePanel-Setup-.+\.exe(\.blockmap)?$/.test(f) && !f.startsWith(`MC-CubePanel-Setup-${version}.`))
      .map((f) => path.join(dir, f))
  : []
for (const f of old) {
  const p = f.replace(/'/g, "''")
  const r = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-Command', `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${p}', 'OnlyErrorDialogs', 'SendToRecycleBin')`],
    { stdio: 'inherit' }
  )
  console.log(r.status === 0 ? `휴지통으로: ${path.basename(f)}` : `못 지움: ${path.basename(f)}`)
}
