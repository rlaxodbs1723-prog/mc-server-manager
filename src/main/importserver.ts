// 기존 서버 폴더 가져오기: 폴더를 살펴 서버 종류·버전을 알아내고(detectServer), 앱의 서버 폴더로 복사한다(copyServerFolder).
// 다른 프로그램으로 만든 서버라 정보 파일이 없으므로, 파일 이름·로더 폴더·로그에서 알아낸다. 틀릴 수 있어서 화면에서 고칠 수 있게 한다.
import fs from 'fs'
import path from 'path'
import yauzl from 'yauzl'
import type { DetectedServer } from '../shared-types'
import { throwIfCancelled } from './cancel'

const cmp = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true })
const latest = (names: string[]): string | null => [...names].sort(cmp).pop() ?? null

function subdirs(p: string): string[] {
  try {
    return fs
      .readdirSync(p, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return []
  }
}

// 앱 서버 폴더 안이거나, 앱 서버 폴더를 품은 폴더(복사하다 자기 자신을 복사하게 된다)는 막는다
export function checkImportFolder(dir: string, serversRoot: string): string {
  const abs = path.resolve(String(dir ?? ''))
  let isDir = false
  try {
    isDir = fs.statSync(abs).isDirectory()
  } catch {
    // 아래에서 안내한다
  }
  if (!isDir) throw new Error('폴더를 찾을 수 없어요.')
  if (path.parse(abs).root === abs) throw new Error('드라이브 전체는 가져올 수 없어요. 서버 폴더를 골라 주세요.')
  const inside = path.relative(serversRoot, abs)
  if (!inside.startsWith('..') && !path.isAbsolute(inside)) throw new Error('이미 앱에 있는 서버 폴더예요.')
  const holds = path.relative(abs, serversRoot)
  if (!holds.startsWith('..') && !path.isAbsolute(holds)) throw new Error('앱 데이터가 들어 있는 폴더라서 가져올 수 없어요. 서버 폴더만 골라 주세요.')
  const names = fs.readdirSync(abs)
  if (!names.some((n) => /\.jar$/i.test(n) || n === 'server.properties' || n === 'libraries' || /^run\.(bat|sh)$/i.test(n))) {
    // 에센셜 모드로 하던 멀티나 싱글플레이 월드는 서버 폴더가 아니라 월드(또는 게임 폴더)다. 어디로 가져와야 하는지 알려 준다
    if (names.includes('level.dat')) throw new Error('서버 폴더가 아니라 월드 폴더예요. 새 서버를 만들 때 "내 월드·zip"으로 가져와 주세요.')
    if (names.includes('saves')) throw new Error('서버 폴더가 아니라 게임(클라이언트) 폴더예요. 안의 saves 폴더에 있는 월드를 새 서버의 "내 월드·zip"으로 가져와 주세요.')
    throw new Error('서버 폴더로 보이지 않아요. server.properties나 서버 jar가 있는 폴더를 골라 주세요.')
  }
  return abs
}

// 서버 jar 안의 version.json에서 마인크래프트 버전을 읽는다 (공식 서버 jar에 들어 있다)
function jarVersion(jar: string): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 5000)
    const done = (v: string | null): void => {
      clearTimeout(timer)
      resolve(v)
    }
    yauzl.open(jar, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err || !zip) return done(null)
      zip.on('error', () => done(null))
      zip.on('end', () => done(null))
      zip.on('entry', (entry) => {
        if (entry.fileName !== 'version.json') return zip.readEntry()
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return done(null)
          const chunks: Buffer[] = []
          stream.on('data', (c: Buffer) => chunks.push(c))
          stream.on('end', () => {
            try {
              const j = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { id?: string; name?: string }
              done(j.id ?? j.name ?? null)
            } catch {
              done(null)
            }
          })
          stream.on('error', () => done(null))
        })
      })
      zip.readEntry()
    })
  })
}

// 로그 첫머리의 "Starting minecraft server version 1.20.1"
function versionFromLog(dir: string): string | null {
  for (const f of ['logs/latest.log', 'latest.log']) {
    try {
      const fd = fs.openSync(path.join(dir, f), 'r')
      const buf = Buffer.alloc(200 * 1024)
      const n = fs.readSync(fd, buf, 0, buf.length, 0)
      fs.closeSync(fd)
      const m = /Starting minecraft server version (\S+)/.exec(buf.subarray(0, n).toString('utf8'))
      if (m) return m[1]
    } catch {
      // 로그가 없으면 다른 방법으로
    }
  }
  return null
}

// NeoForge 버전(21.1.50)은 마인크래프트 1.21.1에 해당한다 (21.0은 1.21). 26 이상은 마인크래프트 버전이 그대로다
function mcFromNeoForge(v: string): string | null {
  const m = /^(\d+)\.(\d+)/.exec(v)
  if (!m) return null
  const major = Number(m[1])
  const minor = Number(m[2])
  if (major >= 26) return `${major}.${minor}`
  if (major < 20) return null
  return minor === 0 ? `1.${major}` : `1.${major}.${minor}`
}

// 아주 큰 폴더는 세다가 창이 늦게 뜨므로 4초까지만 센다 (넘으면 partial)
async function folderSize(dir: string): Promise<{ bytes: number; partial: boolean }> {
  let total = 0
  const deadline = Date.now() + 4000
  const stack = [dir]
  while (stack.length) {
    if (Date.now() > deadline) return { bytes: total, partial: true }
    const cur = stack.pop() as string
    let entries: fs.Dirent[] = []
    try {
      entries = await fs.promises.readdir(cur, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const p = path.join(cur, e.name)
      if (e.isDirectory()) stack.push(p)
      else if (e.isFile()) total += (await fs.promises.stat(p).catch(() => null))?.size ?? 0
    }
  }
  return { bytes: total, partial: false }
}

export async function detectServer(dir: string, serversRoot: string): Promise<DetectedServer> {
  const abs = checkImportFolder(dir, serversRoot)
  const files = fs.readdirSync(abs)
  const jars = files.filter((f) => /\.jar$/i.test(f))
  const has = (n: string): boolean => files.includes(n)
  const lib = (...p: string[]): string[] => subdirs(path.join(abs, 'libraries', ...p))

  let software: DetectedServer['software'] = null
  let mcVersion: string | null = null
  let loaderVersion: string | null = null

  const neo = latest(lib('net', 'neoforged', 'neoforge'))
  const forgeDir = latest(lib('net', 'minecraftforge', 'forge'))
  const oldForge = jars.map((j) => /^(?:forge|minecraftforge)-(\d+\.\d+(?:\.\d+)?)-([\d.]+)(?:-universal)?\.jar$/i.exec(j)).find(Boolean)
  const fabricLoader = latest(lib('net', 'fabricmc', 'fabric-loader'))
  const quiltLoader = latest(lib('org', 'quiltmc', 'quilt-loader'))
  const purpur = jars.map((j) => /^purpur[-_]?(\d+\.\d+(?:\.\d+)?)[-_](\d+)\.jar$/i.exec(j)).find(Boolean)
  const paperJar = jars.map((j) => /^paper[-_]?(\d+\.\d+(?:\.\d+)?)[-_](\d+)\.jar$/i.exec(j)).find(Boolean)

  if (neo) {
    software = 'neoforge'
    loaderVersion = neo
    mcVersion = mcFromNeoForge(neo)
  } else if (forgeDir) {
    software = 'forge'
    const [mc, ...rest] = forgeDir.split('-')
    mcVersion = mc
    loaderVersion = rest.join('-') || null
  } else if (oldForge) {
    software = 'forge'
    mcVersion = oldForge[1]
    loaderVersion = oldForge[2]
  } else if (has('quilt-server-launch.jar') || quiltLoader) {
    software = 'quilt'
    loaderVersion = quiltLoader
    mcVersion = latest(lib('net', 'fabricmc', 'intermediary'))
  } else if (has('fabric-server-launch.jar') || fabricLoader) {
    software = 'fabric'
    loaderVersion = fabricLoader
    mcVersion = latest(lib('net', 'fabricmc', 'intermediary'))
  } else if (purpur || has('purpur.yml')) {
    software = 'purpur'
    mcVersion = purpur?.[1] ?? null
    loaderVersion = purpur?.[2] ?? null
  } else if (paperJar || has('paper.yml') || fs.existsSync(path.join(abs, 'config', 'paper-global.yml'))) {
    software = 'paper'
    if (paperJar) {
      mcVersion = paperJar[1]
      loaderVersion = paperJar[2]
    } else {
      try {
        const h = JSON.parse(fs.readFileSync(path.join(abs, 'version_history.json'), 'utf8')) as { currentVersion?: string }
        const cur = h.currentVersion ?? ''
        mcVersion = /MC: (\S+?)\)/.exec(cur)?.[1] ?? null
        loaderVersion = /(?:^|-)(\d+)-[0-9a-f]+/.exec(cur)?.[1] ?? /Paper-(\d+)/.exec(cur)?.[1] ?? null
      } catch {
        // 버전 기록이 없으면 아래에서 로그로 찾는다
      }
    }
  } else if (has('server.jar') || jars.some((j) => /^minecraft_server/i.test(j))) {
    software = 'vanilla'
    const jar = has('server.jar') ? 'server.jar' : (jars.find((j) => /^minecraft_server/i.test(j)) as string)
    mcVersion = (await jarVersion(path.join(abs, jar))) ?? /(\d+\.\d+(?:\.\d+)?)/.exec(jar)?.[1] ?? null
  }
  mcVersion ??= versionFromLog(abs)

  const world = (() => {
    try {
      const lv = /^\s*level-name\s*=\s*(.+)$/m.exec(fs.readFileSync(path.join(abs, 'server.properties'), 'utf8'))?.[1].trim() || 'world'
      return fs.existsSync(path.join(abs, lv, 'level.dat'))
    } catch {
      return fs.existsSync(path.join(abs, 'world', 'level.dat'))
    }
  })()

  const size = await folderSize(abs)
  return {
    software,
    mcVersion,
    loaderVersion,
    name: path.basename(abs),
    sizeMb: Math.round(size.bytes / 1024 / 1024),
    sizePartial: size.partial,
    hasWorld: world
  }
}

// 폴더를 통째로 복사한다. 로그·충돌 보고서·잠금 파일은 빼고, 복사한 양을 알려 준다 (큰 월드도 진행이 보이게)
const SKIP_TOP = new Set(['logs', 'crash-reports', 'session.lock', '.creating'])
export async function copyServerFolder(src: string, dest: string, onBytes: (done: number, total: number) => void): Promise<void> {
  const files: { from: string; to: string; size: number }[] = []
  let total = 0
  const walk = async (from: string, to: string, top: boolean): Promise<void> => {
    await fs.promises.mkdir(to, { recursive: true })
    for (const e of await fs.promises.readdir(from, { withFileTypes: true })) {
      if ((top && SKIP_TOP.has(e.name)) || e.name === 'session.lock') continue
      const f = path.join(from, e.name)
      const t = path.join(to, e.name)
      if (e.isDirectory()) await walk(f, t, false)
      else if (e.isFile()) {
        const size = (await fs.promises.stat(f)).size
        files.push({ from: f, to: t, size })
        total += size
      }
    }
  }
  await walk(src, dest, true)
  let done = 0
  for (const f of files) {
    throwIfCancelled()
    await fs.promises.copyFile(f.from, f.to)
    done += f.size
    onBytes(done, total)
  }
}
