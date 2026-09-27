// Modrinth·CurseForge가 지금 응답하는지 기억해 두고 화면에 알린다 (사이트가 멈췄을 때 앱이 고장 난 것처럼 보이지 않게)
import { BrowserWindow } from 'electron'
import type { SiteStatus } from '../shared-types'

const status: SiteStatus = { modrinth: true, curseforge: true }

export const getSiteStatus = (): SiteStatus => ({ ...status })

// 안 되는 동안 1분마다 가볍게 다시 물어본다 (앱이 그 사이트를 다시 쓰기 전에도 표시가 풀리게)
type Site = keyof SiteStatus
const pingers: Partial<Record<Site, () => Promise<unknown>>> = {}
const timers: Partial<Record<Site, ReturnType<typeof setTimeout>>> = {}
export function registerPing(site: Site, ping: () => Promise<unknown>): void {
  pingers[site] = ping
}

function schedulePing(site: Site): void {
  if (timers[site] || !pingers[site]) return
  timers[site] = setTimeout(async () => {
    timers[site] = undefined
    await pingers[site]?.().catch(() => undefined) // 결과는 watchSite가 기록한다
    if (!status[site]) schedulePing(site)
  }, 60_000)
}

// ok=false: 연결이 안 되거나 사이트 쪽 오류(5xx). 요청이 잘못된 것(4xx)은 사이트 문제가 아니라서 부르지 않는다
export function reportSite(site: Site, ok: boolean): void {
  if (!ok) schedulePing(site)
  if (status[site] === ok) return
  status[site] = ok
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('siteStatus', getSiteStatus())
}

// fetch 한 번을 감싸서 결과를 기록한다
export async function watchSite(site: keyof SiteStatus, send: () => Promise<Response>): Promise<Response> {
  try {
    const res = await send()
    reportSite(site, res.status < 500)
    return res
  } catch (e) {
    reportSite(site, false)
    throw e
  }
}
