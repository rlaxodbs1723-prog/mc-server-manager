// 서버 사용량: 자바 프로세스의 CPU·메모리와 서버 속도(TPS)
// CPU·메모리는 서버마다 PowerShell 하나를 띄워 2초마다 읽는다 (wmic는 최신 Windows에서 빠졌다).
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import os from 'os'
import type { ServerStats } from '../shared-types'
import { getPid, getState, quietQuery } from './runner'
import { readServerInfo } from './servers'

interface Sampler {
  pid: number
  proc: ChildProcessWithoutNullStreams
  last?: { cpuMs: number; at: number }
  cpu: number | null
  memMb: number | null
  touched: number
}
const samplers = new Map<string, Sampler>()
const IDLE_STOP_MS = 15000 // 화면이 안 물어보면 멈춘다

function sampler(folderPath: string, pid: number): Sampler {
  const old = samplers.get(folderPath)
  if (old && old.pid === pid) return old
  old?.proc.kill()
  const script = `while ($true) { $p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if (-not $p) { break }; [Console]::Out.WriteLine("$($p.TotalProcessorTime.TotalMilliseconds) $($p.WorkingSet64)"); Start-Sleep -Seconds 2 }`
  const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true })
  const s: Sampler = { pid, proc, cpu: null, memMb: null, touched: Date.now() }
  let rest = ''
  proc.stdout.on('data', (chunk: Buffer) => {
    const lines = (rest + chunk.toString()).split(/\r?\n/)
    rest = lines.pop() ?? ''
    for (const line of lines) {
      const [cpuMs, mem] = line.trim().split(' ').map(Number)
      if (!Number.isFinite(cpuMs) || !Number.isFinite(mem)) continue
      const now = Date.now()
      if (s.last) s.cpu = Math.min(100, Math.max(0, ((cpuMs - s.last.cpuMs) / (now - s.last.at) / os.cpus().length) * 100))
      s.last = { cpuMs, at: now }
      s.memMb = Math.round(mem / 1024 / 1024)
    }
  })
  proc.on('close', () => samplers.get(folderPath) === s && samplers.delete(folderPath))
  proc.on('error', () => undefined)
  samplers.set(folderPath, s)
  return s
}

setInterval(() => {
  for (const [f, s] of samplers) if (Date.now() - s.touched > IDLE_STOP_MS) (s.proc.kill(), samplers.delete(f))
}, 5000).unref()

export function stopAllSamplers(): void {
  for (const s of samplers.values()) s.proc.kill()
  samplers.clear()
}

// ---------- TPS ----------
// Paper/Purpur: "TPS from last 1m, 5m, 15m: 20.0, ..." / Forge·NeoForge: "Overall: Mean tick time: 1.2 ms. Mean TPS: 20.000"
// 바닐라·Fabric(1.20.3+): tick query → "Average time per tick: 3.2ms" (TPS = 1000 / 틱 시간, 최대 20)
const FROM = String.raw`\]: (?:System chat: )?`
const PAPER = new RegExp(`${FROM}.*TPS from last 1m, 5m, 15m: \*?([\d.]+)`)
const FORGE = new RegExp(`${FROM}Overall.*Mean TPS: ([\d.]+)`)
// 차원마다 한 줄씩 나오는 답 ("Dim minecraft:overworld (...): Mean tick time: ... Mean TPS: 20.000")도 콘솔에 안 보이게 가로챈다
const FORGE_DIM = new RegExp(`${FROM}Dim .*Mean TPS: [\d.]+`)
// tick query 답은 여러 줄이라 둘째 줄부터는 로그 머리 없이 온다
const VANILLA = new RegExp(`(?:${FROM}|^)(?:Average time per tick|Average tick time|Tick time): ([\d.]+) ?ms`, 'i')
const VANILLA_EXTRA = new RegExp(`(?:${FROM}|^)(The game is running normally|Target tick rate|Percentiles|The game is (?:frozen|sprinting)|P50|P95|P99|Sprint)`, 'i')
const tpsMisses = new Map<string, number>() // 답이 없던 횟수. 5번 연속 없으면 이 서버는 알 수 없는 것으로 보고 더 묻지 않는다
const tpsCache = new Map<string, { at: number; tps: number | null }>()

// "1.20.2" → 1.20.3보다 옛날인지. 26.x 같은 새 번호나 스냅숏은 새 버전으로 본다
function before1203(mc: string): boolean {
  const m = /^1\.(\d+)(?:\.(\d+))?/.exec(mc)
  if (!m) return false
  const minor = Number(m[1])
  return minor < 20 || (minor === 20 && Number(m[2] ?? 0) < 3)
}

// 서버 속도를 물어보는 명령 (없는 버전이면 null → 묻지 않는다. 물으면 콘솔에 "Unknown command"가 찍힌다)
function tpsCommand(folderPath: string): string | null {
  const info = readServerInfo(folderPath)
  const sw = info.software ?? 'vanilla'
  if (sw === 'paper' || sw === 'purpur') return 'tps'
  if (sw === 'forge') return 'forge tps'
  if (sw === 'neoforge') return 'neoforge tps'
  return before1203(info.mcVersion) ? null : 'tick query'
}

async function readTps(folderPath: string, pid: number): Promise<number | null> {
  const key = `${folderPath}|${pid}`
  if ((tpsMisses.get(key) ?? 0) >= 5) return null
  const cached = tpsCache.get(key)
  if (cached && Date.now() - cached.at < 5000) return cached.tps
  const command = tpsCommand(folderPath)
  if (!command) return null
  const lines = await quietQuery(folderPath, [command], (l) => PAPER.test(l) || FORGE.test(l) || FORGE_DIM.test(l) || VANILLA.test(l) || VANILLA_EXTRA.test(l), {
    idleMs: 400,
    maxMs: 3000
  }).catch(() => [])
  let tps: number | null = null
  for (const l of lines) {
    const p = PAPER.exec(l) ?? FORGE.exec(l)
    if (p) tps = Number(p[1])
    const v = VANILLA.exec(l)
    if (v && tps == null) tps = Math.min(20, 1000 / Math.max(50, Number(v[1])))
  }
  tpsMisses.set(key, tps == null ? (tpsMisses.get(key) ?? 0) + 1 : 0) // 서버가 바쁠 때 한 번 답이 늦을 수 있어서 바로 포기하지 않는다
  tpsCache.set(key, { at: Date.now(), tps })
  return tps == null ? null : Math.round(tps * 10) / 10
}

export async function getStats(folderPath: string): Promise<ServerStats | null> {
  const pid = getPid(folderPath)
  if (!pid) return null
  const s = sampler(folderPath, pid)
  s.touched = Date.now()
  const tps = getState(folderPath) === 'running' ? await readTps(folderPath, pid) : null
  return { cpu: s.cpu == null ? null : Math.round(s.cpu), memMb: s.memMb, maxMemMb: readServerInfo(folderPath).memoryMb ?? 2048, tps, sysFreeMb: Math.round(os.freemem() / 1048576), sysTotalMb: Math.round(os.totalmem() / 1048576) }
}
