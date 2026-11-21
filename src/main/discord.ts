// 디스코드 알림: 서버가 켜지고 꺼질 때, 튕길 때, 플레이어가 들어오고 나갈 때 내 디스코드 채널에 알려 준다.
// 채널의 "웹후크 주소"를 서버마다 하나 붙여 넣으면 된다. 주소는 이 컴퓨터의 서버 폴더에만 저장하고(서버 정보 파일과 따로),
// 친구에게 공유하는 서버 정보나 복제본으로는 가지 않는다. 화면에도 끝 네 글자만 보여 준다
import fs from 'fs'
import path from 'path'
import { appLog, onServerEvent } from './runner'
import { readServerInfo } from './servers'
import { tr } from './i18n'
import type { DiscordHookView } from '../shared-types'

const FILE = '.server-manager-discord.json'
export const DISCORD_FILE = FILE
// 디스코드 웹후크 주소 모양만 받는다 (다른 곳으로 보내는 데 쓰이지 않게)
const HOOK_RE = /^https:\/\/(?:discord\.com|discordapp\.com|ptb\.discord\.com|canary\.discord\.com)\/api\/webhooks\/\d{5,25}\/[\w-]{20,200}$/

interface Stored {
  url: string
  start: boolean
  stop: boolean // 꺼짐·튕김
  join: boolean
  leave: boolean
}

function read(folderPath: string): Stored | null {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(folderPath, FILE), 'utf8')) as Partial<Stored>
    if (typeof j.url !== 'string' || !HOOK_RE.test(j.url)) return null
    return { url: j.url, start: j.start !== false, stop: j.stop !== false, join: j.join === true, leave: j.leave === true }
  } catch {
    return null
  }
}

export function getDiscordHook(folderPath: string): DiscordHookView {
  const h = read(folderPath)
  return { configured: !!h, tail: h ? h.url.slice(-4) : '', start: h?.start ?? true, stop: h?.stop ?? true, join: h?.join ?? false, leave: h?.leave ?? false }
}

// url이 없으면 주소는 그대로 두고 알림 종류만 바꾼다. url이 빈 글자면 지운다
export function setDiscordHook(folderPath: string, patch: { url?: string; start?: boolean; stop?: boolean; join?: boolean; leave?: boolean }): DiscordHookView {
  readServerInfo(folderPath) // 서버 폴더인지 확인
  const cur = read(folderPath)
  if (patch.url !== undefined && !patch.url.trim()) {
    fs.rmSync(path.join(folderPath, FILE), { force: true })
    return getDiscordHook(folderPath)
  }
  const url = patch.url !== undefined ? patch.url.trim() : cur?.url
  if (!url) throw new Error('먼저 디스코드 웹후크 주소를 붙여 넣어 주세요.')
  if (!HOOK_RE.test(url)) throw new Error('디스코드 웹후크 주소가 아니에요. 채널 설정 → 연동 → 웹후크에서 "웹후크 URL 복사"를 눌러 붙여 넣어 주세요.')
  const next: Stored = {
    url,
    start: patch.start ?? cur?.start ?? true,
    stop: patch.stop ?? cur?.stop ?? true,
    join: patch.join ?? cur?.join ?? false,
    leave: patch.leave ?? cur?.leave ?? false
  }
  fs.writeFileSync(path.join(folderPath, FILE), JSON.stringify(next))
  return getDiscordHook(folderPath)
}

// 보낸다. 실패해도 서버에는 영향이 없다. 성공하면 null, 실패하면 이유
async function post(url: string, embed: Record<string, unknown>): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'MC CubePanel', allowed_mentions: { parse: [] }, embeds: [{ timestamp: new Date().toISOString(), ...embed }] }),
        signal: AbortSignal.timeout(8000)
      })
      if (res.status === 429 && attempt === 0) {
        const wait = Math.min(5, Number(res.headers.get('retry-after')) || 1)
        await new Promise((r) => setTimeout(r, wait * 1000))
        continue
      }
      if (res.status === 404 || res.status === 401) return tr('이 웹후크가 지워졌거나 맞지 않아요. 디스코드에서 새로 만들어 주세요.')
      if (!res.ok) return fill(tr('디스코드가 받아 주지 않았어요. ({0})'), res.status)
      return null
    } catch {
      return tr('디스코드에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.')
    }
  }
  return tr('디스코드가 너무 바빠요. 잠시 뒤에 다시 해 주세요.')
}

const GREEN = 0x35d07f
const RED = 0xff5555
const GRAY = 0x8b92a0
const BLUE = 0x3182f6
const nameOf = (folderPath: string): string => {
  try {
    return readServerInfo(folderPath).name
  } catch {
    return path.basename(folderPath)
  }
}
const fill = (s: string, ...v: (string | number)[]): string => v.reduce<string>((t, x, i) => t.split(`{${i}}`).join(String(x)), s)

export async function testDiscordHook(folderPath: string): Promise<void> {
  const h = read(folderPath)
  if (!h) throw new Error('먼저 디스코드 웹후크 주소를 붙여 넣어 주세요.')
  const err = await post(h.url, { title: nameOf(folderPath), description: tr('디스코드 알림이 잘 연결됐어요.'), color: BLUE })
  if (err) throw new Error(err)
}

// ---------- 서버 이벤트 → 디스코드 ----------
const wasRunning = new Set<string>() // 켜진 적이 있는 서버 (꺼지면 꺼짐 알림을 보낸다)
const up = new Set<string>() // 지금 완전히 켜져 있는 서버 (켜지는 중·끄는 중에 사람 목록이 비는 것은 알리지 않는다)
const players = new Map<string, Set<string>>()
const pendingJoin = new Map<string, { joined: Set<string>; left: Set<string>; timer: ReturnType<typeof setTimeout> }>()
const stopTimers = new Map<string, ReturnType<typeof setTimeout>>()
// 시험용: MCSM_DISCORD_WAIT_MS로 기다리는 시간을 줄인다
const BATCH_MS = (): number => Number(process.env.MCSM_DISCORD_WAIT_MS) || 3000 // 들어오고 나가는 것을 모아서 한 번에 (도배 방지)
const CRASH_WAIT_MS = (): number => Number(process.env.MCSM_DISCORD_WAIT_MS) || 4000 // 꺼짐 알림은 튕김 알림이 따로 올지 잠깐 기다린다

async function send(folderPath: string, kind: 'start' | 'stop' | 'join' | 'leave', embed: Record<string, unknown>): Promise<void> {
  const h = read(folderPath)
  if (!h || !h[kind]) return
  const err = await post(h.url, { title: nameOf(folderPath), ...embed })
  if (err) appLog(folderPath, fill(tr('[앱] 디스코드 알림을 보내지 못했어요: {0}'), err))
}

function flushPlayers(folderPath: string): void {
  const p = pendingJoin.get(folderPath)
  if (!p) return
  pendingJoin.delete(folderPath)
  const now = players.get(folderPath)?.size ?? 0
  const list = (s: Set<string>): string => [...s].slice(0, 20).join(', ') + (s.size > 20 ? ` +${s.size - 20}` : '')
  if (p.joined.size) void send(folderPath, 'join', { description: fill(tr('{0}님이 들어왔어요 (지금 {1}명)'), list(p.joined), now), color: BLUE })
  if (p.left.size) void send(folderPath, 'leave', { description: fill(tr('{0}님이 나갔어요 (지금 {1}명)'), list(p.left), now), color: GRAY })
}

export function startDiscordNotifications(): void {
  onServerEvent((e) => {
    const folderPath = e.folderPath
    if (!read(folderPath)) {
      // 알림을 안 쓰는 서버는 기억해 둔 것도 정리한다
      wasRunning.delete(folderPath)
      up.delete(folderPath)
      players.delete(folderPath)
      return
    }
    if (e.type === 'status') {
      if (e.state === 'running') up.add(folderPath)
      else up.delete(folderPath)
      if (e.state === 'running' && !wasRunning.has(folderPath)) {
        wasRunning.add(folderPath)
        const t = stopTimers.get(folderPath)
        if (t) clearTimeout(t)
        void send(folderPath, 'start', { description: tr('서버가 켜졌어요. 이제 들어올 수 있어요.'), color: GREEN })
      }
      if (e.state === 'stopped' && wasRunning.has(folderPath)) {
        wasRunning.delete(folderPath)
        players.delete(folderPath)
        // 튕겨서 꺼진 거면 곧 'crashed'가 와서 그 알림을 보낸다. 안 오면 평범하게 꺼진 것이다
        stopTimers.set(
          folderPath,
          setTimeout(() => {
            stopTimers.delete(folderPath)
            void send(folderPath, 'stop', { description: tr('서버가 꺼졌어요.'), color: GRAY })
          }, CRASH_WAIT_MS())
        )
      }
    }
    if (e.type === 'crashed') {
      const t = stopTimers.get(folderPath)
      if (t) {
        clearTimeout(t)
        stopTimers.delete(folderPath)
      }
      void send(folderPath, 'stop', { description: `${tr('서버가 튕겼어요.')}\n${e.reason}${e.restarting ? `\n${tr('잠시 뒤 자동으로 다시 켜요.')}` : ''}`, color: RED })
    }
    if (e.type === 'players') {
      const before = players.get(folderPath) ?? new Set<string>()
      const after = new Set(e.players)
      players.set(folderPath, after)
      if (!up.has(folderPath)) return // 켜지는 중이거나 끄는 중에 사람 목록이 비는 것은 알리지 않는다
      const joined = [...after].filter((n) => !before.has(n))
      const left = [...before].filter((n) => !after.has(n))
      if (!joined.length && !left.length) return
      const cur = pendingJoin.get(folderPath) ?? { joined: new Set<string>(), left: new Set<string>(), timer: setTimeout(() => flushPlayers(folderPath), BATCH_MS()) }
      for (const n of joined) {
        cur.left.delete(n) // 나갔다가 바로 다시 들어오면 들어온 것만
        cur.joined.add(n)
      }
      for (const n of left) {
        if (cur.joined.has(n)) cur.joined.delete(n) // 들어왔다가 바로 나가면 둘 다 알리지 않는다
        else cur.left.add(n)
      }
      pendingJoin.set(folderPath, cur)
    }
  })
}
