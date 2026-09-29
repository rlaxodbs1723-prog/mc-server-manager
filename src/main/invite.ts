// 플레이어 초대: 서버가 켜지면 공유기 포트를 열고 접속 주소를 알려 주고, 꺼지면 포트를 닫는다.
import type { InviteStatus, ServerEvent } from '../shared-types'
import { getState, onServerEvent, serverPort } from './runner'
import { HEADERS } from './download'
import { closePort, localIPv4, openPort } from './upnp'

const status = new Map<string, InviteStatus>() // 서버 폴더 -> 초대 상태
const openedPorts = new Map<string, number>() // 서버 폴더 -> 열어 둔 포트
const renewTimers = new Map<string, ReturnType<typeof setInterval>>() // 서버 폴더 -> 포트 기간 늘리기 타이머
const RENEW_MS = 20 * 60 * 1000
let emitEvent: (e: ServerEvent) => void = () => {}

// 기본 포트면 주소 뒤에 :25565를 붙이지 않는다
const withPort = (host: string, port: number): string => (port === 25565 ? host : `${host}:${port}`)

function set(folderPath: string, invite: InviteStatus): void {
  status.set(folderPath, invite)
  emitEvent({ type: 'invite', folderPath, invite })
}

export const getInvite = (folderPath: string): InviteStatus => status.get(folderPath) ?? { state: 'off' }

async function open(folderPath: string, name: string): Promise<void> {
  const port = serverPort(folderPath)
  const lan = localIPv4().map((ip) => withPort(ip, port))
  set(folderPath, { state: 'opening', lan })
  const result = await openPort(port, `MC Server Manager - ${name}`)
  if (status.get(folderPath)?.state !== 'opening') {
    if (result.ok) closePort(port).catch(() => {}) // 여는 사이에 서버가 꺼졌다
    return
  }
  if (!result.ok) return set(folderPath, { state: 'failed', message: result.message, lan })
  openedPorts.set(folderPath, port)
  // 포트는 1시간짜리라, 서버가 켜져 있는 동안 20분마다 다시 요청해 늘린다
  clearInterval(renewTimers.get(folderPath))
  renewTimers.set(
    folderPath,
    setInterval(() => openPort(port, `MC Server Manager - ${name}`).catch(() => {}), RENEW_MS)
  )
  if (!result.externalIp) return set(folderPath, { state: 'failed', message: '포트는 열었지만 외부 주소를 알아내지 못했어요.', lan })
  set(folderPath, { state: 'open', address: withPort(result.externalIp, port), lan })
}

async function close(folderPath: string): Promise<void> {
  clearInterval(renewTimers.get(folderPath))
  renewTimers.delete(folderPath)
  status.delete(folderPath)
  emitEvent({ type: 'invite', folderPath, invite: { state: 'off' } })
  const port = openedPorts.get(folderPath)
  openedPorts.delete(folderPath)
  if (port != null) await closePort(port).catch(() => false)
}

// 앱을 닫을 때 남은 포트를 모두 닫는다
export async function closeAllPorts(): Promise<void> {
  await Promise.all([...openedPorts.keys()].map(close))
}

// 서버가 켜질 때 부르는 쪽(servers.ts)에서 이름을 넘겨주고, 꺼지는 건 이벤트로 감지한다
export function startInvite(folderPath: string, name: string): void {
  open(folderPath, name).catch((e) => set(folderPath, { state: 'failed', message: String(e?.message ?? e), lan: [] }))
}

export function initInvite(send: (e: ServerEvent) => void): void {
  emitEvent = send
  onServerEvent((e) => {
    if (e.type === 'status' && e.state === 'stopped') close(e.folderPath)
  })
}

// 플레이어 접속 확인: 바깥 인터넷(mcstatus.io)에서 이 주소로 서버에 접속되는지 물어본다.
// 같은 집 안에서 확인하면 공유기가 되돌려 주지 않는 경우가 많아서 바깥 서비스를 쓴다.
export async function checkReachable(folderPath: string): Promise<{ ok: boolean; message: string }> {
  const invite = getInvite(folderPath)
  if (invite.state !== 'open') throw new Error('접속 주소가 준비된 다음에 확인할 수 있어요.')
  if (getState(folderPath) !== 'running') throw new Error('서버가 완전히 켜진 다음에 확인할 수 있어요.')
  const port = serverPort(folderPath)
  const host = invite.address.replace(/:\d+$/, '')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20000)
  try {
    const res = await fetch(`https://api.mcstatus.io/v2/status/java/${encodeURIComponent(host)}:${port}?timeout=8`, {
      headers: HEADERS,
      signal: ctrl.signal
    })
    if (!res.ok) throw new Error()
    const data = (await res.json()) as { online?: boolean }
    return data.online
      ? { ok: true, message: '밖에서도 접속돼요! 플레이어에게 주소를 보내 주세요.' }
      : {
          ok: false,
          message:
            '밖에서 접속되지 않아요. 윈도우 방화벽이 Java를 막고 있거나, 공유기가 두 개(공유기 뒤에 또 공유기)이거나, 통신사가 포트를 막았을 수 있어요.'
        }
  } catch {
    throw new Error('확인 서비스에 연결하지 못했어요. 잠시 뒤에 다시 해 보세요.')
  } finally {
    clearTimeout(timer)
  }
}
