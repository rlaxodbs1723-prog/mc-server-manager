// 플레이어 기록: 누가 언제 들어왔고 얼마나 놀았는지 서버 폴더의 .server-manager-players.json에 적어 둔다.
// 접속자 목록(players 이벤트)이 바뀔 때 전과 비교해서 들어온 사람·나간 사람을 알아낸다.
import fs from 'fs'
import path from 'path'
import type { PlayerRecord } from '../shared-types'
import { onServerEvent } from './runner'

const FILE = '.server-manager-players.json'

interface Stored {
  firstSeen: number
  lastSeen: number
  joins: number
  playMs: number
}

const online = new Map<string, Map<string, number>>() // 서버 폴더 -> (이름 -> 들어온 시각)

function read(folderPath: string): Record<string, Stored> {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(folderPath, FILE), 'utf8'))
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}
const write = (folderPath: string, data: Record<string, Stored>): void => {
  try {
    fs.writeFileSync(path.join(folderPath, FILE), JSON.stringify(data, null, 2))
  } catch {
    // 서버 폴더가 지워졌으면 기록하지 않는다
  }
}

function update(folderPath: string, now: string[]): void {
  const cur = online.get(folderPath) ?? new Map<string, number>()
  online.set(folderPath, cur)
  const data = read(folderPath)
  const t = Date.now()
  let changed = false
  for (const name of now) {
    if (cur.has(name)) continue
    cur.set(name, t)
    const s = (data[name] ??= { firstSeen: t, lastSeen: t, joins: 0, playMs: 0 })
    s.joins++
    s.lastSeen = t
    changed = true
  }
  for (const [name, since] of [...cur]) {
    if (now.includes(name)) continue
    cur.delete(name)
    const s = (data[name] ??= { firstSeen: since, lastSeen: t, joins: 1, playMs: 0 })
    s.playMs += t - since
    s.lastSeen = t
    changed = true
  }
  if (changed) write(folderPath, data)
}

onServerEvent((e) => {
  if (e.type === 'players') update(e.folderPath, e.players)
  if (e.type === 'status' && e.state === 'stopped') update(e.folderPath, [])
})

// 앱을 끌 때 접속 중이던 사람의 시간까지 저장한다
export function flushPlayerLog(): void {
  for (const folderPath of online.keys()) update(folderPath, [])
}

export function getPlayerHistory(folderPath: string): PlayerRecord[] {
  const data = read(folderPath)
  const cur = online.get(folderPath) ?? new Map<string, number>()
  const t = Date.now()
  return Object.entries(data)
    .map(([name, s]) => {
      const since = cur.get(name)
      return { name, ...s, online: since != null, playMs: s.playMs + (since != null ? t - since : 0), lastSeen: since != null ? t : s.lastSeen }
    })
    .sort((a, b) => Number(b.online) - Number(a.online) || b.lastSeen - a.lastSeen)
}
