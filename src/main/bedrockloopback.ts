// 윈도우 스토어(UWP) 마인크래프트는 기본적으로 같은 PC의 서버(localhost·내 PC 주소)에 접속할 수 없다 (윈도우의 "루프백 차단").
// "루프백 예외"에 그 앱을 넣어 주면 접속된다. 설정을 바꾸려면 관리자 권한이 필요해서, 사용자가 버튼을 눌렀을 때만 관리자 확인 창을 띄워 한 번 실행한다.
import { execFile } from 'child_process'
import type { BedrockLoopbackState } from '../shared-types'

const PACKAGES = ['Microsoft.MinecraftUWP', 'Microsoft.MinecraftWindowsBeta'] // 정식·베타(프리뷰)
const FAMILY_RE = /^[A-Za-z0-9.]+_[a-z0-9]{13}$/ // 패키지 가족 이름 모양 (명령어에 넣기 전에 검사한다)

function run(file: string, args: string[], timeoutMs = 15000): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: timeoutMs, encoding: 'utf8' }, (_err, stdout) => resolve(String(stdout ?? '')))
  })
}

// "CheckNetIsolation LoopbackExempt -s" 출력에서 그 앱이 예외 목록에 있는지 (이름은 소문자로 나온다)
export function isExempt(listing: string, family: string): boolean {
  return listing.toLowerCase().includes(family.toLowerCase())
}

// 설치된 스토어 마인크래프트의 패키지 가족 이름들 (윈도우가 아니거나 스토어 버전이 없으면 빈 배열)
async function installedFamilies(): Promise<string[]> {
  if (process.platform !== 'win32') return []
  // Get-AppxPackage는 이름을 하나만 받아서 패키지마다 따로 물어본다
  const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PACKAGES.map((p) => `Get-AppxPackage ${p} | ForEach-Object { $_.PackageFamilyName }`).join('; ')])
  return out.split(/\r?\n/).map((s) => s.trim()).filter((s) => FAMILY_RE.test(s))
}

export async function getLoopbackState(): Promise<BedrockLoopbackState> {
  const families = await installedFamilies()
  if (!families.length) return { needed: false, allowed: true }
  const listing = await run('CheckNetIsolation.exe', ['LoopbackExempt', '-s'])
  return { needed: true, allowed: families.every((f) => isExempt(listing, f)) }
}

// 관리자 확인 창을 띄워 예외를 등록한다. 사용자가 거절하면 그대로 허용되지 않은 상태로 돌려준다
export async function allowLoopback(): Promise<BedrockLoopbackState> {
  const families = await installedFamilies()
  for (const family of families) {
    // family는 위에서 모양을 검사한 값이라 명령어에 넣어도 안전하다
    await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `Start-Process -FilePath CheckNetIsolation.exe -ArgumentList 'LoopbackExempt','-a','-n=${family}' -Verb RunAs -WindowStyle Hidden -Wait`],
      120_000
    )
  }
  return getLoopbackState()
}
