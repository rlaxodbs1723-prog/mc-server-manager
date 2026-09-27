// 서버 프로세스 실행 · 콘솔 · 종료
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import fs from 'fs'
import net from 'net'
import path from 'path'
import { StringDecoder } from 'string_decoder'
import type { ServerEvent, ServerState } from '../shared-types'

const LOG_LIMIT = 1500 // 화면에 남겨 둘 최대 줄 수
const STOP_TIMEOUT_MS = 180_000 // stop 후 이만큼 지나도 안 꺼지면 강제 종료 (모드가 많으면 저장이 오래 걸린다)
const LATE_REPLY_MS = 15_000 // 조용히 물어본 명령의 늦은 답을 이만큼 더 숨긴다

interface Running {
  proc: ChildProcessWithoutNullStreams
  startedAt: number
  state: ServerState
  log: string[]
  players: Set<string> // 지금 접속 중인 사람
}

// "[..INFO]: Steve joined the game" / "left the game". 26.x부터는 "]: System chat: Steve joined the game"처럼 찍힌다.
// 채팅(<이름> ...)으로 흉내 낼 수 없게 "]: " (또는 "System chat: ") 바로 뒤의 이름만 본다
const JOIN_LEFT = /\]: (?:System chat: )?([A-Za-z0-9_]{3,16}) (joined|left) the game$/
const stripColors = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '').replace(/§./g, '')

const running = new Map<string, Running>() // 서버 폴더 -> 실행 정보
const listeners = new Set<(e: ServerEvent) => void>()
export const onServerEvent = (fn: (e: ServerEvent) => void): (() => boolean) => (listeners.add(fn), () => listeners.delete(fn))
const emit = (e: ServerEvent): void => listeners.forEach((fn) => fn(e))

function setState(folderPath: string, state: ServerState): void {
  const r = running.get(folderPath)
  if (r) r.state = state
  emit({ type: 'status', folderPath, state })
}

// 앱이 조용히 물어본 명령의 답을 가로챈다. true를 돌려주면 그 줄은 콘솔에 보이지 않는다.
const interceptors = new Map<string, Set<(line: string) => boolean>>()
const finishedFns = new WeakSet<(line: string) => boolean>() // 답을 다 받고 늦은 답만 숨기는 중인 것

// 명령어를 콘솔에 보이지 않게 보내고, 답으로 온 줄을 모은다.
// collect가 true를 돌려준 줄만 모으며, idleMs 동안 새 답이 없으면(또는 maxMs가 지나면) 끝낸다.
export function quietQuery(
  folderPath: string,
  commands: string[],
  collect: (line: string) => boolean,
  { idleMs = 500, maxMs = 8000, firstMs = idleMs * 4 }: { idleMs?: number; maxMs?: number; firstMs?: number } = {}
): Promise<string[]> {
  const r = running.get(folderPath)
  if (!r || r.state !== 'running') return Promise.reject(new Error('서버가 켜져 있을 때만 할 수 있어요.'))
  return new Promise((resolve) => {
    const lines: string[] = []
    let idle: ReturnType<typeof setTimeout>
    const set = interceptors.get(folderPath) ?? new Set()
    interceptors.set(folderPath, set)
    // 끝난 질문이 늦은 답을 숨기려고 남겨 둔 것은 치운다. 안 그러면 같은 질문을 곧바로 다시 할 때(예: 규칙을 바꾸고 목록 다시 읽기)
    // 새 답까지 "늦게 온 답"으로 숨겨 버려서 아무 답도 못 받는다. 늦은 답은 이제 새 질문이 가로챈다
    for (const f of set) if (finishedFns.has(f)) set.delete(f)
    let finished = false
    const done = (): void => {
      if (finished) return
      finished = true
      finishedFns.add(fn)
      clearTimeout(idle)
      clearTimeout(max)
      resolve(lines)
      // 서버가 바빠서 답이 늦게 오면 콘솔에 새어 나오므로, 끝난 뒤에도 잠깐 더 가로채서 숨긴다
      setTimeout(() => set.delete(fn), LATE_REPLY_MS).unref()
    }
    const fn = (line: string): boolean => {
      const clean = stripColors(line)
      if (!collect(clean)) return false
      if (finished) return true // 늦게 온 답: 숨기기만 한다
      lines.push(clean)
      clearTimeout(idle)
      idle = setTimeout(done, idleMs)
      return true
    }
    set.add(fn)
    const max = setTimeout(done, maxMs)
    idle = setTimeout(done, firstMs) // 첫 답은 조금 더 기다린다 (서버가 바쁘면 늦게 온다)
    for (const c of commands) r.proc.stdin.write(c.replace(/[\r\n]+/g, ' ') + '\n')
  })
}

function pushLog(folderPath: string, line: string): void {
  for (const fn of interceptors.get(folderPath) ?? []) if (fn(line)) return // 앱이 물어본 답은 콘솔에 안 보인다
  const r = running.get(folderPath)
  if (r) {
    r.log.push(line)
    if (r.log.length > LOG_LIMIT) r.log.splice(0, r.log.length - LOG_LIMIT)
    // 바닐라/Fabric 모두 다 켜지면 "Done (3.2s)! For help, type "help"" 를 찍는다
    if (r.state === 'starting' && /Done \([\d.,]+s\)!/.test(line)) setState(folderPath, 'running')
    const m = JOIN_LEFT.exec(stripColors(line).trimEnd())
    if (m) {
      if (m[2] === 'joined') r.players.add(m[1])
      else r.players.delete(m[1])
      emit({ type: 'players', folderPath, players: [...r.players] })
    }
  }
  emit({ type: 'log', folderPath, line })
}

export const getState = (folderPath: string): ServerState => running.get(folderPath)?.state ?? 'stopped'
export const getStartedAt = (folderPath: string): number | null => running.get(folderPath)?.startedAt ?? null
export const getPid = (folderPath: string): number | undefined => running.get(folderPath)?.proc.pid
export const getPlayers = (folderPath: string): string[] => [...(running.get(folderPath)?.players ?? [])]

// 켜져 있으면 이번 실행의 로그, 꺼져 있으면 logs/latest.log 뒷부분
export function getLog(folderPath: string): string[] {
  const r = running.get(folderPath)
  if (r) return r.log
  try {
    return fs.readFileSync(path.join(folderPath, 'logs', 'latest.log'), 'utf8').split(/\r?\n/).filter(Boolean).slice(-300)
  } catch {
    return []
  }
}

// ---------- EULA ----------
export function isEulaAccepted(folderPath: string): boolean {
  try {
    return /^\s*eula\s*=\s*true\s*$/im.test(fs.readFileSync(path.join(folderPath, 'eula.txt'), 'utf8'))
  } catch {
    return false
  }
}

export function acceptEula(folderPath: string): void {
  const text = `# 마인크래프트 서버 매니저에서 사용자가 EULA(https://aka.ms/MinecraftEULA)에 동의함\n# ${new Date().toISOString()}\neula=true\n`
  fs.writeFileSync(path.join(folderPath, 'eula.txt'), text)
}

// ---------- 실행 ----------
export function serverPort(folderPath: string): number {
  try {
    const m = /^\s*server-port\s*=\s*(\d+)/m.exec(fs.readFileSync(path.join(folderPath, 'server.properties'), 'utf8'))
    if (m) return Number(m[1])
  } catch {
    // 처음 켤 때는 server.properties가 아직 없다
  }
  return 25565
}

// 같은 포트를 이미 다른 프로그램이 쓰고 있으면 서버가 시작하다가 죽는다.
function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port, '0.0.0.0')
  })
}

// ---------- 튕김 감지 ----------
// 사용자가 끄지 않았는데 오류 코드로 꺼지면 튕긴 것이다. 마지막 로그에서 흔한 원인을 찾아 알기 쉽게 알려 준다.
export interface CrashInfo {
  log: string[]
  startedAt: number
  wasRunning: boolean // 다 켜진 뒤에 튕겼는지 (켜지는 중에 꺼지면 설정·모드 문제라 다시 켜도 또 꺼진다)
}
let crashHandler: ((folderPath: string, info: CrashInfo) => void) | null = null
export const onCrash = (fn: (folderPath: string, info: CrashInfo) => void): void => {
  crashHandler = fn
}
export const emitEvent = emit


export interface StartOptions {
  java: string
  args: string[] // java 뒤에 붙는 인자 (메모리, -jar 등)
}

export async function startServer(folderPath: string, { java, args }: StartOptions): Promise<void> {
  if (running.has(folderPath)) throw new Error('이미 실행 중이에요.')
  if (!isEulaAccepted(folderPath)) throw new Error('EULA에 동의해야 서버를 켤 수 있어요.')
  const port = serverPort(folderPath)
  if (!(await portFree(port))) {
    throw new Error(`${port} 포트를 이미 다른 서버나 프로그램이 쓰고 있어요. 그 프로그램을 끄고 다시 켜 주세요.`)
  }
  if (running.has(folderPath)) throw new Error('이미 실행 중이에요.') // 포트 확인하는 사이에 두 번 눌렀을 때

  // 한국어 Windows에서 Java 출력이 CP949로 나와 글자가 깨지지 않도록 UTF-8로 고정한다.
  // 언어도 영어로 고정한다. Fabric 등이 오류를 한국어로 번역하면 튕김 분석이 문장을 알아보지 못한다
  const encoding = ['-Dfile.encoding=UTF-8', '-Dstdout.encoding=UTF-8', '-Dstderr.encoding=UTF-8', '-Duser.language=en', '-Duser.country=US']
  const fullArgs = [...encoding, ...args]
  const proc = spawn(java, fullArgs, { cwd: folderPath, windowsHide: true })
  running.set(folderPath, { proc, startedAt: Date.now(), state: 'starting', log: [], players: new Set() })
  setState(folderPath, 'starting')
  pushLog(folderPath, `> java ${args.join(' ')}`)

  // 한글(3바이트)이 두 조각에 걸쳐 오면 조각마다 글자로 바꿀 때 깨진다. StringDecoder가 모자란 바이트를 다음 조각까지 기다려 준다
  const lineFeeder = (): { feed: (chunk: Buffer) => void; flush: () => void } => {
    const decoder = new StringDecoder('utf8')
    let rest = ''
    return {
      feed: (chunk) => {
        const parts = (rest + decoder.write(chunk)).split(/\r?\n/)
        rest = parts.pop() ?? ''
        parts.forEach((l) => l && pushLog(folderPath, l))
      },
      // 끝날 때 줄바꿈 없이 남은 마지막 줄 (튕길 때 마지막 오류 줄일 수 있다)
      flush: () => {
        const last = rest + decoder.end()
        rest = ''
        if (last.trim()) pushLog(folderPath, last)
      }
    }
  }
  const out = lineFeeder()
  const err = lineFeeder()
  proc.stdout.on('data', out.feed)
  proc.stderr.on('data', err.feed)
  // 서버가 막 죽은 순간에 명령을 보내면 쓰기 오류가 난다. 받아 주지 않으면 앱 전체가 오류로 멈춘다
  proc.stdin.on('error', () => undefined)
  proc.on('error', (e) => pushLog(folderPath, `실행 오류: ${e.message}`))
  proc.on('close', (code) => {
    out.flush()
    err.flush()
    const r = running.get(folderPath)
    const requested = r?.state === 'stopping'
    // 켜지는 중에 꺼지면 (마인크래프트는 초기화에 실패해도 코드 0으로 끝날 때가 있다) 역시 튕긴 것
    const crashed = !requested && (code !== 0 || r?.state === 'starting')
    pushLog(folderPath, crashed ? `[앱] 서버가 비정상 종료됐어요. (코드 ${code})` : `[앱] 서버가 꺼졌어요. (코드 ${code})`)
    running.delete(folderPath)
    setState(folderPath, 'stopped')
    emit({ type: 'players', folderPath, players: [] })
    if (crashed && r) crashHandler?.(folderPath, { log: r.log, startedAt: r.startedAt, wasRunning: r.state === 'running' })
  })
}

// 콘솔에 찍지 않고 명령을 보낸다 (앱이 알아서 하는 일: 환영 메시지·재시작 안내 등)
export function sendQuiet(folderPath: string, command: string): void {
  const r = running.get(folderPath)
  if (!r || r.state === 'stopping') return
  r.proc.stdin.write(command.replace(/[\r\n]+/g, ' ') + '\n')
}

export function sendCommand(folderPath: string, command: string): void {
  const r = running.get(folderPath)
  if (!r) throw new Error('서버가 켜져 있지 않아요.')
  const text = command.replace(/[\r\n]+/g, ' ').trim().replace(/^\//, '') // 콘솔에서는 / 없이 쓴다
  if (!text) return
  pushLog(folderPath, `> ${text}`)
  if (/^stop$/i.test(text)) return stopServer(folderPath)
  r.proc.stdin.write(text + '\n')
}

// stop 명령으로 월드를 저장하고 끄게 한다. force면 바로 강제 종료.
export function stopServer(folderPath: string, force = false): void {
  const r = running.get(folderPath)
  if (!r) return
  if (force) {
    r.state = 'stopping'
    r.proc.kill()
    return
  }
  if (r.state === 'stopping') return
  setState(folderPath, 'stopping')
  r.proc.stdin.write('stop\n')
  const proc = r.proc
  setTimeout(() => {
    if (running.get(folderPath)?.proc === proc) proc.kill()
  }, STOP_TIMEOUT_MS).unref()
}

export const anyRunning = (): boolean => running.size > 0

// 앱을 닫을 때: 켜진 서버 모두에 stop을 보내고 최대 3분 기다린 뒤 남은 것은 강제 종료
export async function stopAll(): Promise<void> {
  const folders = [...running.keys()]
  folders.forEach((f) => stopServer(f))
  const deadline = Date.now() + STOP_TIMEOUT_MS
  while (Date.now() < deadline && folders.some((f) => running.has(f))) await new Promise((r) => setTimeout(r, 200))
  folders.forEach((f) => running.get(f)?.proc.kill())
}
