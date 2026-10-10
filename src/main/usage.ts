// 익명 사용 통계: 앱을 켰을 때, 서버를 만들거나 켰을 때 GoatCounter에 "있었다"는 신호만 보낸다.
// 이름·서버 이름·파일 같은 개인 정보는 보내지 않는다. 앱 설정에서 끌 수 있다.
import { app } from 'electron'
import { getAppSettings } from './appsettings'

const COUNT_URL = 'https://cubepanel.goatcounter.com/count'

export function track(event: string): void {
  if (!app.isPackaged || process.env.MCSM_NO_USAGE) return // 개발·테스트 중에는 세지 않는다
  if (!getAppSettings().usageStats) return
  const q = new URLSearchParams({ e: 'true', p: `app-${event}`, t: `v${app.getVersion()}`, rnd: String(Math.random()) })
  fetch(`${COUNT_URL}?${q}`, {
    headers: { 'User-Agent': `MC-CubePanel/${app.getVersion()} (Windows)` },
    signal: AbortSignal.timeout(10000)
  }).catch(() => {}) // 못 보내도 앱에는 지장 없다
}
