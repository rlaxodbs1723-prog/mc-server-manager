// 터널(playit.gg): 공유기 포트를 열 수 없을 때, playit 중계 서버를 거쳐 밖에서 접속하게 한다.
// 처음 한 번은 플레이어가 브라우저에서 playit 계정으로 이 앱을 승인해야 한다. 그 뒤로는 저장한 키로 알아서 연결한다.
import { execFileSync, spawn, type ChildProcess } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { app, shell } from 'electron'
import { downloadFile } from './download'

const API = 'https://api.playit.gg'
const AGENT_URL = 'https://github.com/playit-cloud/playit-agent/releases/download/v1.0.10/playit-windows-x86_64-signed.exe'
const AGENT_SHA256 = '2dbdaad119844cbbc062cc9774b8b462afa5f1b4b7832a9fc5ef4676cae887cf'
const LINK_TIMEOUT_MS = 10 * 60 * 1000
const ADDRESS_TIMEOUT_MS = 60 * 1000

const dir = (): string => path.join(app.getPath('userData'), 'playit')
const secretFile = (): string => path.join(dir(), 'secret.txt')
const agentExe = (): string => path.join(dir(), 'playit-1.0.10.exe')
const pidFile = (): string => path.join(dir(), 'agent.pid')

let agent: ChildProcess | null = null
const users = new Map<string, number>() // 터널을 쓰는 서버 폴더 -> 포트. 다 꺼지면 에이전트도 끈다

const readSecret = (): string | null => {
  try {
    return fs.readFileSync(secretFile(), 'utf8').trim() || null
  } catch {
    return null
  }
}

export const tunnelLinked = (): boolean => readSecret() != null

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// playit API는 {status: 'success' | 'fail' | 'error', data} 모양으로 답한다
async function call<T>(route: string, body: unknown, secret?: string | null): Promise<T> {
  const res = await fetch(API + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(secret ? { Authorization: `Agent-Key ${secret}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  })
  const json = (await res.json().catch(() => null)) as { status?: string; data?: unknown } | null
  if (json?.status === 'success') return json.data as T
  throw new Error(`playit ${route} 실패 (${JSON.stringify(json?.data ?? res.status)})`)
}

// 브라우저에서 승인 받기: 코드를 만들고 승인 페이지를 연 뒤, 승인될 때까지 기다렸다가 키를 받아 저장한다
export async function linkTunnel(): Promise<void> {
  if (tunnelLinked()) return
  const code = crypto.randomBytes(5).toString('hex')
  const setup = (): Promise<string> =>
    call<string>('/claim/setup', { code, agent_type: 'self-managed', version: 'playit 1.0.10' })
  await setup()
  await shell.openExternal(`https://playit.gg/claim/${code}`)
  const end = Date.now() + LINK_TIMEOUT_MS
  for (;;) {
    if (Date.now() > end) throw new Error('playit 승인을 기다리다 시간이 지났어요. 다시 해 주세요.')
    const state = await setup().catch(() => 'WaitingForUser')
    if (state === 'UserAccepted') break
    if (state === 'UserRejected') throw new Error('playit 승인을 거절했어요.')
    await sleep(2000)
  }
  const { secret_key } = await call<{ secret_key: string }>('/claim/exchange', { code })
  fs.mkdirSync(dir(), { recursive: true })
  fs.writeFileSync(secretFile(), secret_key)
}

export function unlinkTunnel(): void {
  users.clear() // 켜진 서버의 터널 주소는 서버를 다시 켜면 사라진다
  stopAgent()
  fs.rmSync(secretFile(), { force: true })
}

// 키는 명령줄에 쓰지 않고 파일 경로로 넘긴다 (명령줄은 다른 프로그램도 볼 수 있다)
function startAgent(): void {
  if (agent && agent.exitCode == null) return
  killLeftover()
  const child = spawn(agentExe(), ['--secret-path', secretFile(), '--socket-path', '\\\\.\\pipe\\mc-cubepanel-playit', '-l', path.join(dir(), 'agent.log')], {
    windowsHide: true,
    stdio: 'ignore'
  })
  agent = child
  if (child.pid) fs.writeFileSync(pidFile(), String(child.pid))
  child.on('exit', () => {
    if (agent !== child) return
    agent = null
    // 쓰는 서버가 남아 있는데 꺼졌으면 잠시 뒤 다시 켠다
    if (users.size) setTimeout(() => users.size && startAgent(), 5000)
  })
}

// 앱이 비정상으로 꺼지면 에이전트가 남는다. 다음에 켤 때 남은 것을 끈다
function killLeftover(): void {
  try {
    const pid = Number(fs.readFileSync(pidFile(), 'utf8'))
    // 번호가 다른 프로그램에 다시 쓰였을 수 있어서, playit 파일 이름일 때만 끈다
    if (pid)
      execFileSync('taskkill', ['/F', '/PID', String(pid), '/FI', `IMAGENAME eq ${path.basename(agentExe())}`], {
        windowsHide: true,
        stdio: 'ignore'
      })
  } catch {
    // 없거나 이미 꺼짐
  }
  fs.rmSync(pidFile(), { force: true })
}

function stopAgent(): void {
  const child = agent
  agent = null
  child?.kill()
  fs.rmSync(pidFile(), { force: true })
}

interface RunData {
  agent_id: string
  tunnels: { id: string; name: string; display_address: string; tunnel_type: string | null; agent_config: { fields: { name: string; value: string }[] } }[]
}

const localPortOf = (t: RunData['tunnels'][number]): number =>
  Number(t.agent_config.fields.find((f) => f.name === 'local_port')?.value)

// 이 서버 포트로 이어지는 터널을 찾거나 만들고, 에이전트를 켜서 접속 주소를 돌려준다
export async function openTunnel(folderPath: string, port: number): Promise<string> {
  const secret = readSecret()
  if (!secret) throw new Error('playit 연결이 안 되어 있어요.')
  await downloadFile({ url: AGENT_URL, dest: agentExe(), sha256: AGENT_SHA256 })
  // 에이전트가 먼저 켜져 있어야 playit이 이 컴퓨터로 터널을 이어 준다
  users.set(folderPath, port)
  startAgent()
  let run = await call<RunData>('/v1/agents/rundata', {}, secret)
  // 포트를 바꾸면 예전 포트의 터널이 남는다. 지금 켜진 서버들이 쓰지 않는, 이 앱이 만든 터널은 지운다
  const inUse = new Set(users.values())
  for (const t of run.tunnels)
    if (t.name.startsWith('cubepanel-') && !inUse.has(localPortOf(t)))
      await call('/tunnels/delete', { tunnel_id: t.id }, secret).catch(() => {})
  // 막 켠 에이전트가 playit에 버전을 알리기 전에는 AgentVersionTooOld로 거절되므로, 잠깐 기다리며 다시 시도한다
  const createEnd = Date.now() + ADDRESS_TIMEOUT_MS
  while (!run.tunnels.some((t) => localPortOf(t) === port)) {
    try {
      await call('/tunnels/create', {
        name: `cubepanel-${port}`,
        tunnel_type: 'minecraft-java',
        port_type: 'tcp',
        port_count: 1,
        origin: { type: 'agent', data: { agent_id: run.agent_id, local_ip: '127.0.0.1', local_port: port } },
        enabled: true,
        alloc: null,
        firewall_id: null,
        proxy_protocol: null
      }, secret)
      break
    } catch (e) {
      if (!/AgentVersionTooOld|AgentNotFound/.test(String(e)) || Date.now() > createEnd) throw e
      await sleep(3000)
      run = await call<RunData>('/v1/agents/rundata', {}, secret)
    }
  }
  // 새 터널은 주소가 정해지기까지 잠깐 걸린다
  const end = Date.now() + ADDRESS_TIMEOUT_MS
  for (;;) {
    run = await call<RunData>('/v1/agents/rundata', {}, secret)
    const t = run.tunnels.find((x) => localPortOf(x) === port)
    if (t?.display_address) return t.display_address
    if (Date.now() > end) throw new Error('터널 주소를 받지 못했어요.')
    await sleep(2000)
  }
}

export function closeTunnel(folderPath: string): void {
  users.delete(folderPath)
  if (users.size === 0) stopAgent()
}

export function closeAllTunnels(): void {
  users.clear()
  stopAgent()
}
