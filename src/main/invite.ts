// 플레이어 초대: 서버가 켜지면 공유기 포트를 열고 접속 주소를 알려 주고, 꺼지면 포트를 닫는다.
import type { InviteStatus, ServerEvent } from '../shared-types'
import { getState, onServerEvent, serverPort } from './runner'
import { HEADERS } from './download'
import { closePort, localIPv4, openPort } from './upnp'
import { closeAllTunnels, closeTunnel, linkTunnel, openTunnel, tunnelLinked } from './tunnel'

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
  // 시험용: MCSM_FAKE_INVITE=double-nat 처럼 주고 켜면 그 원인으로 실패한 척한다 (빨간 표시 확인용)
  const fake = process.env.MCSM_FAKE_INVITE
  const result: Awaited<ReturnType<typeof openPort>> =
    fake === 'double-nat' || fake === 'no-upnp' || fake === 'error'
      ? { ok: false, reason: fake, message: `Test failure (${fake})` }
      : await openPort(port, `MC CubePanel - ${name}`)
  if (status.get(folderPath)?.state !== 'opening') {
    if (result.ok) closePort(port).catch(() => {}) // 여는 사이에 서버가 꺼졌다
    return
  }
  if (!result.ok) {
    // 공유기로 못 열면, playit을 연결해 둔 사람은 터널로 연다
    if (tunnelLinked()) return openViaTunnel(folderPath, port, lan, result.message)
    return set(folderPath, { state: 'failed', message: result.message, lan, port })
  }
  openedPorts.set(folderPath, port)
  // 포트는 1시간짜리라, 서버가 켜져 있는 동안 20분마다 다시 요청해 늘린다
  clearInterval(renewTimers.get(folderPath))
  renewTimers.set(
    folderPath,
    setInterval(() => openPort(port, `MC CubePanel - ${name}`).catch(() => {}), RENEW_MS)
  )
  if (!result.externalIp) {
    const message = '포트는 열었지만 외부 주소를 알아내지 못했어요.'
    // 주소를 모르면 열어 둔 포트는 쓸 수 없으니 닫고, 터널이 연결돼 있으면 터널로 연다
    if (tunnelLinked()) {
      clearInterval(renewTimers.get(folderPath))
      renewTimers.delete(folderPath)
      openedPorts.delete(folderPath)
      closePort(port).catch(() => {})
      return openViaTunnel(folderPath, port, lan, message)
    }
    return set(folderPath, { state: 'failed', message, lan, port })
  }
  set(folderPath, { state: 'open', address: withPort(result.externalIp, port), lan })
}

// 공유기로 못 연 원인. 터널을 다시 시도할 때 터널 에러가 겹겹이 붙지 않게 따로 둔다
const upnpCause = new Map<string, string>()

async function openViaTunnel(folderPath: string, port: number, lan: string[], upnpMessage: string): Promise<void> {
  upnpCause.set(folderPath, upnpMessage)
  set(folderPath, { state: 'opening', lan })
  try {
    const address = await openTunnel(folderPath, port)
    if (status.get(folderPath)?.state !== 'opening') return closeTunnel(folderPath) // 그사이 서버가 꺼졌다
    set(folderPath, { state: 'open', address, lan, tunnel: true })
  } catch (e) {
    closeTunnel(folderPath)
    set(folderPath, { state: 'failed', message: `${upnpMessage} (터널: ${(e as Error).message})`, lan, port })
  }
}

// 빨간 표시 도움말의 "터널로 열기": 처음이면 브라우저에서 playit 승인을 받고, 터널로 연다
export async function useTunnel(folderPath: string): Promise<void> {
  const invite = getInvite(folderPath)
  if (invite.state !== 'failed') return
  await linkTunnel()
  if (getInvite(folderPath).state !== 'failed') return // 승인을 기다리는 사이 서버가 꺼졌거나 이미 열렸다
  await openViaTunnel(folderPath, invite.port, invite.lan, upnpCause.get(folderPath) ?? invite.message)
}

async function close(folderPath: string): Promise<void> {
  closeTunnel(folderPath)
  upnpCause.delete(folderPath)
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
  closeAllTunnels()
  await Promise.all([...openedPorts.keys()].map(close))
}

// 서버가 켜질 때 부르는 쪽(servers.ts)에서 이름을 넘겨주고, 꺼지는 건 이벤트로 감지한다
export function startInvite(folderPath: string, name: string): void {
  open(folderPath, name).catch((e) =>
    set(folderPath, { state: 'failed', message: String(e?.message ?? e), lan: [], port: serverPort(folderPath) })
  )
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
  // 터널 주소는 playit이 정한 포트를 쓰므로 주소 그대로 묻는다
  const target = invite.tunnel ? invite.address : `${invite.address.replace(/:\d+$/, '')}:${serverPort(folderPath)}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20000)
  try {
    const res = await fetch(`https://api.mcstatus.io/v2/status/java/${encodeURIComponent(target).replace('%3A', ':')}?timeout=8`, {
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
