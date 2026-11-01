// 플레이어 초대: 서버가 켜지면 공유기 포트를 열고 접속 주소를 알려 주고, 꺼지면 포트를 닫는다.
import type { InviteStatus, ServerEvent } from '../shared-types'
import { getState, onServerEvent, serverPort } from './runner'
import { HEADERS } from './download'
import { closePort, isPrivate, localIPv4, openPort, publicIpFromWeb } from './upnp'
import { isBedrockFolder } from './bedrock'
import { readProperties } from './properties'
import { refreshDomain, setDomainOffline } from './domain'
import { closeAllTunnels, closeTunnel, linkTunnel, openTunnel, tunnelLinked } from './tunnel'

const status = new Map<string, InviteStatus>() // 서버 폴더 -> 초대 상태
const openedPorts = new Map<string, number>() // 서버 폴더 -> 열어 둔 포트
const renewTimers = new Map<string, ReturnType<typeof setInterval>>() // 서버 폴더 -> 포트 기간 늘리기 타이머
const openedUdp = new Map<string, number[]>() // 서버 폴더 -> 배드락(nethernet) 접속자용으로 더 열어 둔 UDP 포트
const RENEW_MS = 20 * 60 * 1000

// 배드락은 server-port를 TCP로 열고, 접속자가 쓰는 UDP 포트도 연다. server.properties의 server-udp-ports(`[IP:]밖포트[:안포트]`, 포트는 하나 또는 범위)에서 읽는다
function udpPortsOf(folderPath: string): number[] {
  if (!isBedrockFolder(folderPath)) return []
  const value = (readProperties(folderPath)['server-udp-ports'] ?? '').replace(/^(\[[^\]]*\]|\d+\.\d+\.\d+\.\d+):/, '')
  const m = /^(\d+)(?:-(\d+))?/.exec(value)
  if (!m) return []
  const [a, b] = [Number(m[1]), Number(m[2] ?? m[1])]
  return Array.from({ length: Math.max(0, Math.min(b - a + 1, 20)) }, (_, i) => a + i)
}
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
  const proto = 'TCP' // 배드락도 server-port는 TCP (접속자용 UDP 포트는 따로 연다)
  const udp = udpPortsOf(folderPath)
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
    // 자동으로 못 열었어도 공유기에서 직접 포트를 열어 둔 사람이면 밖에서 접속된다. 확인되면 그 IP로 연다 (공유기가 두 겹이면 소용없다)
    // 확인은 서버가 켜질 때까지 기다려야 해서, 터널을 연결해 둔 사람은 기다리지 않고 바로 터널로 연다
    const manualIp = result.reason === 'double-nat' || tunnelLinked() ? null : await manualAddress(folderPath, port, bedrock)
    if (status.get(folderPath)?.state !== 'opening') return
    if (manualIp) {
      set(folderPath, { state: 'open', address: withPort(manualIp, port, bedrock), lan, port })
      void refreshDomain(folderPath).then((host) => setInviteDomain(folderPath, host ? withPort(host, port, bedrock) : undefined))
      return
    }
    // 공유기로 못 열면, playit을 연결해 둔 사람은 터널로 연다
    if (tunnelLinked()) return openViaTunnel(folderPath, port, lan, result.message)
    return set(folderPath, { state: 'failed', message: result.message, lan, port })
  }
  openedPorts.set(folderPath, port)
  openedUdp.set(folderPath, udp)
  await Promise.all(udp.map((p) => openPort(p, `MC CubePanel - ${name}`, 'UDP').catch(() => undefined)))
  // 포트는 1시간짜리라, 서버가 켜져 있는 동안 20분마다 다시 요청해 늘린다
  clearInterval(renewTimers.get(folderPath))
  renewTimers.set(
    folderPath,
    setInterval(() => {
      openPort(port, `MC CubePanel - ${name}`, proto).catch(() => {})
      for (const p of udp) openPort(p, `MC CubePanel - ${name}`, 'UDP').catch(() => {})
    }, RENEW_MS)
  )
  if (!result.externalIp) {
    const message = '포트는 열었지만 외부 주소를 알아내지 못했어요.'
    // 주소를 모르면 열어 둔 포트는 쓸 수 없으니 닫고, 터널이 연결돼 있으면 터널로 연다
    if (tunnelLinked()) {
      clearInterval(renewTimers.get(folderPath))
      renewTimers.delete(folderPath)
      openedPorts.delete(folderPath)
      closePort(port, proto).catch(() => {})
      for (const p of openedUdp.get(folderPath) ?? []) closePort(p, 'UDP').catch(() => {})
      openedUdp.delete(folderPath)
      return openViaTunnel(folderPath, port, lan, message)
    }
    return set(folderPath, { state: 'failed', message, lan, port })
  }
  set(folderPath, { state: 'open', address: withPort(result.externalIp, port, bedrock), lan, port })
  // 이름 주소를 만들어 뒀으면 지금 IP로 갱신하고, 끝나면 접속 주소를 이름 주소로 보여 준다 (실패해도 IP 주소가 그대로 쓰인다)
  void refreshDomain(folderPath).then((host) => setInviteDomain(folderPath, host ? withPort(host, port, bedrock) : undefined))
}

// 직접 연 포트 확인: 내 공인 IP를 알아내고, 서버가 켜지면 바깥 인터넷에서 그 주소로 접속되는지 본다. 접속되면 IP, 아니면 null
const MANUAL_WAIT_MS = 3 * 60 * 1000
async function manualAddress(folderPath: string, port: number, bedrock: boolean): Promise<string | null> {
  const ip = await publicIpFromWeb()
  if (!ip || isPrivate(ip)) return null
  const deadline = Date.now() + MANUAL_WAIT_MS
  while (getState(folderPath) !== 'running') {
    if (status.get(folderPath)?.state !== 'opening' || Date.now() > deadline) return null
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  const open = bedrock ? await tcpOpenFromOutside(ip, port).catch(() => false) : await mcstatusOnline(withPort(ip, port, false), false).catch(() => false)
  return open ? ip : null
}

// 배드락(NetherNet)은 TCP 포트로 먼저 인사하므로, 바깥 인터넷(check-host.net)에서 그 TCP 포트에 연결되는지 본다. UDP는 이렇게 확인할 수 없다
// (mcstatus.io는 예전 방식 신호로만 찾아서 새 방식 서버를 못 찾는다)
async function tcpOpenFromOutside(host: string, port: number): Promise<boolean> {
  const head = { Accept: 'application/json' }
  const start = (await (await fetch(`https://check-host.net/check-tcp?host=${encodeURIComponent(`${host}:${port}`)}&max_nodes=3`, { headers: head, signal: AbortSignal.timeout(10000) })).json()) as { request_id?: string }
  if (!start.request_id) throw new Error()
  for (let i = 0; i < 6; i++) {
    await new Promise((resolve) => setTimeout(resolve, 3000))
    const res = (await (await fetch(`https://check-host.net/check-result/${start.request_id}`, { headers: head, signal: AbortSignal.timeout(10000) })).json()) as Record<string, { time?: number }[] | null>
    const done = Object.values(res)
    if (done.some((r) => r?.some((x) => typeof x?.time === 'number'))) return true // 한 곳이라도 연결되면 열린 것
    if (done.length && done.every((r) => r !== null)) return false // 모두 답했는데 연결된 곳이 없다
  }
  return false
}

// 바깥 인터넷(mcstatus.io)에서 이 주소의 서버에 접속되는지 묻는다
async function mcstatusOnline(target: string, bedrock: boolean): Promise<boolean> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20000)
  try {
    const res = await fetch(`https://api.mcstatus.io/v2/status/${bedrock ? 'bedrock' : 'java'}/${encodeURIComponent(target).replace('%3A', ':')}?timeout=8`, {
      headers: HEADERS,
      signal: ctrl.signal
    })
    if (!res.ok) throw new Error()
    return !!((await res.json()) as { online?: boolean }).online
  } finally {
    clearTimeout(timer)
  }
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
  const udp = openedUdp.get(folderPath) ?? []
  openedUdp.delete(folderPath)
  if (port != null) await Promise.all([closePort(port, 'TCP'), ...udp.map((p) => closePort(p, 'UDP'))].map((c) => c.catch(() => false)))
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
  const bedrock = isBedrockFolder(folderPath)
  if (bedrock && invite.tunnel) throw new Error('터널로 연 배드락 서버는 접속을 확인할 수 없어요.')
  try {
    if (bedrock ? await tcpOpenFromOutside(invite.address.replace(/:\d+$/, ''), serverPort(folderPath)) : await mcstatusOnline(target, false))
      return { ok: true, message: bedrock ? '밖에서도 접속돼요! (TCP 포트만 확인할 수 있어서, UDP 포트도 같이 열려 있어야 해요.) 플레이어에게 주소를 보내 주세요.' : '밖에서도 접속돼요! 플레이어에게 주소를 보내 주세요.' }
    const message = bedrock
      ? '밖에서 접속되지 않아요. 공유기에서 TCP와 UDP 포트(서버 포트와 같은 번호)를 둘 다 열어야 해요. 윈도우 방화벽이 배드락 서버를 막고 있거나, 공유기가 두 개(공유기 뒤에 또 공유기)이거나, 통신사가 포트를 막았을 수도 있어요.'
      : '밖에서 접속되지 않아요. 윈도우 방화벽이 Java를 막고 있거나, 공유기가 두 개(공유기 뒤에 또 공유기)이거나, 통신사가 포트를 막았을 수 있어요.'
    // 공유기 포트는 열렸는데 실제로는 막힌 경우: 빨간 표시로 바꿔서 터널로 열 수 있게 한다 (터널을 연결해 둔 사람은 바로 터널로)
    if (!invite.tunnel && getInvite(folderPath).state === 'open') {
      const port = serverPort(folderPath)
      if (tunnelLinked()) void openViaTunnel(folderPath, port, invite.lan, message)
      else set(folderPath, { state: 'failed', message, lan: invite.lan, port })
    }
    return { ok: false, message }
  } catch {
    throw new Error('확인 서비스에 연결하지 못했어요. 잠시 뒤에 다시 해 보세요.')
  }
}
