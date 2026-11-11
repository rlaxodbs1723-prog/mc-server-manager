// 서버 프로세스 실행 · 콘솔 · 종료
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import fs from 'fs'
import dgram from 'dgram'
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
  bedrock: boolean // 배드락 서버 (로그 모양이 다르다)
  xuids: Map<string, string> // 배드락: 접속자 이름 → Xbox 번호 (관리자 권한은 이 번호로 적힌다)
  failTimer?: ReturnType<typeof setTimeout> // 켜지다 실패했는데 프로그램이 안 꺼질 때 끄는 타이머
  worldErrorShown?: boolean // 이번에 켠 동안 월드 파일 오류를 이미 알렸다
}

// "[..INFO]: Steve joined the game" / "left the game". 26.x부터는 "]: System chat: Steve joined the game"처럼 찍힌다.
// 채팅(<이름> ...)으로 흉내 낼 수 없게 "]: " (또는 "System chat: ") 바로 뒤의 이름만 본다
// 이름: Geyser(배드락 친구)로 들어온 사람은 ".Steve"처럼 앞에 점·별이 붙는다. 이름을 바꾼 사람은 뒤에 "(formerly known as …)"가 붙는다
const JOIN_LEFT = /\]: (?:System chat: )?([.*]?[A-Za-z0-9_]{1,16})(?: \(formerly known as \S+\))? (joined|left) the game$/
// 플러그인이 입장·퇴장 메시지를 바꾸거나 숨겨도 서버가 늘 찍는 줄: "Steve[/1.2.3.4:5678] logged in with entity id …" / "Steve lost connection: …"
const LOGGED_IN = /\]: ([.*]?[A-Za-z0-9_]{1,16})\[[^\]]*\] logged in with entity id /
const LOST_CONNECTION = /\]: ([.*]?[A-Za-z0-9_]{1,16}) lost connection: /
// 배드락 서버: "Player connected: Steve, xuid: 123" / "Player disconnected: Steve, xuid: 123" (이름에 공백이 있을 수 있다)
const BEDROCK_JOIN_LEFT = /Player (connected|disconnected): (.+?), xuid: (\d*)/
const stripColors =(s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '').replace(/§./g, '')

const running = new Map<string, Running>() // 서버 폴더 -> 실행 정보
// 꺼진 서버의 마지막 실행 로그 (앱이 켜져 있는 동안). 앱 안내 줄([앱] …)은 로그 파일에 없어서 여기에 남겨 둔다
const lastLog = new Map<string, string[]>()
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
    if (r.state === 'starting' && (r.bedrock ? /Server started\./.test(line) : /Done \([\d.,]+s\)!/.test(line))) setState(folderPath, 'running')
    // Forge는 모드를 불러오다 실패해도 안 꺼지고 계속 떠 있다 (다른 모드의 백그라운드 작업이 남아서). 앱이 모르면 "켜는 중"에서 영원히 멈춘다.
    // 실패 줄이 찍히면 마지막 오류 줄이 다 나올 때까지 잠깐 기다렸다가 끄고, 튕긴 것으로 처리한다
    if (r.state === 'starting' && !r.failTimer && /Failed to start the minecraft server/i.test(stripColors(line))) {
      r.failTimer = setTimeout(() => {
        if (running.get(folderPath) === r && r.state === 'starting') r.proc.kill()
      }, 4000)
    }
    const clean = stripColors(line).trimEnd()
    if (!r.bedrock && r.state === 'running' && !r.worldErrorShown && WORLD_ERROR.test(clean)) {
      r.worldErrorShown = true
      setTimeout(() => running.get(folderPath) === r && worldErrorHandler?.(folderPath), 1500).unref()
    }
    if (!r.bedrock && JOIN_ERROR.test(clean) && Date.now() - (lastJoinError.get(folderPath) ?? 0) > 30_000) {
      lastJoinError.set(folderPath, Date.now())
      setTimeout(() => running.get(folderPath) === r && joinErrorHandler?.(folderPath, r.log), 1500).unref()
    }
    const m = r.bedrock ? BEDROCK_JOIN_LEFT.exec(clean) : JOIN_LEFT.exec(clean)
    const login = r.bedrock || m ? null : LOGGED_IN.exec(clean)
    const lost = r.bedrock || m || login ? null : LOST_CONNECTION.exec(clean)
    const seen: [string, boolean] | null = m
      ? r.bedrock
        ? [m[2], m[1] === 'connected']
        : [m[1], m[2] === 'joined']
      : login
        ? [login[1], true]
        : lost
          ? [lost[1], false]
          : null
    // 한 사람이 들어오고 나갈 때 두 줄씩 찍히므로(logged in → joined, lost connection → left) 바뀐 게 있을 때만 알린다
    if (seen && seen[1] !== r.players.has(seen[0])) {
      const [who, joined] = seen
      if (joined) {
        r.players.add(who)
        if (r.bedrock && m?.[3]) r.xuids.set(who, m[3])
      } else r.players.delete(who)
      emit({ type: 'players', folderPath, players: [...r.players] })
    } else if (seen && seen[1] && r.bedrock && m?.[3]) r.xuids.set(seen[0], m[3])
  }
  emit({ type: 'log', folderPath, line })
}

export const getState = (folderPath: string): ServerState => running.get(folderPath)?.state ?? 'stopped'
export const getStartedAt = (folderPath: string): number | null => running.get(folderPath)?.startedAt ?? null
export const getPid = (folderPath: string): number | undefined => running.get(folderPath)?.proc.pid
export const getPlayers = (folderPath: string): string[] => [...(running.get(folderPath)?.players ?? [])]

// 로그로 놓친 접속자를 바로잡는다 (자바만): 서버에 list를 몰래 물어서 지금 접속 중인 사람으로 맞춘다.
// 플러그인이 list를 바꿔 놓았을 수 있어 minecraft:list(원래 명령)로 묻는다. 답을 못 알아들으면 아무것도 안 바꾼다
const LIST_ANSWER = /There are (\d+) (?:of a max of |\/ ?)\d+ players online:(.*)$/
export async function syncPlayers(folderPath: string): Promise<void> {
  const r = running.get(folderPath)
  if (!r || r.bedrock || r.state !== 'running') return
  const lines = await quietQuery(folderPath, ['minecraft:list'], (l) => LIST_ANSWER.test(stripColors(l)), { idleMs: 300, maxMs: 3000 }).catch(() => [] as string[])
  const m = lines.map((l) => LIST_ANSWER.exec(stripColors(l).trimEnd())).find((x) => x)
  if (!m || running.get(folderPath) !== r) return
  const names = m[2].split(',').map((s) => s.trim()).filter(Boolean)
  if (names.length !== Number(m[1])) return // 옛 버전처럼 이름이 다음 줄에 오는 등 알아듣지 못한 답
  if (names.length === r.players.size && names.every((n) => r.players.has(n))) return
  r.players = new Set(names)
  emit({ type: 'players', folderPath, players: [...r.players] })
}
export const getXuid = (folderPath: string, name: string): string | undefined => running.get(folderPath)?.xuids.get(name)

// 켜져 있으면 이번 실행의 로그, 꺼져 있으면 마지막 실행 로그(앱을 켠 뒤에 켰던 서버) 또는 logs/latest.log 뒷부분
export function getLog(folderPath: string): string[] {
  const r = running.get(folderPath)
  if (r) return r.log
  const last = lastLog.get(folderPath)
  if (last) return last
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
  const text = `# MC CubePanel에서 사용자가 EULA(https://aka.ms/MinecraftEULA)에 동의함\n# ${new Date().toISOString()}\neula=true\n`
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
  return fs.existsSync(path.join(folderPath, 'bedrock_server.exe')) ? 19132 : 25565
}

// 같은 포트를 이미 다른 프로그램이 쓰고 있으면 서버가 시작하다가 죽는다.
function portFree(port: number, udp = false): Promise<boolean> {
  if (udp) {
    return new Promise((resolve) => {
      const sock = dgram.createSocket('udp4')
      sock.once('error', () => resolve(false))
      sock.bind(port, '0.0.0.0', () => sock.close(() => resolve(true)))
    })
  }
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

// 켜진 채로 접속만 실패하는 오류가 찍히면 알려 준다 (오류 줄이 다 나올 때까지 잠깐 기다린다). 같은 서버는 30초에 한 번만
export const JOIN_ERROR = /Couldn't place player in world/
let joinErrorHandler: ((folderPath: string, log: string[]) => void) | null = null
export const onJoinError = (fn: (folderPath: string, log: string[]) => void): void => {
  joinErrorHandler = fn
}
const lastJoinError = new Map<string, number>()

// 켜진 채로 월드(청크·지역) 파일을 못 읽는 오류: 서버는 안 꺼지는데 그 자리 땅이 안 불러와져 플레이어가 끝없이 떨어진다.
// 컴퓨터가 갑자기 꺼지거나 강제로 끈 뒤에 흔하다. 한 번 켤 때 한 번만 알린다
// ("Chunk file at … is in the wrong location"은 서버가 알아서 옮기는 정상 경고라 넣지 않는다)
export const WORLD_ERROR = /Couldn't load chunk|Failed to read chunk|Exception reading [^\n]*(?:\.mca|region)|(?:chunk|region)[^\n]*corrupt|corrupt[^\n]*(?:chunk|region)|Not in GZIP format|Unexpected end of ZLIB input stream/i
let worldErrorHandler: ((folderPath: string) => void) | null = null
export const onWorldError = (fn: (folderPath: string) => void): void => {
  worldErrorHandler = fn
}

// 켜져 있는 동안 서버 폴더에 남겨 두는 표시. 정상으로 꺼지면 지운다. 다음에 켤 때 남아 있으면 지난번에 갑자기 꺼진 것이다 (컴퓨터 강제 종료 등)
const RUNNING_MARK = '.server-manager-running'

// 앱이 콘솔에 남기는 안내 줄 ([앱] …). 화면에 보내고, 다른 서버를 보다 돌아와도 보이게 로그에도 남긴다
export function appLog(folderPath: string, line: string): void {
  const text = line.startsWith('[앱]') ? line : `[앱] ${line}`
  const log = running.get(folderPath)?.log ?? lastLog.get(folderPath)
  if (log) {
    log.push(text)
    if (log.length > LOG_LIMIT) log.splice(0, log.length - LOG_LIMIT)
  } else lastLog.set(folderPath, [text])
  emit({ type: 'log', folderPath, line: text })
}


export interface StartOptions {
  java: string // 배드락이면 bedrock_server.exe 경로
  args: string[] // java 뒤에 붙는 인자 (메모리, -jar 등)
  bedrock?: boolean
}

export async function startServer(folderPath: string, { java, args, bedrock = false }: StartOptions): Promise<void> {
  if (running.has(folderPath)) throw new Error('이미 실행 중이에요.')
  if (!isEulaAccepted(folderPath)) throw new Error('EULA에 동의해야 서버를 켤 수 있어요.')
  const port = serverPort(folderPath)
  if (!(await portFree(port, bedrock))) {
    throw new Error(`${port} 포트를 이미 다른 서버나 프로그램이 쓰고 있어요. 그 프로그램을 끄고 다시 켜 주세요.`)
  }
  if (running.has(folderPath)) throw new Error('이미 실행 중이에요.') // 포트 확인하는 사이에 두 번 눌렀을 때

  // 한국어 Windows에서 Java 출력이 CP949로 나와 글자가 깨지지 않도록 UTF-8로 고정한다.
  // 언어도 영어로 고정한다. Fabric 등이 오류를 한국어로 번역하면 튕김 분석이 문장을 알아보지 못한다
  const encoding = bedrock ? [] : ['-Dfile.encoding=UTF-8', '-Dstdout.encoding=UTF-8', '-Dstderr.encoding=UTF-8', '-Duser.language=en', '-Duser.country=US']
  const fullArgs = [...encoding, ...args]
  const mark = path.join(folderPath, RUNNING_MARK)
  const uncleanLast = fs.existsSync(mark)
  const proc = spawn(java, fullArgs, { cwd: folderPath, windowsHide: true })
  running.set(folderPath, { proc, startedAt: Date.now(), state: 'starting', log: [], players: new Set(), bedrock, xuids: new Map() })
  setState(folderPath, 'starting')
  pushLog(folderPath, bedrock ? '> bedrock_server' : `> java ${args.join(' ')}`)
  if (uncleanLast) {
    appLog(folderPath, '[앱] 지난번에 서버가 제대로 꺼지지 않았어요 (컴퓨터가 갑자기 꺼졌거나 앱이 강제로 닫혔어요).')
    appLog(folderPath, '[앱]   땅이 안 불러와지거나 끝없이 떨어지면 월드 파일이 깨진 거예요. 서버를 끄고 백업 탭에서 최근 백업으로 되돌려 주세요.')
  }
  try {
    fs.writeFileSync(mark, String(Date.now()))
  } catch {
    // 표시를 못 남겨도 서버는 켠다
  }

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
    if (r?.failTimer) clearTimeout(r.failTimer)
    const requested = r?.state === 'stopping'
    // 켜지는 중에 꺼지면 (마인크래프트는 초기화에 실패해도 코드 0으로 끝날 때가 있다) 역시 튕긴 것
    const crashed = !requested && (code !== 0 || r?.state === 'starting')
    pushLog(folderPath, crashed ? `[앱] 서버가 비정상 종료됐어요. (코드 ${code})` : `[앱] 서버가 꺼졌어요. (코드 ${code})`)
    if (r) lastLog.set(folderPath, r.log)
    fs.rmSync(path.join(folderPath, RUNNING_MARK), { force: true }) // 프로그램이 끝까지 꺼졌다 (튕겼어도 그 원인은 따로 알린다)
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

// shown: 콘솔에 보여 줄 모양 (서버에 보내는 명령이 \uXXXX처럼 읽기 어려울 때 사람이 읽는 글로)
export function sendCommand(folderPath: string, command: string, shown?: string): void {
  const r = running.get(folderPath)
  if (!r) throw new Error('서버가 켜져 있지 않아요.')
  const text = command.replace(/[\r\n]+/g, ' ').trim().replace(/^\//, '') // 콘솔에서는 / 없이 쓴다
  if (!text) return
  pushLog(folderPath, `> ${shown ?? text}`)
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
