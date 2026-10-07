import { app } from 'electron'
import crypto from 'crypto'
import { CancelledError, isCancelled, throwIfCancelled, watchAbort } from './cancel'
import fs from 'fs'
import path from 'path'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'
import type { ReadableStream } from 'stream/web'

const REQUEST_TIMEOUT_MS = 30_000 // 응답이 멈춘 요청이 영원히 걸려 있지 않도록
const STALL_TIMEOUT_MS = 45_000 // 받는 도중 이만큼 아무 데이터도 안 오면 끊고 다시 받는다

// 앱이 보내는 모든 요청에 붙인다. (Modrinth 등은 식별 가능한 User-Agent를 요구한다)
// 앱 이름 + 버전 + 저장소 주소: CurseForge API 신청서에 적은 저장소와 같아서, 저쪽에서 어떤 앱인지 바로 알 수 있다
export const HEADERS = { 'User-Agent': `MC-CubePanel/${app.getVersion()} (github.com/rlaxodbs1723-prog/mc-server-manager)` }

// 응답 헤더가 오기까지만 제한한다. (본문 전체에 걸면 큰 파일 다운로드가 중간에 끊긴다)
export async function fetchWithTimeout(url: string): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { signal: ctrl.signal, headers: HEADERS })
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetchWithTimeout(url)
  if (!res.ok) throw new Error(`요청 실패 (${res.status}): ${url}`)
  return (await res.json()) as T
}

function hashOfFile(file: string, algorithm: 'sha1' | 'sha256'): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm)
    fs.createReadStream(file)
      .on('data', (d) => hash.update(d))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject)
  })
}

// 받은 파일이 맞는지: sha1 또는 sha256 중 주어진 것으로 확인한다 (둘 다 없으면 있기만 하면 된다)
async function matches(file: string, sha1?: string, sha256?: string): Promise<boolean> {
  if (sha1) return (await hashOfFile(file, 'sha1')) === sha1.toLowerCase()
  if (sha256) return (await hashOfFile(file, 'sha256')) === sha256.toLowerCase()
  return true
}

async function isValid(file: string, sha1?: string, sha256?: string): Promise<boolean> {
  return fs.existsSync(file) && matches(file, sha1, sha256)
}

export interface DownloadTask {
  url: string
  dest: string
  sha1?: string
  sha256?: string
  onBytes?: (done: number, total?: number) => void
}

// 같은 파일을 동시에 받는 두 작업이 .part 파일을 서로 망가뜨리지 않도록 합친다.
const inFlight = new Map<string, Promise<void>>()

export function downloadFile(task: DownloadTask): Promise<void> {
  const existing = inFlight.get(task.dest)
  if (existing) return existing
  const p = downloadOnce(task).finally(() => inFlight.delete(task.dest))
  inFlight.set(task.dest, p)
  return p
}

async function downloadOnce({ url, dest, sha1, sha256, onBytes }: DownloadTask): Promise<void> {
  if (await isValid(dest, sha1, sha256)) return
  fs.mkdirSync(path.dirname(dest), { recursive: true })

  let lastErr: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    const tmp = `${dest}.part`
    // 응답이 늦거나 받는 도중 멈추면 끊는다. 데이터가 올 때마다 시간을 다시 잰다.
    throwIfCancelled()
    const ctrl = new AbortController()
    const unwatch = watchAbort(ctrl) // 서버 만들기를 취소하면 바로 끊는다
    let stall = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
    const kick = (): void => {
      clearTimeout(stall)
      stall = setTimeout(() => ctrl.abort(), STALL_TIMEOUT_MS)
    }
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: HEADERS })
      if (!res.ok || !res.body) throw new Error(`다운로드 실패 (${res.status}): ${url}`)
      kick()
      const total = Number(res.headers.get('content-length')) || undefined
      let done = 0
      const counter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          kick()
          done += chunk.length
          onBytes?.(done, total)
          cb(null, chunk)
        }
      })
      await pipeline(Readable.fromWeb(res.body as ReadableStream), counter, fs.createWriteStream(tmp))
      if (!(await matches(tmp, sha1, sha256))) throw new Error(`받은 파일이 손상됐어요 (체크섬 불일치): ${url}`)
      fs.renameSync(tmp, dest)
      return
    } catch (e) {
      fs.rmSync(tmp, { force: true })
      if (isCancelled()) throw new CancelledError() // 취소면 다시 받지 않는다
      lastErr = ctrl.signal.aborted ? new Error(`다운로드가 멈췄어요. 인터넷 연결을 확인해 주세요: ${url}`) : e
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 1000))
    } finally {
      clearTimeout(stall)
      unwatch()
    }
  }
  throw lastErr
}
