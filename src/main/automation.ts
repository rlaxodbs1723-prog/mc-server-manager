// 서버 자동 동작 (서버 설정 > 자동)
// - 매일 정한 시각에 다시 켜기 (1분 전에 게임 안에 알린다)
// - 아무도 없이 정한 시간이 지나면 끄기
// - 앱을 켜면 서버도 켜기
// - 들어온 사람에게 환영 메시지
import { DEFAULT_AUTOMATION, type ServerAutomation } from '../shared-types'
import { notify } from './notify'
import os from 'os'
import { emitEvent, getPlayers, getState, onServerEvent, sendQuiet, serverPort, stopServer } from './runner'
import { listServers, readServerInfo } from './servers'

const PLAYER_NAME = /^[A-Za-z0-9_]{3,16}$/

function automationOf(folderPath: string): ServerAutomation {
  try {
    return { ...DEFAULT_AUTOMATION, ...readServerInfo(folderPath).automation }
  } catch {
    return DEFAULT_AUTOMATION // 서버가 지워졌다
  }
}

const appLog = (folderPath: string, line: string): void => emitEvent({ type: 'log', folderPath, line: `[앱] ${line}` })

// 서버를 켜는 방법은 index.ts가 넘겨준다 (기본 모드 확인 등 사용자가 켤 때와 똑같이 켜려고)
let starter: ((folderPath: string) => Promise<void>) | null = null
export function setStarter(fn: (folderPath: string) => Promise<void>): void {
  starter = fn
}

// ---------- 환영 메시지 · 빈 서버 ----------
const lastPlayers = new Map<string, Set<string>>()
const emptySince = new Map<string, number>() // 서버 폴더 → 아무도 없게 된 시각

onServerEvent((e) => {
  if (e.type === 'status') {
    if (e.state === 'running') emptySince.set(e.folderPath, Date.now()) // 막 켜졌을 때는 아무도 없다
    if (e.state === 'stopped') {
      emptySince.delete(e.folderPath)
      lastPlayers.delete(e.folderPath)
    }
  }
  if (e.type !== 'players') return
  const before = lastPlayers.get(e.folderPath) ?? new Set<string>()
  const now = new Set(e.players)
  lastPlayers.set(e.folderPath, now)
  if (now.size) emptySince.delete(e.folderPath)
  else if (!emptySince.has(e.folderPath) && getState(e.folderPath) === 'running') emptySince.set(e.folderPath, Date.now())

  const { welcome } = automationOf(e.folderPath)
  if (!welcome.trim()) return
  for (const name of now) {
    if (before.has(name) || !PLAYER_NAME.test(name)) continue
    const text = welcome.replace(/\{name\}/g, name)
    // tellraw: 그 사람에게만, 앱이 보낸 티 없이 보인다. 콘솔에는 안 찍는다
    setTimeout(() => sendQuiet(e.folderPath, `tellraw ${name} ${JSON.stringify({ text, color: 'yellow' })}`), 1500)
  }
})

// ---------- 매일 다시 켜기 ----------
const restartedOn = new Map<string, string>() // 서버 폴더 → 이미 다시 켠 날짜 (하루에 한 번만)
const restarting = new Set<string>()

const today = (d: Date): string => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
const hhmm = (d: Date): string => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

async function dailyRestart(folderPath: string): Promise<void> {
  restarting.add(folderPath)
  try {
    sendQuiet(folderPath, `say 서버가 1분 뒤에 다시 시작돼요. 잠시 뒤에 다시 들어와 주세요.`)
    appLog(folderPath, '매일 다시 켜기: 1분 뒤에 서버를 다시 켜요.')
    await new Promise((r) => setTimeout(r, 60_000))
    if (getState(folderPath) !== 'running') return // 그사이 사용자가 껐다
    stopServer(folderPath)
    // 다 꺼질 때까지 기다린다 (최대 3분 + 여유)
    const deadline = Date.now() + 200_000
    while (getState(folderPath) !== 'stopped' && Date.now() < deadline) await new Promise((r) => setTimeout(r, 1000))
    if (getState(folderPath) !== 'stopped' || !starter) return
    await starter(folderPath)
  } catch (e) {
    appLog(folderPath, `다시 켜지 못했어요: ${e instanceof Error ? e.message : e}`)
  } finally {
    restarting.delete(folderPath)
  }
}

// 30초마다 확인한다
setInterval(() => {
  const now = new Date()
  let servers: ReturnType<typeof listServers> = []
  try {
    servers = listServers()
  } catch {
    return
  }
  for (const s of servers) {
    if (s.state !== 'running') continue
    const a = automationOf(s.folderPath)
    // 빈 서버 끄기
    const since = emptySince.get(s.folderPath)
    if (a.emptyStopMin > 0 && since != null && getPlayers(s.folderPath).length === 0 && Date.now() - since >= a.emptyStopMin * 60_000 && !restarting.has(s.folderPath)) {
      emptySince.delete(s.folderPath)
      appLog(s.folderPath, `${a.emptyStopMin}분 동안 아무도 없어서 서버를 꺼요.`)
      notify(`${s.name} 서버를 껐어요`, `${a.emptyStopMin}분 동안 아무도 없었어요.`)
      stopServer(s.folderPath)
      continue
    }
    // 매일 다시 켜기
    if (a.dailyRestart && hhmm(now) === a.dailyRestart && restartedOn.get(s.folderPath) !== today(now) && !restarting.has(s.folderPath)) {
      restartedOn.set(s.folderPath, today(now))
      void dailyRestart(s.folderPath)
    }
  }
}, 30_000).unref()

// ---------- 앱을 켤 때 ----------
// 여러 개면 한꺼번에 켜지 않고 목록 순서대로 하나씩 켠다 (다 켜진 뒤 다음 것).
// 다른 서버와 포트가 겹치거나, 켜면 메모리가 모자란 서버는 건너뛰고 알린다
const START_WAIT_MS = 10 * 60_000 // 한 서버가 다 켜지기를 기다리는 최대 시간 (모드 서버는 오래 걸린다)

async function waitStarted(folderPath: string): Promise<void> {
  const deadline = Date.now() + START_WAIT_MS
  while (getState(folderPath) === 'starting' && Date.now() < deadline) await new Promise((r) => setTimeout(r, 1000))
}

export async function autoStartServers(): Promise<void> {
  if (!starter) return
  const list = listServers().filter((s) => automationOf(s.folderPath).autoStart && s.state === 'stopped' && s.eulaAccepted)
  if (!list.length) return
  const totalMb = Math.floor(os.totalmem() / 1048576)
  let usedMb = 0 // 앱이 켠 서버들이 쓸 메모리
  const usedPorts = new Set(listServers().filter((s) => s.state !== 'stopped').map((s) => serverPort(s.folderPath)))
  const skipped: string[] = []
  for (const s of list) {
    const port = serverPort(s.folderPath)
    const mem = s.memoryMb ?? 2048
    if (usedPorts.has(port)) {
      appLog(s.folderPath, `다른 서버가 같은 포트(${port})를 쓰고 있어서 자동으로 켜지 않았어요. 설정 → 접속에서 포트를 바꿔 주세요.`)
      skipped.push(`${s.name} (포트 겹침)`)
      continue
    }
    // 윈도우가 쓸 2GB는 남긴다
    if (usedMb + mem > totalMb - 2048) {
      appLog(s.folderPath, '먼저 켠 서버들 때문에 메모리가 모자라서 자동으로 켜지 않았어요.')
      skipped.push(`${s.name} (메모리 부족)`)
      continue
    }
    try {
      await starter(s.folderPath)
      usedPorts.add(port)
      usedMb += mem
      await waitStarted(s.folderPath) // 다 켜질 때까지 기다렸다가 다음 서버
    } catch (e) {
      appLog(s.folderPath, `자동으로 켜지 못했어요: ${e instanceof Error ? e.message : e}`)
      skipped.push(`${s.name} (켜지 못함)`)
    }
  }
  if (skipped.length) notify('자동으로 켜지 못한 서버가 있어요', skipped.join(', '))
}
