// UPnP로 공유기에 포트를 자동으로 열고 닫는다. 외부 라이브러리 없이 SSDP(공유기 찾기) + SOAP(요청)만 쓴다.
import dgram from 'dgram'
import os from 'os'

const SEARCH_TARGETS = [
  'urn:schemas-upnp-org:device:InternetGatewayDevice:1',
  'urn:schemas-upnp-org:service:WANIPConnection:1'
]
const WAN_SERVICES = [
  'urn:schemas-upnp-org:service:WANIPConnection:2',
  'urn:schemas-upnp-org:service:WANIPConnection:1',
  'urn:schemas-upnp-org:service:WANPPPConnection:1'
]
const CACHE_MS = 10 * 60 * 1000
export const LEASE_SECONDS = 60 * 60 // 포트를 열어 두는 기간

interface Gateway {
  service: string
  controlUrl: string
  localIp: string // 공유기와 같은 네트워크에 있는 이 컴퓨터의 주소
  at: number
}

let gatewayCache: Gateway | null = null

export const localIPv4 = (): string[] =>
  Object.values(os.networkInterfaces())
    .flat()
    .filter((n): n is os.NetworkInterfaceInfo => !!n && n.family === 'IPv4' && !n.internal && !n.address.startsWith('169.254.'))
    .map((n) => n.address)

// 한 네트워크 카드에서 공유기(게이트웨이)의 설명 주소(LOCATION)를 찾는다.
function ssdpFrom(localIp: string, timeoutMs: number): Promise<string[]> {
  return new Promise((resolve) => {
    const found = new Set<string>()
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    const done = (): void => {
      try {
        sock.close()
      } catch {
        // 이미 닫힘
      }
      resolve([...found])
    }
    const timer = setTimeout(done, timeoutMs)
    sock.on('error', () => (clearTimeout(timer), done()))
    sock.on('message', (msg) => {
      const m = /^location:\s*(\S+)/im.exec(msg.toString('utf8'))
      if (m) found.add(m[1])
    })
    sock.bind(0, localIp, () => {
      for (const st of SEARCH_TARGETS) {
        const req = `M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${st}\r\n\r\n`
        sock.send(req, 1900, '239.255.255.250', () => {})
      }
    })
  })
}

async function describe(location: string): Promise<{ service: string; controlUrl: string } | null> {
  const res = await fetch(location, { signal: AbortSignal.timeout(4000) })
  if (!res.ok) throw new Error('공유기 정보를 읽지 못했어요.')
  const xml = await res.text()
  const base = /<URLBase>([^<]+)<\/URLBase>/i.exec(xml)?.[1] ?? location
  for (const service of WAN_SERVICES) {
    const idx = xml.indexOf(`<serviceType>${service}</serviceType>`)
    if (idx < 0) continue
    const ctl = /<controlURL>([^<]+)<\/controlURL>/i.exec(xml.slice(idx))
    if (ctl) return { service, controlUrl: new URL(ctl[1], base).toString() }
  }
  return null
}

async function findGateway(): Promise<Gateway | null> {
  if (gatewayCache && Date.now() - gatewayCache.at < CACHE_MS) return gatewayCache
  const found = await Promise.all(localIPv4().map(async (ip) => ({ ip, locations: await ssdpFrom(ip, 2500) })))
  for (const { ip, locations } of found) {
    for (const loc of locations) {
      try {
        const gw = await describe(loc)
        if (gw) return (gatewayCache = { ...gw, localIp: ip, at: Date.now() })
      } catch {
        // 다음 후보로
      }
    }
  }
  return null
}

const esc = (s: unknown): string =>
  String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!)

class SoapError extends Error {
  constructor(
    message: string,
    public code?: string
  ) {
    super(message)
  }
}

async function soap(gw: Gateway, action: string, args: Record<string, string | number> = {}): Promise<string> {
  const params = Object.entries(args)
    .map(([k, v]) => `<${k}>${esc(v)}</${k}>`)
    .join('')
  const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${gw.service}">${params}</u:${action}></s:Body></s:Envelope>`
  const res = await fetch(gw.controlUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${gw.service}#${action}"` },
    body,
    signal: AbortSignal.timeout(5000)
  })
  const text = await res.text()
  if (!res.ok) {
    const code = /<errorCode>(\d+)<\/errorCode>/.exec(text)?.[1]
    throw new SoapError(`UPnP ${action} 실패 (${code ?? res.status})`, code)
  }
  return text
}

const isPrivate = (ip: string): boolean =>
  /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|169\.254\.)/.test(ip)

// 공유기가 외부 IP를 알려 주지 않을 때 쓰는 대안
async function publicIpFromWeb(): Promise<string | null> {
  try {
    const res = await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(5000) })
    const ip = (await res.text()).trim()
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) ? ip : null
  } catch {
    return null
  }
}

export type OpenResult =
  | { ok: true; externalIp: string | null }
  | { ok: false; reason: 'no-upnp' | 'double-nat' | 'error'; message: string; wanIp?: string }

export async function openPort(port: number, description: string): Promise<OpenResult> {
  const gw = await findGateway().catch(() => null)
  if (!gw) return { ok: false, reason: 'no-upnp', message: '공유기가 자동 포트 열기(UPnP)를 지원하지 않거나 꺼져 있어요.' }

  let externalIp: string | null = null
  try {
    externalIp = /<NewExternalIPAddress>([^<]*)</.exec(await soap(gw, 'GetExternalIPAddress'))?.[1] || null
  } catch {
    // 알려 주지 않는 공유기도 있다
  }
  if (externalIp && isPrivate(externalIp)) {
    return {
      ok: false,
      reason: 'double-nat',
      wanIp: externalIp,
      message: `공유기 바깥에 공유기가 하나 더 있어서, 포트를 열어도 밖에서 접속되지 않아요. (공유기가 받은 주소: ${externalIp})`
    }
  }

  const base = {
    NewRemoteHost: '',
    NewExternalPort: port,
    NewProtocol: 'TCP',
    NewInternalPort: port,
    NewInternalClient: gw.localIp,
    NewEnabled: 1,
    NewPortMappingDescription: description
  }
  try {
    try {
      // 1시간짜리로 연다. 켜져 있는 동안은 invite.ts가 주기적으로 다시 요청해 늘리고,
      // 앱이 비정상 종료돼도 공유기가 알아서 닫는다.
      await soap(gw, 'AddPortMapping', { ...base, NewLeaseDuration: LEASE_SECONDS })
    } catch (err) {
      // 725 = 영구 등록(0)만 받는 공유기. 그런 공유기에는 영구로 연다 (앱이 닫을 때 닫는다)
      const code = err instanceof SoapError ? err.code : undefined
      if (code === '725' || code === '402' || code === '501') await soap(gw, 'AddPortMapping', { ...base, NewLeaseDuration: 0 })
      else throw err
    }
  } catch (err) {
    gatewayCache = null
    return { ok: false, reason: 'error', message: `공유기가 포트 열기를 거절했어요. (${(err as Error).message})` }
  }
  return { ok: true, externalIp: externalIp ?? (await publicIpFromWeb()) }
}

export async function closePort(port: number): Promise<boolean> {
  const gw = await findGateway().catch(() => null)
  if (!gw) return false
  try {
    await soap(gw, 'DeletePortMapping', { NewRemoteHost: '', NewExternalPort: port, NewProtocol: 'TCP' })
    return true
  } catch {
    return false
  }
}
