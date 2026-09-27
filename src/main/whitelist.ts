// 화이트리스트: 서버 폴더의 whitelist.json을 직접 고치고, 서버가 켜져 있으면 reload로 바로 적용한다.
// (서버 명령 whitelist add는 정품 인증을 끈 서버에서도 정품 UUID를 넣어서 접속이 안 되는 문제가 있다)
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import type { WhitelistInfo, WhitelistPlayer } from '../shared-types'
import { HEADERS } from './download'
import { readProperties, writeProperties } from './properties'
import { getState, sendCommand } from './runner'

const PLAYER_NAME = /^[A-Za-z0-9_]{3,16}$/
const fileOf = (folderPath: string): string => path.join(folderPath, 'whitelist.json')
// "켜는 중"에 보낸 명령도 서버가 다 켜진 뒤 차례로 실행된다. 그래서 켜는 중에도 보낸다 (끄는 중은 뺀다)
const isOn = (folderPath: string): boolean => ['starting', 'running'].includes(getState(folderPath))

function readList(folderPath: string): WhitelistPlayer[] {
  try {
    const list = JSON.parse(fs.readFileSync(fileOf(folderPath), 'utf8'))
    return Array.isArray(list) ? list.map((e) => ({ uuid: String(e.uuid), name: String(e.name) })) : []
  } catch {
    return []
  }
}

function writeList(folderPath: string, list: WhitelistPlayer[]): void {
  fs.writeFileSync(fileOf(folderPath), JSON.stringify(list, null, 2))
  if (isOn(folderPath)) sendCommand(folderPath, 'whitelist reload')
}

export function getWhitelist(folderPath: string): WhitelistInfo {
  const props = readProperties(folderPath)
  return {
    enabled: props['white-list'] === 'true',
    onlineMode: props['online-mode'] !== 'false',
    players: readList(folderPath)
  }
}

export function setWhitelistEnabled(folderPath: string, enabled: boolean): void {
  writeProperties(folderPath, { 'white-list': String(enabled) })
  if (isOn(folderPath)) sendCommand(folderPath, enabled ? 'whitelist on' : 'whitelist off') // 켜진 서버는 바로 적용
}

// 정품 인증을 끈 서버는 이름으로 만든 "오프라인 UUID"를 쓴다
function offlineUuid(name: string): string {
  const b = crypto.createHash('md5').update('OfflinePlayer:' + name).digest()
  b[6] = (b[6] & 0x0f) | 0x30
  b[8] = (b[8] & 0x3f) | 0x80
  const h = b.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

async function resolvePlayer(name: string, online: boolean): Promise<WhitelistPlayer> {
  if (!online) return { uuid: offlineUuid(name), name }
  const res = await fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(8000)
  }).catch(() => null)
  if (!res) throw new Error('마인크래프트 계정 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.')
  if (res.status === 204 || res.status === 404) throw new Error(`"${name}" 닉네임의 정품 계정을 찾지 못했어요. 철자를 확인해 주세요.`)
  if (!res.ok) throw new Error(`계정을 확인하지 못했어요. (${res.status})`)
  const p = (await res.json()) as { id: string; name: string }
  const h = p.id
  return { uuid: `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`, name: p.name }
}

export async function addWhitelist(folderPath: string, rawName: string): Promise<WhitelistPlayer> {
  const name = String(rawName ?? '').trim()
  if (!PLAYER_NAME.test(name)) throw new Error('닉네임은 영어, 숫자, _로 3~16자예요.')
  const list = readList(folderPath)
  if (list.some((e) => e.name.toLowerCase() === name.toLowerCase())) throw new Error(`${name}님은 이미 목록에 있어요.`)
  const player = await resolvePlayer(name, getWhitelist(folderPath).onlineMode)
  writeList(folderPath, [...list, player])
  return player
}

export function removeWhitelist(folderPath: string, name: string): void {
  writeList(
    folderPath,
    readList(folderPath).filter((e) => e.name.toLowerCase() !== String(name).toLowerCase())
  )
}
