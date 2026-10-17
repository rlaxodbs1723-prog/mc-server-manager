// 이름 주소: 서버에 이름.cubepanel.kr 같은 주소를 달아 준다. 실제 DNS 기록은 중계 서버(/api/domain)가 만든다.
// 이 컴퓨터의 공인 IP는 중계 서버가 요청에서 직접 알아내므로 앱은 IP를 보내지 않는다.
// 서버를 켜서 공유기 포트가 열릴 때마다 다시 불러서 IP가 바뀌었으면 주소를 갱신한다.
import crypto from 'crypto'
import http from 'http'
import https from 'https'
import dns from 'dns'
import { patchServerInfo, readServerInfo } from './servers'
import { serverPort } from './runner'

// 시험용: MCSM_DOMAIN_RELAY로 다른 주소를 쓴다
const RELAY = (): string => process.env.MCSM_DOMAIN_RELAY ?? 'https://cubepanel.kr/api/domain'
export const DOMAIN_BASE = 'cubepanel.kr'

const NAME_RE = /^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$/
const isBedrock = (folderPath: string): boolean => readServerInfo(folderPath).software === 'bedrock'

// 한글이나 대문자는 받지 않는다 (DNS 이름은 영문 소문자·숫자·하이픈만 된다). 대문자는 소문자로 바꿔 준다
export function cleanDomainName(raw: string): string {
  const name = String(raw ?? '').trim().toLowerCase()
  if (!NAME_RE.test(name)) throw new Error('이름은 영어 소문자, 숫자, 하이픈(-)으로 3~20자로 적어 주세요. (하이픈은 처음과 끝에 쓸 수 없어요)')
  return name
}

const MESSAGES: Record<string, string> = {
  name: '이름은 영어 소문자, 숫자, 하이픈(-)으로 3~20자로 적어 주세요.',
  reserved: '쓸 수 없는 이름이에요. 다른 이름으로 해 주세요.',
  taken: '이미 다른 사람이 쓰는 이름이에요. 다른 이름으로 해 주세요.',
  limit: '이 인터넷 주소로는 이름을 10개까지만 만들 수 있어요.',
  full: '지금은 새 이름을 만들 수 없어요. 나중에 다시 해 주세요.',
  ipv4: '이 인터넷 연결(IPv6)에서는 이름 주소를 쓸 수 없어요.',
  forbidden: '이 이름은 이 서버가 만든 이름이 아니라서 지울 수 없어요.',
  dns: '주소를 만드는 서버가 지금 응답하지 않아요. 잠시 뒤에 다시 해 주세요.',
  'not-configured': '이름 주소 기능이 아직 준비되지 않았어요.'
}

// 중계 서버에 JSON을 보낸다. 컴퓨터가 IPv4와 IPv6를 둘 다 쓰면 기본 방식은 IPv6로 나가서, 중계 서버가 IPv4 주소(포트가 열린 공유기 주소)를 못 본다.
// 그래서 IPv4로 먼저 연결하고, IPv4가 아예 없는 연결이면 기본 방식으로 다시 보낸다 (그때는 IPv6 주소가 연결된다)
function postJson(urlText: string, body: string, timeoutMs: number, family?: 4): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlText)
    const lib = url.protocol === 'http:' ? http : https
    const req = lib.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, ...(family && { family }), timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.end(body)
  })
}

async function call(body: Record<string, unknown>, timeoutMs = 15000): Promise<{ host?: string }> {
  const payload = JSON.stringify(body)
  let res: { status: number; text: string }
  try {
    try {
      res = await postJson(RELAY(), payload, timeoutMs, 4)
    } catch (e) {
      // IPv4로 닿지 못하는 연결(IPv6만 있는 망)이면 기본 방식으로 한 번 더. 그 밖의 오류(시간 초과 등)는 그대로 알린다
      if (!/ENETUNREACH|EADDRNOTAVAIL|EHOSTUNREACH|ENOTFOUND|EAI_AGAIN|EAFNOSUPPORT/.test(String((e as NodeJS.ErrnoException).code ?? e))) throw e
      res = await postJson(RELAY(), payload, timeoutMs)
    }
  } catch {
    throw new Error('주소를 만드는 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.')
  }
  let out: { ok?: boolean; error?: string; host?: string } | null = null
  try {
    out = JSON.parse(res.text)
  } catch {
    out = null
  }
  if (!out?.ok) throw new Error(MESSAGES[out?.error ?? ''] ?? '이름 주소를 만들지 못했어요. 잠시 뒤에 다시 해 주세요.')
  return out
}

// 서버를 만들기 전에 이 이름을 쓸 수 있는지 확인한다 (쓸 수 있으면 true). 아무것도 만들지 않는다
export async function checkDomainName(rawName: string): Promise<boolean> {
  const name = cleanDomainName(rawName)
  const out = (await call({ action: 'check', name })) as { free?: boolean }
  return out.free === true
}

export function getDomain(folderPath: string): { name: string; host: string } | null {
  const d = readServerInfo(folderPath).domain
  return d ? { name: d.name, host: `${d.name}.${DOMAIN_BASE}` } : null
}

// 이름을 정해서 주소를 만든다. 이미 다른 이름이 있으면 그 이름은 지운다. 만든 주소(host)를 돌려준다
export async function claimDomain(folderPath: string, rawName: string): Promise<string> {
  const name = cleanDomainName(rawName)
  const old = readServerInfo(folderPath).domain
  const key = old?.name === name ? old.key : crypto.randomBytes(16).toString('hex')
  const out = await call({ action: 'claim', name, key, port: serverPort(folderPath), ...(isBedrock(folderPath) && { bedrock: true }) })
  patchServerInfo(folderPath, { domain: { name, key }, domainWish: undefined })
  // 이름을 바꿨으면 예전 이름은 비운다 (실패해도 새 이름은 이미 만들어졌다)
  if (old && old.name !== name) await call({ action: 'release', name: old.name, key: old.key }).catch(() => undefined)
  return out.host ?? `${name}.${DOMAIN_BASE}`
}

export async function releaseDomain(folderPath: string): Promise<void> {
  const d = readServerInfo(folderPath).domain
  if (!d) return
  await call({ action: 'release', name: d.name, key: d.key })
  patchServerInfo(folderPath, { domain: undefined })
}

// 터널 주소("xxx.joinmc.link" 또는 "xxx.ply.gg:12345")에서 접속할 호스트와 포트를 알아낸다.
// 포트가 없으면 그 주소의 SRV 기록에서 찾고, 그것도 없으면 25565다
async function tunnelTarget(address: string): Promise<{ target: string; port: number }> {
  const m = /^([^:]+)(?::(\d+))?$/.exec(address.trim())
  if (!m) throw new Error('터널 주소를 읽지 못했어요.')
  const host = m[1].toLowerCase()
  if (m[2]) return { target: host, port: Number(m[2]) }
  try {
    const srv = (await dns.promises.resolveSrv(`_minecraft._tcp.${host}`))[0]
    if (srv) return { target: srv.name.toLowerCase().replace(/\.$/, ''), port: srv.port }
  } catch {
    // SRV가 없으면 기본 포트
  }
  return { target: host, port: 25565 }
}

// 서버를 끌 때: 이름 주소의 DNS 기록만 지운다 (이름은 내 것으로 남고, 다시 켜면 되살아난다). 실패해도 상관없다 (소식이 끊긴 기록은 중계 서버가 자리가 모자랄 때 치운다)
export async function setDomainOffline(folderPath: string): Promise<void> {
  try {
    const d = readServerInfo(folderPath).domain
    if (!d) return
    await call({ action: 'offline', name: d.name, key: d.key }, 5000)
  } catch {
    // 서버 폴더가 이미 지워졌거나 인터넷이 없다
  }
}

// 서버를 켤 때: 이름 주소가 있으면 현재 IP·포트로 갱신하고 주소(host)를 돌려준다. 없거나 실패하면 null (서버 열기에는 영향이 없다)
// tunnelAddress가 있으면 IP 대신 그 터널로 이어 준다
export async function refreshDomain(folderPath: string, tunnelAddress?: string): Promise<string | null> {
  const d = readServerInfo(folderPath).domain
  if (!d) return null
  try {
    const bedrock = isBedrock(folderPath)
    // 배드락은 터널 주소로 이름을 이어 줄 수 없다 (SRV를 못 읽는다)
    if (bedrock && tunnelAddress) return null
    const t = tunnelAddress ? await tunnelTarget(tunnelAddress) : null
    const out = await call(
      t
        ? { action: 'claim', name: d.name, key: d.key, port: t.port, target: t.target }
        : { action: 'claim', name: d.name, key: d.key, port: serverPort(folderPath), ...(bedrock && { bedrock: true }) }
    )
    return out.host ?? `${d.name}.${DOMAIN_BASE}`
  } catch {
    return null
  }
}
