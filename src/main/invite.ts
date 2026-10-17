// 플레이어 초대: 서버가 켜지면 공유기 포트를 열고 접속 주소를 알려 주고, 꺼지면 포트를 닫는다.
import type { InviteStatus, ServerEvent } from '../shared-types'
import { getState, onServerEvent, serverPort } from './runner'
import { HEADERS } from './download'
import { closePort, localIPv4, openPort } from './upnp'
import { isBedrockFolder } from './bedrock'
import { refreshDomain, setDomainOffline } from './domain'
import { closeAllTunnels, closeTunnel, linkTunnel, openTunnel, tunnelLinked } from './tunnel'

const status = new Map<string, InviteStatus>() // 서버 폴더 -> 초대 상태
const openedPorts = new Map<string, number>() // 서버 폴더 -> 열어 둔 포트
const renewTimers = new Map<string, ReturnType<typeof setInterval>>() // 서버 폴더 -> 포트 기간 늘리기 타이머
const RENEW_MS = 20 * 60 * 1000
let emitEvent: (e: ServerEvent) => void = () => {}

// 기본 포트면 주소 뒤에 :25565를 붙이지 않는다 (배드락은 19132)
const withPort = (host: string, port: number, bedrock = false): string => (port === (bedrock ? 19132 : 25565) ? host : `${host}:${port}`)

function set(folderPath: string, invite: InviteStatus): void {
  status.set(folderPath, invite)
  emitEvent({ type: 'invite', folderPath, invite })
}

export const getInvite = (folderPath: string): InviteStatus => status.get(folderPath) ?? { state: 'off' }

async function open(folderPath: string, name: string): Promise<void> {
  const port = serverPort(folderPath)
  const bedrock = isBedrockFolder(folderPath) // 배드락은 UDP로 접속한다
  const proto = bedrock ? 'UDP' : 'TCP'
  const lan = localIPv4().map((ip) => withPort(ip, port, bedrock))
  set(folderPath, { state: 'opening', lan })
  // 시험용: MCSM_FAKE_INVITE=double-nat 처럼 주고 켜면 그 원인으로 실패한 척한다 (빨간 표시 확인용)
  const fake = process.env.MCSM_FAKE_INVITE
  const result: Awaited<ReturnType<typeof openPort>> =
    fake === 'double-nat' || fake === 'no-upnp' || fake === 'error'
      ? { ok: false, reason: fake, message: `Test failure (${fake})` }
      : await openPort(port, `MC CubePanel - ${name}`, proto)
  if (status.get(folderPath)?.state !== 'opening') {
    if (result.ok) closePort(port, proto).catch(() => {}) // 여는 사이에 서버가 꺼졌다
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
    setInterval(() => openPort(port, `MC CubePanel - ${name}`, proto).catch(() => {}), RENEW_MS)
  )
  if (!result.externalIp) {
    const message = '포트는 열었지만 외부 주소를 알아내지 못했어요.'
    // 주소를 모르면 열어 둔 포트는 쓸 수 없으니 닫고, 터널이 연결돼 있으면 터널로 연다
    if (tunnelLinked()) {
      clearInterval(renewTimers.get(folderPath))
      renewTimers.delete(folderPath)
      openedPorts.delete(folderPath)
      closePort(port, proto).catch(() => {})
      return openViaTunnel(folderPath, port, lan, message)
    }
    return set(folderPath, { state: 'failed', message, lan, port })
  }
  set(folderPath, { state: 'open', address: withPort(result.externalIp, port, bedrock), lan, port })
  // 이름 주소를 만들어 뒀으면 지금 IP로 갱신하고, 끝나면 접속 주소를 이름 주소로 보여 준다 (실패해도 IP 주소가 그대로 쓰인다)
  void refreshDomain(folderPath).then((host) => setInviteDomain(folderPath, host ? withPort(host, port, bedrock) : undefined))
}

// 접속 주소를 이름 주소로 바꿔 보여 준다 (열린 상태일 때만. host가 없으면 IP 주소로 되돌린다)
export function setInviteDomain(folderPath: string, host: string | undefined): void {
  const cur = status.get(folderPath)
  if (cur?.state !== 'open') return
  const { domain: _old, ...rest } = cur
  void _old
  set(folderPath, host ? { ...rest, domain: host } : rest)
  if (host) startDomainBeat(folderPath)
}

// 켜져 있는 동안 주기적으로 "아직 켜져 있다"고 알린다. 그래야 소식이 끊긴 기록과 구별되고, 지워졌더라도 다시 만들어진다
const DOMAIN_BEAT_MS = 20 * 60 * 1000
const domainBeats = new Map<string, ReturnType<typeof setInterval>>()
function startDomainBeat(folderPath: string): void {
  if (domainBeats.has(folderPath)) return
  const timer = setInterval(() => {
    const cur = status.get(folderPath)
    if (cur?.state !== 'open') return
    void refreshDomain(folderPath, cur.tunnel ? cur.address : undefined)
  }, DOMAIN_BEAT_MS)
  timer.unref()
  domainBeats.set(folderPath, timer)
}

// 공유기로 못 연 원인. 터널을 다시 시도할 때 터널 에러가 겹겹이 붙지 않게 따로 둔다
const upnpCause = new Map<string, string>()

async function openViaTunnel(folderPath: string, port: number, lan: string[], upnpMessage: string): Promise<void> {
  upnpCause.set(folderPath, upnpMessage)
  set(folderPath, { state: 'opening', lan })
  try {
    const address = await openTunnel(folderPath, port, isBedrockFolder(folderPath))
    if (status.get(folderPath)?.state !== 'opening') return closeTunnel(folderPath) // 그사이 서버가 꺼졌다
    set(folderPath, { state: 'open', address, lan, port, tunnel: true })
    // 이름 주소가 있으면 터널로 이어 주고, 끝나면 접속 주소를 이름 주소로 보여 준다
    void refreshDomain(folderPath, address).then((host) => setInviteDomain(folderPath, host ?? undefined))
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
  // 저장된 키가 무효라 연결이 풀렸으면(키는 지워졌다) 승인부터 다시 받아 한 번 더 시도한다
  if (getInvite(folderPath).state === 'failed' && !tunnelLinked()) {
    await linkTunnel()
    if (getInvite(folderPath).state !== 'failed') return
    await openViaTunnel(folderPath, invite.port, invite.lan, upnpCause.get(folderPath) ?? invite.message)
  }
}

async function close(folderPath: string): Promise<void> {
  clearInterval(domainBeats.get(folderPath))
  domainBeats.delete(folderPath)
  void setDomainOffline(folderPath) // 서버가 꺼졌으니 이름 주소의 DNS 기록을 치운다 (이름은 남는다)
  closeTunnel(folderPath)
  upnpCause.delete(folderPath)
  clearInterval(renewTimers.get(folderPath))
  renewTimers.delete(folderPath)
  status.delete(folderPath)
  emitEvent({ type: 'invite', folderPath, invite: { state: 'off' } })
  const port = openedPorts.get(folderPath)
  openedPorts.delete(folderPath)
  if (port != null) await closePort(port, isBedrockFolder(folderPath) ? 'UDP' : 'TCP').catch(() => false)
}

// 앱을 닫을 때 남은 포트를 모두 닫는다
export async function closeAllPorts(): Promise<void> {
  closeAllTunnels()
  // 터널로 열린 서버는 openedPorts에 없으므로, 켜져 있던 서버 모두의 이름 주소 기록을 치운다
  const offline = [...status.keys()].map((f) => setDomainOffline(f))
  await Promise.all([...openedPorts.keys()].map(close).concat(offline))
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
    const kind = isBedrockFolder(folderPath) ? 'bedrock' : 'java'
    const res = await fetch(`https://api.mcstatus.io/v2/status/${kind}/${encodeURIComponent(target).replace('%3A', ':')}?timeout=8`, {
      headers: HEADERS,
      signal: ctrl.signal
    })
    if (!res.ok) throw new Error()
    const data = (await res.json()) as { online?: boolean }
    if (data.online) return { ok: true, message: '밖에서도 접속돼요! 플레이어에게 주소를 보내 주세요.' }
    const message =
      `밖에서 접속되지 않아요. 윈도우 방화벽이 ${isBedrockFolder(folderPath) ? '배드락 서버' : 'Java'}를 막고 있거나, 공유기가 두 개(공유기 뒤에 또 공유기)이거나, 통신사가 포트를 막았을 수 있어요.`
    // 공유기 포트는 열렸는데 실제로는 막힌 경우: 빨간 표시로 바꿔서 터널로 열 수 있게 한다 (터널을 연결해 둔 사람은 바로 터널로)
    if (!invite.tunnel && getInvite(folderPath).state === 'open') {
      const port = serverPort(folderPath)
      if (tunnelLinked()) void openViaTunnel(folderPath, port, invite.lan, message)
      else set(folderPath, { state: 'failed', message, lan: invite.lan, port })
    }
    return { ok: false, message }
  } catch {
    throw new Error('확인 서비스에 연결하지 못했어요. 잠시 뒤에 다시 해 보세요.')
  } finally {
    clearTimeout(timer)
  }
}
