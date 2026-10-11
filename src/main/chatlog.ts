// 채팅 기록: 서버 logs 폴더의 로그 파일에서 채팅, 접속·퇴장, 사망, 발전 과제만 뽑는다.
// 사망·발전 과제 문구는 서버가 영어로 남기므로, 게임 번역 파일로 앱 언어에 맞게 바꾼다 (못 받으면 영어 그대로).
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import type { ChatEvent, ChatLogList } from '../shared-types'
import { gameLang } from './gameassets'
import { getPlayerHistory } from './playerlog'
import { patchServerInfo, readServerInfo } from './servers'

const MAX_EVENTS = 5000
const DEFAULT_KEEP_DAYS = 30 // 따로 정하지 않은 서버는 30일 지난 로그를 지운다
const logsDir = (folderPath: string): string => path.join(folderPath, 'logs')

interface LogFile {
  file: string
  date: string
  size: number
  at: number
  n: number
}

function logFiles(folderPath: string): LogFile[] {
  let names: string[] = []
  try {
    names = fs.readdirSync(logsDir(folderPath)).filter((f) => f === 'latest.log' || /^\d{4}-\d{2}-\d{2}-\d+\.log(\.gz)?$/.test(f))
  } catch {
    return []
  }
  return names.map((file) => {
    const st = fs.statSync(path.join(logsDir(folderPath), file))
    const d = new Date(st.mtimeMs)
    const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    // latest.log는 지금 쓰는 파일이라 그 날의 맨 끝에 둔다
    return { file, date: file === 'latest.log' ? local : file.slice(0, 10), size: st.size, at: st.mtimeMs, n: file === 'latest.log' ? Infinity : Number(file.match(/-(\d+)\.log/)?.[1]) }
  })
}

// 같은 날의 파일(서버를 여러 번 켠 것)은 한 날짜로 합친다. 최근 날짜부터
export function listChatLogs(folderPath: string): ChatLogList {
  const days = new Map<string, number>()
  for (const f of logFiles(folderPath)) days.set(f.date, (days.get(f.date) ?? 0) + f.size)
  return {
    keepDays: readServerInfo(folderPath).logKeepDays ?? DEFAULT_KEEP_DAYS,
    logs: [...days].sort((a, b) => b[0].localeCompare(a[0])).map(([date, size]) => ({ date, size }))
  }
}

// 며칠이 지난 로그 지우기 (0이면 지우지 않는다). 지금 쓰는 latest.log는 두고, 파일 이름의 날짜로 판단한다
export function cleanOldLogs(folderPath: string): void {
  const keep = readServerInfo(folderPath).logKeepDays ?? DEFAULT_KEEP_DAYS
  if (!keep) return
  const limit = new Date()
  limit.setHours(0, 0, 0, 0)
  limit.setDate(limit.getDate() - keep)
  for (const f of logFiles(folderPath)) {
    if (f.file === 'latest.log' || new Date(`${f.date}T00:00:00`) >= limit) continue
    fs.rmSync(path.join(logsDir(folderPath), f.file), { force: true })
  }
}

export function setLogKeepDays(folderPath: string, days: number): void {
  patchServerInfo(folderPath, { logKeepDays: Math.max(0, Math.min(3650, Math.floor(days) || 0)) })
  cleanOldLogs(folderPath)
}

// 로그는 보통 UTF-8이지만, 윈도우 서버에서 한글이 CP949로 남는 경우가 있다
function decode(buf: Buffer): string {
  const utf = buf.toString('utf8')
  const bad = (s: string): number => s.split('\uFFFD').length - 1
  if (!bad(utf)) return utf
  try {
    const kr = new TextDecoder('euc-kr').decode(buf)
    return bad(kr) < bad(utf) ? kr : utf
  } catch {
    return utf
  }
}

// "%1$s was slain by %2$s" 같은 문구를 정규식으로
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
interface DeathRule {
  re: RegExp
  key: string
}
function fill(tpl: string, args: string[]): string {
  let i = 0
  return tpl.replace(/%(?:(\d)\$)?s/g, (_m, n) => args[n ? Number(n) - 1 : i++] ?? '')
}

async function translators(folderPath: string): Promise<{ ready: boolean; death: (msg: string) => string | null; advancement: (title: string) => string }> {
  try {
    const { mcVersion } = readServerInfo(folderPath)
    const [en, local] = await Promise.all([gameLang(mcVersion, 'en_us'), gameLang(mcVersion)])
    const rules: DeathRule[] = Object.entries(en)
      .filter(([k]) => k.startsWith('death.'))
      .sort((a, b) => b[1].length - a[1].length) // 긴(자세한) 문구부터
      .map(([key, tpl]) => ({ key, re: new RegExp(`^${tpl.split(/%(?:\d\$)?s/).map(esc).join('(.+?)')}$`) }))
    const advTitles = new Map<string, string>()
    for (const [k, v] of Object.entries(en)) if (/^advancements\..+\.title$/.test(k) && local[k]) advTitles.set(v, local[k])
    return {
      ready: rules.length > 0,
      death: (msg) => {
        for (const r of rules) {
          const m = msg.match(r.re)
          if (m) return fill(local[r.key] ?? en[r.key], m.slice(1))
        }
        return null
      },
      advancement: (t) => advTitles.get(t) ?? t
    }
  } catch {
    return { ready: false, death: () => null, advancement: (t) => t }
  }
}

// 접속·채팅이 아닌, 플레이어 이름으로 시작하는 서버 메시지 중 사망이 아닌 것
const NOT_DEATH = /^(lost connection|logged in|moved |issued server command|was kicked|has |joined the game|left the game|\[|:)/

export async function readChatLog(folderPath: string, date: string): Promise<ChatEvent[]> {
  const files = logFiles(folderPath)
    .filter((f) => f.date === date)
    .sort((a, b) => a.n - b.n || a.at - b.at)
  if (!files.length) throw new Error('로그 파일을 찾지 못했어요.')
  const text = files
    .map((f) => {
      let buf = fs.readFileSync(path.join(logsDir(folderPath), f.file))
      if (f.file.endsWith('.gz')) buf = zlib.gunzipSync(buf)
      return decode(buf)
    })
    .join('\n')
  const tr = await translators(folderPath)
  const players = new Set<string>(getPlayerHistory(folderPath).map((p) => p.name))
  const out: ChatEvent[] = []
  for (const line of text.split(/\r?\n/)) {
    // [12:34:56] [Server thread/INFO]: 내용  /  [12:34:56 INFO]: 내용  /  [12:34:56] [Server thread/INFO] [minecraft/MinecraftServer]: 내용
    const m = line.match(/^\[(\d\d:\d\d:\d\d)[^\]]*\](?: \[[^\]]*\])*: (.*)$/)
    if (!m || !/INFO/.test(line.slice(0, line.indexOf(m[2])))) continue
    const time = m[1]
    // 26.x 서버는 "System chat: " 같은 말을 앞에 붙인다
    // 서명 안 된 채팅·공지에는 "[Not Secure] "가 붙는다
    const msg = m[2].replace(/^(?:System|Player|Disguised) chat: /, '').replace(/^\[Not Secure\] /, '')
    let mm: RegExpMatchArray | null
    if ((mm = msg.match(/^<([^>]{1,40})> (.*)$/))) {
      players.add(mm[1])
      out.push({ time, kind: 'chat', name: mm[1], text: mm[2] })
    } else if ((mm = msg.match(/^(\S+) joined the game$/))) {
      players.add(mm[1])
      out.push({ time, kind: 'join', name: mm[1], text: '' })
    } else if ((mm = msg.match(/^(\S+) left the game$/))) {
      out.push({ time, kind: 'leave', name: mm[1], text: '' })
    } else if ((mm = msg.match(/^(\S+) has (?:made the advancement|completed the challenge|reached the goal) \[(.+)\]$/))) {
      out.push({ time, kind: 'advancement', name: mm[1], text: tr.advancement(mm[2]) })
    } else if ((mm = msg.match(/^\[(Server|Rcon|서버)\] (.*)$/))) {
      out.push({ time, kind: 'say', name: mm[1], text: mm[2] })
    } else {
      const name = msg.split(' ')[0]
      if (!players.has(name)) continue
      // 게임 번역의 사망 문구와 맞는 것만 사망으로 본다. 번역을 못 받았을 때만 아닌 것을 빼는 방식으로 고른다
      const text = tr.death(msg)
      if (text == null && (tr.ready || NOT_DEATH.test(msg.slice(name.length + 1)))) continue
      out.push({ time, kind: 'death', name, text: text ?? msg })
    }
  }
  return out.slice(-MAX_EVENTS)
}
