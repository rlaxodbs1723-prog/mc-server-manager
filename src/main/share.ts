// 서버 공유: 방장 앱과 친구 앱을 중계 서버의 "방"(share/room.mjs)으로 잇는다.
// - 방장: 공유한 서버마다 방에 붙어 있다가, 친구의 요청 중 허락된 것만 이 앱의 원래 기능으로 실행하고 답한다.
//         서버 로그·상태·접속자 변화는 친구들에게 그대로 알린다
// - 친구: 공유받은 서버를 목록에 "remote:방번호"로 보여 주고, 화면의 요청을 방장에게 보낸다 (remoteipc.ts)
// 서버는 늘 방장 컴퓨터에서 돈다. 방장 앱이 꺼져 있으면 친구 쪽은 "방장 컴퓨터가 꺼져 있어요"가 된다
// 시험용: MCSM_SHARE_RELAY=ws://localhost:8788 (node share/dev-relay.mjs)
import { app, BrowserWindow } from 'electron'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { ServerEvent, ServerListItem, ServerState, ShareDevice, ShareRole, Software } from '../shared-types'
import { localHandler, REMOTE, setRemoteForwarder } from './remoteipc'
import { getState, onServerEvent } from './runner'
import { patchServerInfo, readServerInfo } from './servers'

const RELAY = (): string => process.env.MCSM_SHARE_RELAY ?? 'wss://cubepanel.kr'
const roomUrl = (room: string): string => `${RELAY()}/api/share/${room}`
const hash = (text: string): string => crypto.createHash('sha256').update(`cubepanel-share:${text}`).digest('hex')
const hex = (bytes: number): string => crypto.randomBytes(bytes).toString('hex')

// 친구가 부를 수 있는 기능 (권한별). 여기 없는 것은 방장 앱이 거절한다.
// 되돌릴 수 없는 일(리셋·되돌리기·지우기)과 파일·설정 파일·모드는 넣지 않는다
// 보기만: 콘솔·관리·월드·채팅 탭이 정보를 읽는 데 쓰는 것
const VIEW = new Set([
  'getLog', 'getInvite', 'getStats', 'getManageInfo', 'getPlayerHistory', 'getPlayerData', 'getWhitelist',
  'listChatLogs', 'readChatLog', 'getSettings', 'getHardcore', 'listGameRules', 'getGameRuleLang', 'getBedrockManage', 'getBedrockExperiments'
])
// 관리자: 켜고 끄기·명령·관리 탭·게임 규칙·월드 설정(허락한 칸만, saveSettings 참고)
const ADMIN = new Set<string>([
  ...VIEW,
  'startServer', 'stopServer', 'sendCommand', 'manage', 'addWhitelist', 'removeWhitelist', 'setWhitelistEnabled', 'setGameRule',
  'bedrockAction', 'saveSettings', 'setHardcore', 'setBedrockExperiment', 'setBedrockHardcore', 'setLogKeepDays'
])
// 친구가 바꿀 수 없는 server.properties 칸: 포트·주소·원격 관리(RCON)·월드 이름·리소스팩 주소 등
const LOCKED_PROPS = /^(server-port|server-portv6|server-ip|enable-rcon|rcon\.|enable-query|query\.|level-name|resource-pack|require-resource-pack|management-server|enable-jmx|server-udp-ports|transport)/
// 친구가 보낸 설정 저장 요청에서 허락한 것만 남긴다 (메모리·자바 옵션은 방장 컴퓨터에서 프로그램을 실행하는 방식이라 막는다)
function safeSettings(raw: unknown): object {
  const s = (raw ?? {}) as { properties?: Record<string, unknown>; automation?: { welcome?: unknown } }
  const properties: Record<string, string> = {}
  for (const [k, v] of Object.entries(s.properties ?? {})) if (/^[a-z0-9.-]{1,64}$/.test(k) && !LOCKED_PROPS.test(k)) properties[k] = String(v).slice(0, 500)
  return { properties, ...(s.automation?.welcome != null && { automation: { welcome: String(s.automation.welcome).slice(0, 200) } }) }
}
const allowed = (role: ShareRole, channel: string): boolean => (role === 'admin' ? ADMIN : VIEW).has(channel)

// 웹소켓 하나: 끊기면 점점 늦게 다시 붙는다 (2초 → 최대 1분). stop()을 부르면 다시 붙지 않는다
class Link {
  ws: WebSocket | null = null
  private retry = 2000
  private stopped = false
  private timer: ReturnType<typeof setTimeout> | null = null
  constructor(
    private room: string,
    private hello: () => object,
    private onMsg: (m: Record<string, unknown>) => void,
    private onState: (open: boolean, code?: number) => void
  ) {
    this.open()
  }
  private open(): void {
    if (this.stopped) return
    let ws: WebSocket
    try {
      ws = new WebSocket(roomUrl(this.room))
    } catch {
      return this.later()
    }
    this.ws = ws
    ws.onopen = () => {
      this.retry = 2000
      ws.send(JSON.stringify(this.hello()))
    }
    ws.onmessage = (e) => {
      try {
        this.onMsg(JSON.parse(String(e.data)))
      } catch {
        // 알아들을 수 없는 메시지는 버린다
      }
    }
    ws.onclose = (e) => {
      if (this.ws === ws) this.ws = null
      this.onState(false, e.code)
      // 주인이 아님·끊김·코드 무효는 다시 붙어도 안 된다
      if (e.code === 4003 || e.code === 4004 || e.code === 4001) this.stopped = true
      this.later()
    }
    ws.onerror = () => undefined // onclose가 따라온다
  }
  private later(): void {
    if (this.stopped) return
    this.timer = setTimeout(() => this.open(), this.retry)
    this.retry = Math.min(60_000, this.retry * 2)
  }
  send(obj: object): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify(obj))
    return true
  }
  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.ws?.close()
    this.ws = null
  }
}

// 방에서 오는 특정 답을 기다린다
function waitFor<T>(waiters: ((m: Record<string, unknown>) => boolean)[], pred: (m: Record<string, unknown>) => T | undefined, ms = 10_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const i = waiters.indexOf(fn)
      if (i >= 0) waiters.splice(i, 1)
      reject(new Error('공유 중계 서버가 응답하지 않아요. 인터넷 연결을 확인해 주세요.'))
    }, ms)
    const fn = (m: Record<string, unknown>): boolean => {
      const v = pred(m)
      if (v === undefined) return false
      clearTimeout(timer)
      resolve(v)
      return true
    }
    waiters.push(fn)
  })
}

const toWindows = (e: ServerEvent): void => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('serverEvent', e))

// ===================== 방장 =====================
interface Hosting {
  link: Link
  online: boolean
  waiters: ((m: Record<string, unknown>) => boolean)[]
  logBuf: string[]
  flush: ReturnType<typeof setTimeout> | null
}
const hosting = new Map<string, Hosting>() // 서버 폴더 → 방 연결

function meta(folderPath: string): object {
  const info = readServerInfo(folderPath)
  return { type: 'meta', name: info.name, software: info.software, mcVersion: info.mcVersion, loaderVersion: info.loaderVersion }
}

function hostLink(folderPath: string): void {
  const share = readServerInfo(folderPath).share
  if (!share || hosting.has(folderPath)) return
  const h: Hosting = { online: false, waiters: [], logBuf: [], flush: null, link: null as unknown as Link }
  h.link = new Link(
    share.room,
    () => ({ t: 'auth', as: 'host', key: share.key }),
    (m) => {
      if (m.t === 'ok') h.online = true // 방장으로 들어갔다
      if (h.waiters.some((w, i) => w(m) && (h.waiters.splice(i, 1), true))) return
      if (m.t === 'rpc') void answer(folderPath, h, m)
      // 친구가 들어오면 이 서버가 무엇인지와 지금 상태를 그 친구에게 알린다
      if (m.t === 'joined') {
        h.link.send({ t: 'ev', to: m.device, e: meta(folderPath) })
        h.link.send({ t: 'ev', to: m.device, e: { type: 'status', state: stateOf(folderPath) } })
      }
    },
    (open) => {
      h.online = open
    }
  )
  hosting.set(folderPath, h)
}

const stateOf = (folderPath: string): ServerState => getState(folderPath)

async function answer(folderPath: string, h: Hosting, m: Record<string, unknown>): Promise<void> {
  const reply = (body: object): boolean => h.link.send({ t: 'res', to: m.from, id: m.id, ...body })
  const channel = String(m.m)
  const role = m.role === 'admin' ? 'admin' : 'view'
  if (!allowed(role, channel)) return void reply({ ok: false, error: role === 'view' && ADMIN.has(channel) ? '보기만 할 수 있는 권한이에요.' : '공유받은 서버에서는 할 수 없는 일이에요.' })
  const fn = localHandler(channel)
  if (!fn) return void reply({ ok: false, error: '없는 기능이에요.' })
  try {
    // 화면(창)이 필요한 기능은 허락 목록에 없다. 서버 경로는 방장 쪽 실제 경로로 바꿔 넣는다
    const args = Array.isArray(m.a) ? m.a : []
    if (channel === 'saveSettings') args[0] = safeSettings(args[0])
    if (channel === 'stopServer') args.length = 0 // 강제 종료(저장 없이 끄기)는 방장만
    // 켜기 진행 상황은 방장 화면으로 보내는 것이라 친구 요청에는 버린다
    const event = { sender: { send: () => undefined } } as never
    const value = await fn(event, folderPath, ...args)
    reply({ ok: true, value })
  } catch (e) {
    reply({ ok: false, error: e instanceof Error ? e.message : String(e) })
  }
}

// 서버에 생긴 일을 친구들에게 알린다. 로그는 0.3초씩 모아서 한 번에 (중계 요청 수를 아끼려고)
onServerEvent((e) => {
  const h = hosting.get(e.folderPath)
  if (!h?.online) return
  if (e.type === 'log') {
    h.logBuf.push(e.line)
    h.flush ??= setTimeout(() => {
      h.flush = null
      const lines = h.logBuf.splice(0)
      if (lines.length) h.link.send({ t: 'ev', e: { type: 'logs', lines } })
    }, 300)
    return
  }
  if (e.type === 'status' || e.type === 'players' || e.type === 'invite') {
    const { folderPath: _f, ...rest } = e
    void _f
    h.link.send({ t: 'ev', e: rest })
  }
})

// 앱을 켤 때: 공유 중인 서버들을 방에 붙인다
export function initShareHost(folders: string[]): void {
  for (const f of folders) {
    try {
      if (readServerInfo(f).share) hostLink(f)
    } catch {
      // 정보 파일이 없는 폴더
    }
  }
}

export function startSharing(folderPath: string): void {
  if (!readServerInfo(folderPath).share) patchServerInfo(folderPath, { share: { room: hex(16), key: hex(32) } })
  hostLink(folderPath)
}

async function hostRequest<T>(folderPath: string, msg: object, pred: (m: Record<string, unknown>) => T | undefined): Promise<T> {
  const h = hosting.get(folderPath)
  if (!h) throw new Error('공유하고 있지 않은 서버예요.')
  if (!h.online) throw new Error('공유 중계 서버에 연결하는 중이에요. 잠시 뒤에 다시 해 주세요.')
  const wait = waitFor(h.waiters, pred)
  h.link.send(msg)
  return wait
}

// 초대 코드: "방번호-코드". 코드는 한 번만 쓸 수 있고 기본 하루 동안 유효하다
export async function createShareInvite(folderPath: string, role: ShareRole): Promise<string> {
  const share = readServerInfo(folderPath).share
  if (!share) throw new Error('공유하고 있지 않은 서버예요.')
  const code = crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, 'x')
  const codeHash = hash(code)
  const done = await hostRequest(folderPath, { t: 'invite', codeHash, role: role === 'admin' ? 'admin' : 'view' }, (m) =>
    m.t === 'invited' && m.codeHash === codeHash ? 'ok' : m.t === 'error' && m.of === 'invite' ? 'too-many' : undefined
  )
  if (done === 'too-many') throw new Error('아직 안 쓴 초대 코드가 너무 많아요. 잠시 뒤에 다시 만들어 주세요.')
  return `${share.room}-${code}`
}

export const shareDevices = (folderPath: string): Promise<ShareDevice[]> =>
  hostRequest(folderPath, { t: 'devices' }, (m) => (m.t === 'devices' ? (m.list as ShareDevice[]) : undefined))
export const revokeShareDevice = (folderPath: string, device: string): Promise<ShareDevice[]> =>
  hostRequest(folderPath, { t: 'revoke', device }, (m) => (m.t === 'devices' ? (m.list as ShareDevice[]) : undefined))
export const setShareRole = (folderPath: string, device: string, role: ShareRole): Promise<ShareDevice[]> =>
  hostRequest(folderPath, { t: 'role', device, role }, (m) => (m.t === 'devices' ? (m.list as ShareDevice[]) : undefined))

// 공유 끄기: 친구를 모두 끊고 이 서버의 공유 정보를 지운다 (다시 공유하면 새 방·새 코드)
export async function stopSharing(folderPath: string): Promise<void> {
  const h = hosting.get(folderPath)
  if (h?.online) await hostRequest(folderPath, { t: 'close-room' }, (m) => (m.t === 'closed' ? true : undefined)).catch(() => undefined)
  h?.link.stop()
  hosting.delete(folderPath)
  patchServerInfo(folderPath, { share: undefined })
}

export const shareStatus = (folderPath: string): { sharing: boolean; online: boolean } => ({
  sharing: !!readServerInfo(folderPath).share,
  online: !!hosting.get(folderPath)?.online
})

// ===================== 친구 =====================
interface Joined {
  room: string
  token: string
  device: string
  role: ShareRole
  name: string
  software: Software
  mcVersion: string
  loaderVersion?: string
  addedAt: string
}
interface Remote {
  joined: Joined
  link: Link
  hostOnline: boolean
  state: ServerState
  players: string[]
  log: string[]
  waiters: ((m: Record<string, unknown>) => boolean)[]
  pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>
  nextId: number
}
const LOG_KEEP = 2000
const remotes = new Map<string, Remote>() // 방번호 → 연결
const sharesFile = (): string => path.join(app.getPath('userData'), 'shares.json')

function readJoined(): Joined[] {
  try {
    const list = JSON.parse(fs.readFileSync(sharesFile(), 'utf8'))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}
function writeJoined(): void {
  fs.writeFileSync(sharesFile(), JSON.stringify([...remotes.values()].map((r) => r.joined), null, 2))
}

const emit = (room: string, e: Record<string, unknown>): void => toWindows({ ...e, folderPath: REMOTE + room } as ServerEvent)

function connectRemote(joined: Joined, hello: object = { t: 'auth', as: 'client', token: joined.token }): Remote {
  const r: Remote = { joined, hostOnline: false, state: 'stopped', players: [], log: [], waiters: [], pending: new Map(), nextId: 1, link: null as unknown as Link }
  r.link = new Link(
    joined.room,
    () => (joined.token ? { t: 'auth', as: 'client', token: joined.token } : hello),
    (m) => {
      if (r.waiters.some((w, i) => w(m) && (r.waiters.splice(i, 1), true))) return
      if (m.t === 'host') {
        r.hostOnline = !!m.online
        if (!r.hostOnline) r.state = 'stopped'
        emit(joined.room, { type: 'status', state: r.state })
        toWindows({ type: 'shares', folderPath: '' })
      } else if (m.t === 'role') {
        r.joined.role = m.role === 'admin' ? 'admin' : 'view'
        writeJoined()
        toWindows({ type: 'shares', folderPath: '' })
      } else if (m.t === 'res') {
        const p = r.pending.get(Number(m.id))
        if (!p) return
        r.pending.delete(Number(m.id))
        clearTimeout(p.timer)
        if (m.ok) p.resolve(m.value)
        else p.reject(new Error(m.error === 'host-offline' ? '방장 컴퓨터가 꺼져 있어요. 방장이 CubePanel을 켜면 다시 연결돼요.' : String(m.error ?? '오류가 났어요.')))
      } else if (m.t === 'ev') onHostEvent(r, (m.e ?? {}) as Record<string, unknown>)
    },
    (open, code) => {
      if (!open) {
        // 들어가다 막혔으면(코드 무효·인원 꽉 참 등) 기다리던 쪽에 바로 알린다
        for (const w of r.waiters.splice(0)) w({ t: 'closed', code })
        r.hostOnline = false
        if (code === 4003) toWindows({ type: 'shares', folderPath: '' }) // 방장이 끊었다
        emit(joined.room, { type: 'status', state: 'stopped' })
      }
    }
  )
  return r
}

function onHostEvent(r: Remote, e: Record<string, unknown>): void {
  const room = r.joined.room
  if (e.type === 'meta') {
    Object.assign(r.joined, { name: String(e.name ?? r.joined.name), software: e.software ?? r.joined.software, mcVersion: String(e.mcVersion ?? ''), loaderVersion: e.loaderVersion as string | undefined })
    writeJoined()
    toWindows({ type: 'shares', folderPath: '' })
  } else if (e.type === 'logs' && Array.isArray(e.lines)) {
    for (const line of e.lines) {
      r.log.push(String(line))
      emit(room, { type: 'log', line: String(line) })
    }
    if (r.log.length > LOG_KEEP) r.log.splice(0, r.log.length - LOG_KEEP)
  } else if (e.type === 'status') {
    r.state = e.state as ServerState
    emit(room, { type: 'status', state: r.state })
  } else if (e.type === 'players') {
    r.players = Array.isArray(e.players) ? e.players.map(String) : []
    emit(room, { type: 'players', players: r.players })
  } else if (e.type === 'invite') emit(room, { type: 'invite', invite: e.invite })
}

// 화면의 요청을 방장에게 보낸다 (remoteipc가 부른다)
setRemoteForwarder(async (room, channel, args) => {
  const r = remotes.get(room)
  if (!r) throw new Error('목록에 없는 공유 서버예요.')
  // 로그는 방장이 꺼져 있어도 받아 둔 것을 보여 준다
  if (channel === 'getLog' && !r.hostOnline) return r.log
  const id = r.nextId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      r.pending.delete(id)
      reject(new Error('방장 컴퓨터가 응답하지 않아요.'))
    }, 20_000)
    r.pending.set(id, { resolve, reject, timer })
    if (!r.link.send({ t: 'rpc', id, m: channel, a: args })) {
      r.pending.delete(id)
      clearTimeout(timer)
      reject(new Error('공유 중계 서버에 연결하는 중이에요. 잠시 뒤에 다시 해 주세요.'))
    }
  }).then((v) => {
    if (channel === 'getLog' && Array.isArray(v)) r.log = v.map(String).slice(-LOG_KEEP)
    return v
  })
})

export function initShareClient(): void {
  for (const j of readJoined()) if (j.room && j.token && !remotes.has(j.room)) remotes.set(j.room, connectRemote(j))
}

// 공유 코드("방번호-코드")로 친구 서버를 목록에 넣는다. 넣은 서버의 경로(remote:방번호)를 돌려준다
export async function joinShare(input: string): Promise<string> {
  const m = /^\s*([0-9a-f]{32})-([A-Za-z0-9]{6,16})\s*$/.exec(String(input))
  if (!m) throw new Error('공유 코드가 맞지 않아요. 방장에게 받은 코드를 그대로 붙여 넣어 주세요.')
  const [, room, code] = m
  if (remotes.has(room)) return REMOTE + room
  const joined: Joined = { room, token: '', device: '', role: 'view', name: '공유받은 서버', software: 'vanilla', mcVersion: '', addedAt: new Date().toISOString() }
  const r = connectRemote(joined, { t: 'auth', as: 'join', code, name: os.hostname() })
  const ok = await waitFor(r.waiters, (msg) => (msg.t === 'ok' || msg.t === 'closed' ? msg : undefined), 15_000).catch((e) => {
    r.link.stop()
    throw e
  })
  if (ok.t !== 'ok' || !ok.token) {
    r.link.stop()
    throw new Error(ok.code === 4005 ? '이 서버를 공유받은 기기가 너무 많아요. 방장에게 말해 주세요.' : '공유 코드가 맞지 않거나, 이미 썼거나, 기한이 지났어요. 방장에게 새 코드를 받아 주세요.')
  }
  Object.assign(joined, { token: String(ok.token), device: String(ok.device), role: ok.role === 'admin' ? 'admin' : 'view' })
  remotes.set(room, r)
  writeJoined()
  toWindows({ type: 'shares', folderPath: '' })
  return REMOTE + room
}

export function leaveShare(room: string): void {
  remotes.get(room)?.link.stop()
  remotes.delete(room)
  writeJoined()
  toWindows({ type: 'shares', folderPath: '' })
}

// 서버 목록에 같이 보여 줄 공유받은 서버들
export function remoteServers(): ServerListItem[] {
  return [...remotes.values()].map((r) => ({
    name: r.joined.name,
    software: r.joined.software,
    mcVersion: r.joined.mcVersion,
    loaderVersion: r.joined.loaderVersion,
    folderPath: REMOTE + r.joined.room,
    createdAt: r.joined.addedAt,
    state: r.state,
    eulaAccepted: true,
    icon: null,
    startedAt: null,
    playerCount: r.players.length,
    modCount: null,
    lastBackupAt: null,
    remote: { role: r.joined.role, hostOnline: r.hostOnline }
  }))
}
