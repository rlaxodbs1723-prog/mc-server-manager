import { friendlyError, sameMod, type Progress, type ServerState } from '../../shared-types'
import { useCallback, useState } from 'react'

// IPC 오류 메시지에서 Electron이 붙이는 앞부분을 떼어 낸다
// 화면에 보여 줄 오류 문구: 앞에 붙는 IPC 설명을 떼고, 흔한 오류는 쉬운 말로 바꾼다
export const cleanError = (e: unknown): string =>
  friendlyError(String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1)

export function progressText(p: Progress): string {
  if (p.done == null || !p.total) return p.message
  return p.unit === 'files' ? `${p.message} · ${p.done}/${p.total}` : `${p.message} · ${mb(p.done)}/${mb(p.total)}MB`
}

export const progressPercent = (p: Progress | null): number | null =>
  p?.done && p.total ? Math.round((p.done / p.total) * 100) : null

export const STATE_LABEL: Record<ServerState, string> = {
  stopped: '꺼짐',
  starting: '켜는 중',
  running: '켜짐',
  stopping: '끄는 중'
}

// 두 사이트 검색 결과를 이어 붙일 때 이미 있는 것(같은 ID나 같은 이름)은 뺀다
// (같은 사이트 안에서 이름만 같은 다른 프로젝트는 그대로 둔다)
export function appendHits<T extends { projectId: string; title: string; author?: string; source?: string }>(prev: T[], next: T[]): T[] {
  const out = [...prev]
  for (const h of next) {
    if (out.some((x) => x.projectId === h.projectId || (x.source !== h.source && sameMod(x, h)))) continue
    out.push(h)
  }
  return out
}

// 받침에 따라 조사를 고른다: josa('플러그인', '을/를') → '플러그인을'
export function josa(word: string, pair: '을/를' | '이/가' | '은/는' | '으로/로'): string {
  const [withBatchim, without] = pair.split('/')
  const code = word.charCodeAt(word.length - 1) - 0xac00
  const batchim = code >= 0 && code <= 11171 ? code % 28 : 0
  // "로"는 받침이 없거나 ㄹ 받침이면 "로"
  const use = pair === '으로/로' ? (batchim && batchim !== 8 ? withBatchim : without) : batchim ? withBatchim : without
  return word + use
}

// 켜지는 중인 서버의 로그를 보고 지금 어느 단계인지 알려 준다 (모드 서버는 1~2분 걸려서)
// percent는 단계에 따른 대략적인 값이고, 스폰 지역 준비만 실제 퍼센트를 쓴다
const BOOT_STAGES: { re: RegExp; percent: number; text: (m: RegExpMatchArray) => string }[] = [
  { re: /ModLauncher running|Starting FancyModLoader|with Fabric Loader|with Quilt Loader|Bootstrapping|Loading Paper/, percent: 8, text: () => '서버 프로그램을 준비하고 있어요' },
  { re: /Loading (\d+) mods/, percent: 15, text: (m) => `모드 ${m[1]}개를 불러오고 있어요` },
  { re: /(?:Neo)?Forge mod loading/, percent: 25, text: () => '모드를 불러오고 있어요' },
  { re: /Reloading ResourceManager|Loaded \d+ recipes|Loaded \d+ advancements/, percent: 35, text: () => '게임 데이터를 불러오고 있어요' },
  { re: /Starting minecraft server version|Starting Minecraft server on/, percent: 50, text: () => '서버를 시작하고 있어요' },
  { re: /Preparing level|Preparing start region/, percent: 65, text: () => '월드를 불러오고 있어요' },
  { re: /Preparing spawn area: (\d+)%/, percent: 65, text: (m) => `스폰 지역을 준비하고 있어요 (${m[1]}%)` }
]
export function bootStage(log: string[]): { message: string; percent: number } {
  let best = { message: '서버를 켜고 있어요', percent: 5, rank: -1 }
  for (const line of log.slice(-400)) {
    BOOT_STAGES.forEach((st, rank) => {
      const m = line.match(st.re)
      if (!m || rank < best.rank) return
      const spawn = st.re.source.startsWith('Preparing spawn') ? Number(m[1]) : 0
      best = { message: st.text(m), percent: Math.min(99, st.percent + Math.round(spawn * 0.34)), rank }
    })
  }
  return { message: best.message, percent: best.percent }
}

// 직접 넣은 파일 알아보기: 사이트가 잠깐 안 될 때(null)는 30초마다 몇 번 더 해 본다. 돌려준 함수를 부르면 멈춘다
// onFailing(true): 지금 사이트가 안 돼서 다시 해 볼 예정 / onFailing(false): 됐거나 그만둠
export function identifyWithRetry(ask: () => Promise<boolean | null>, onFound: () => void, onFailing?: (failing: boolean) => void, tries = 10): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const attempt = async (left: number): Promise<void> => {
    const r = await ask().catch(() => null)
    if (stopped) return
    if (r) onFound()
    onFailing?.(r === null)
    if (r === null && left > 1) timer = setTimeout(() => attempt(left - 1), 30_000)
  }
  attempt(tries)
  return () => {
    stopped = true
    clearTimeout(timer)
  }
}

// 다음에 켤 때도 기억할 값 (마지막으로 연 서버·탭 등). 저장소를 못 쓰면 기본값으로 동작한다
export function readStored<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v == null ? fallback : (JSON.parse(v) as T)
  } catch {
    return fallback
  }
}

export function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 저장 못 해도 다음에 기본값으로 열릴 뿐이다
  }
}

export function useStored<T>(key: string, fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => readStored(key, fallback))
  const set = useCallback(
    (v: T) => {
      setValue(v)
      writeStored(key, v)
    },
    [key]
  )
  return [value, set]
}
