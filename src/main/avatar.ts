// 플레이어 머리·몸 그림: 한 번 받으면 컴퓨터에 저장해 두고 다음부터는 바로 보여 준다.
// 전에는 화면이 열릴 때마다 mc-heads.net에서 직접 받아서 느리고, 사이트가 느리거나 막히면 빈 칸으로 남았다.
// 두 곳(mc-heads, minotar)에 동시에 묻고 먼저 온 것을 쓴다. 못 받은 이름은 잠깐 기억해서 계속 두드리지 않는다
import { app } from 'electron'
import fs from 'fs'
import path from 'path'

type Kind = 'avatar' | 'body'
const TTL = 3 * 86400_000 // 저장한 그림은 3일 쓴다 (스킨을 바꾼 사람은 3일 뒤에 바뀐다)
const FAIL_TTL = 10 * 60_000 // 못 받은 이름은 10분 동안 다시 안 묻는다
const NAME_RE = /^[A-Za-z0-9_]{1,16}$/ // 정식 계정 이름만 (배드락 게이머태그·이상한 이름은 건너뛴다)

const dir = (): string => path.join(app.getPath('userData'), 'avatars')
const failed = new Map<string, number>()
const pending = new Map<string, Promise<string | null>>()

const sources = (name: string, kind: Kind, size: number): string[] =>
  kind === 'avatar'
    ? [`https://mc-heads.net/avatar/${name}/${size}`, `https://minotar.net/helm/${name}/${size}.png`]
    : [`https://mc-heads.net/body/${name}/${size}`, `https://minotar.net/armor/body/${name}/${size}.png`]

// 두 곳에 동시에 묻고 먼저 온 그림을 쓴다. mc-heads는 처음 보는 이름이나 정식 계정이 아닌 이름(오프라인 서버 등)이면
// 10초 넘게 답이 없을 때가 있어서, 순서대로 물으면 그동안 빈 칸으로 남는다
async function download(name: string, kind: Kind, size: number): Promise<Buffer | null> {
  const one = async (url: string): Promise<Buffer> => {
    const res = await fetch(url, { headers: { 'User-Agent': 'MC-CubePanel' }, signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(String(res.status))
    if (!(res.headers.get('content-type') ?? '').startsWith('image/')) throw new Error('not image')
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length === 0 || buf.length > 400_000) throw new Error('size')
    return buf
  }
  try {
    return await Promise.any(sources(name, kind, size).map(one))
  } catch {
    return null
  }
}

// 그림을 data 주소로 돌려준다. 못 받으면 null (화면은 빈 칸으로 둔다)
export function getAvatar(rawName: string, kind: Kind = 'avatar', rawSize = 40): Promise<string | null> {
  const name = String(rawName)
  const size = Math.min(160, Math.max(16, Math.round(Number(rawSize)) || 40))
  if (!NAME_RE.test(name) || (kind !== 'avatar' && kind !== 'body')) return Promise.resolve(null)
  const key = `${kind}-${size}-${name.toLowerCase()}`
  const file = path.join(dir(), `${key}.png`)
  const dataUrl = (buf: Buffer): string => `data:image/png;base64,${buf.toString('base64')}`

  // 저장해 둔 것이 아직 신선하면 바로
  try {
    const st = fs.statSync(file)
    if (Date.now() - st.mtimeMs < TTL) return Promise.resolve(dataUrl(fs.readFileSync(file)))
  } catch {
    // 아직 없음
  }
  if ((failed.get(key) ?? 0) > Date.now()) {
    // 최근에 못 받았다: 예전에 저장한 것이라도 있으면 그걸 보여 준다
    try {
      return Promise.resolve(dataUrl(fs.readFileSync(file)))
    } catch {
      return Promise.resolve(null)
    }
  }
  const running = pending.get(key)
  if (running) return running
  const job = (async () => {
    const buf = await download(name, kind, size)
    if (buf) {
      failed.delete(key)
      try {
        fs.mkdirSync(dir(), { recursive: true })
        fs.writeFileSync(file, buf)
      } catch {
        // 저장 못 해도 이번엔 보여 준다
      }
      return dataUrl(buf)
    }
    failed.set(key, Date.now() + FAIL_TTL)
    try {
      return dataUrl(fs.readFileSync(file)) // 예전에 받아 둔 것
    } catch {
      return null
    }
  })().finally(() => pending.delete(key))
  pending.set(key, job)
  return job
}
