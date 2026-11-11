// 바닐라가 아닌 서버 종류: 모드 로더(Fabric / Quilt / Forge / NeoForge), 플러그인 서버(Paper / Purpur), 하이브리드(Arclight)
// 각 종류의 "빌드 버전" 목록과 서버 설치를 맡는다.
import fs from 'fs'
import { CancelledError, isCancelled, throwIfCancelled, watchProcess } from './cancel'
import path from 'path'
import { spawn } from 'child_process'
import type { LoaderVersion, Software } from '../shared-types'
import { downloadFile, fetchWithTimeout } from './download'

const PAPER_API = 'https://fill.papermc.io/v3/projects/paper'
const PURPUR_API = 'https://api.purpurmc.org/v2/purpur'
const FABRIC_META = 'https://meta.fabricmc.net/v2/versions'
const QUILT_META = 'https://meta.quiltmc.org/v3/versions'
const QUILT_INSTALLER_MAVEN = 'https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer'
const FORGE_MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge'
const NEOFORGE_MAVEN = 'https://maven.neoforged.net/releases/net/neoforged/neoforge'
const NEOFORGE_VERSIONS_API = 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge'
// Arclight는 다운로드 API가 따로 없어서 깃허브 릴리스 목록을 쓴다 (파일 이름에 로더·마인크래프트 버전이 들어 있다)
const ARCLIGHT_RELEASES = 'https://api.github.com/repos/IzzelAliz/Arclight/releases?per_page=100'
const CACHE_TTL_MS = 10 * 60 * 1000

export type Loader = Exclude<Software, 'vanilla'>

// 바닐라 server.jar를 앱이 미리 받아 둬야 하는 종류 (Fabric·Quilt 런처가 옆의 server.jar를 불러 쓴다)
export const needsVanillaJar = (software: Software): boolean =>
  software === 'vanilla' || software === 'fabric' || software === 'quilt'

// ---------- 요청 + 캐시 ----------
const cache = new Map<string, { at: number; data: unknown }>()

async function cached<T>(url: string, parse: (res: Response) => Promise<T>): Promise<T | null> {
  const hit = cache.get(url)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data as T
  const res = await fetchWithTimeout(url)
  if (res.status === 400 || res.status === 404) return null // 지원하지 않는 버전
  if (!res.ok) throw new Error(`로더 정보 요청 실패 (${res.status}): ${url}`)
  const data = await parse(res)
  cache.set(url, { at: Date.now(), data })
  return data
}

const json = <T>(url: string) => cached<T>(url, (r) => r.json() as Promise<T>)
const mavenVersions = async (base: string) =>
  (await cached(`${base}/maven-metadata.xml`, async (r) =>
    [...(await r.text()).matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1])
  )) ?? []

// "47.2.10" 같은 버전을 숫자 배열로 비교해 최신순으로 정렬
const parts = (v: string) => v.split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : 0))
function compareDesc(a: string, b: string): number {
  const pa = parts(a)
  const pb = parts(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] ?? 0) - (pa[i] ?? 0)
    if (d) return d
  }
  return 0
}

const isUnstable = (v: string) => /alpha|beta|rc|pre|snapshot/i.test(v)

// NeoForge 버전은 마인크래프트 "1.21.1" → "21.1.x", "26.3" → "26.3.x" 처럼 앞자리가 대응한다.
function neoforgePrefix(mcVersion: string): string {
  if (mcVersion.startsWith('1.')) {
    const [minor, patch = '0'] = mcVersion.slice(2).split('.')
    return `${minor}.${patch}.`
  }
  return `${mcVersion}.`
}

// ---------- Arclight ----------
// 파일 하나가 "arclight-{로더}-{마인크래프트 버전}-{빌드}.jar". 앱은 "{로더}-{마인크래프트 버전}-{빌드}"를 로더 버전으로 적어 둔다
// (밑바탕 로더를 이 이름에서 알아낸다: 모드 탭이 어느 로더용 모드를 찾을지 정한다)
interface ArclightBuild {
  id: string // neoforge-1.21.1-1.0.1-8ec9529
  loader: 'neoforge' | 'fabric' | 'forge'
  mcVersion: string
  stable: boolean // 깃허브에서 정식 릴리스(시험판이 아님)
  url: string
  size: number
}
const ARCLIGHT_FILE = /^arclight-(neoforge|fabric|forge)-(\d+(?:\.\d+)+)-(.+)\.jar$/
const LOADER_ORDER = ['neoforge', 'fabric', 'forge']

async function arclightBuilds(): Promise<ArclightBuild[]> {
  const releases =
    (await json<{ prerelease: boolean; draft: boolean; assets: { name: string; browser_download_url: string; size: number }[] }[]>(ARCLIGHT_RELEASES)) ?? []
  const out: ArclightBuild[] = []
  for (const r of releases) {
    if (r.draft) continue
    for (const a of r.assets ?? []) {
      const m = ARCLIGHT_FILE.exec(a.name)
      // 다운로드 주소는 깃허브 릴리스 파일만 받는다 (목록이 이상하게 와도 엉뚱한 곳에서 받지 않게)
      if (!m || !/^https:\/\/github\.com\/IzzelAliz\/Arclight\/releases\/download\//.test(a.browser_download_url)) continue
      out.push({ id: `${m[1]}-${m[2]}-${m[3]}`, loader: m[1] as ArclightBuild['loader'], mcVersion: m[2], stable: !r.prerelease, url: a.browser_download_url, size: a.size })
    }
  }
  return out
}

// Arclight가 지원하는 마인크래프트 버전 (최신순)
export async function arclightMcVersions(): Promise<string[]> {
  return [...new Set((await arclightBuilds()).map((b) => b.mcVersion))].sort(compareDesc)
}

// 해당 마인크래프트 버전에서 쓸 수 있는 로더 버전 (안정 버전 먼저, 각각 최신순). 지원하지 않으면 빈 배열.
export async function getLoaderVersions(loader: Loader, mcVersion: string): Promise<LoaderVersion[]> {
  let list: LoaderVersion[] = []
  if (loader === 'paper') {
    const builds = await json<{ id: number; channel: string }[]>(`${PAPER_API}/versions/${encodeURIComponent(mcVersion)}/builds`)
    list = (builds ?? []).map((b) => ({ version: String(b.id), stable: b.channel === 'STABLE' }))
  } else if (loader === 'purpur') {
    const data = await json<{ builds: { all: string[] } }>(`${PURPUR_API}/${encodeURIComponent(mcVersion)}`)
    list = (data?.builds.all ?? []).map((version) => ({ version, stable: true }))
  } else if (loader === 'fabric' || loader === 'quilt') {
    const base = loader === 'fabric' ? FABRIC_META : QUILT_META
    const data = await json<{ loader: { version: string; stable?: boolean } }[]>(
      `${base}/loader/${encodeURIComponent(mcVersion)}`
    )
    list = (data ?? []).map((e) => ({
      version: e.loader.version,
      stable: e.loader.stable ?? !isUnstable(e.loader.version)
    }))
  } else if (loader === 'arclight') {
    // 정식이 먼저, 그다음 로더 순서(NeoForge → Fabric → Forge). 같은 로더 안에서는 목록 순서(최신이 먼저)
    const builds = (await arclightBuilds()).filter((b) => b.mcVersion === mcVersion)
    return builds
      .map((b, i) => ({ b, i }))
      .sort((x, y) => Number(y.b.stable) - Number(x.b.stable) || LOADER_ORDER.indexOf(x.b.loader) - LOADER_ORDER.indexOf(y.b.loader) || x.i - y.i)
      .map(({ b }) => ({ version: b.id, stable: b.stable }))
  } else if (loader === 'forge') {
    list = (await mavenVersions(FORGE_MAVEN))
      .filter((v) => v.startsWith(`${mcVersion}-`))
      .map((v) => v.slice(mcVersion.length + 1))
      .map((version) => ({ version, stable: !isUnstable(version) }))
  } else {
    // NeoForge 저장소의 maven-metadata.xml은 404가 자주 나서, NeoForge 사이트가 쓰는 버전 API를 쓴다
    const prefix = neoforgePrefix(mcVersion)
    const data = await json<{ versions: string[] }>(NEOFORGE_VERSIONS_API)
    list = (data?.versions ?? [])
      .filter((v) => v.startsWith(prefix))
      .map((version) => ({ version, stable: !isUnstable(version) }))
  }
  return list.sort((a, b) => Number(b.stable) - Number(a.stable) || compareDesc(a.version, b.version))
}

// ---------- 설치 ----------
// phase: loader(받는 중, 받은 양을 안다) / install(설치 프로그램 실행 중, 남은 양을 모른다)
export type InstallReport = (message: string, phase: 'loader' | 'install', done?: number, total?: number) => void

// 끝날 때까지 기다리는 자식 프로세스 실행. 출력 줄을 onLine 으로 넘긴다.
function runProcess(
  exe: string,
  args: string[],
  cwd: string,
  onLine: (line: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    throwIfCancelled()
    const proc = spawn(exe, args, { cwd, windowsHide: true })
    watchProcess(proc) // 서버 만들기를 취소하면 설치 프로그램도 끈다
    let tail = ''
    const feed = (chunk: Buffer): void => {
      const text = chunk.toString('utf8')
      tail = (tail + text).slice(-4000)
      for (const line of text.split(/\r?\n/)) if (line.trim()) onLine(line)
    }
    proc.stdout.on('data', feed)
    proc.stderr.on('data', feed)
    proc.on('error', reject)
    proc.on('close', (code) =>
      isCancelled()
        ? reject(new CancelledError())
        : code === 0
        ? resolve()
        : reject(new Error(`설치 프로그램이 실패했어요. (코드 ${code})\n${tail.split('\n').slice(-6).join('\n')}`))
    )
  })
}

// 로더 서버를 폴더에 설치한다. (바닐라 server.jar는 이미 받아 둔 상태)
// 버전을 바꿀 때 쓰는 받기: 같은 이름의 예전 파일이 있어도 새로 받아서 바꿔 끼운다.
// (downloadFile은 파일이 이미 있고 확인할 해시가 없으면 받지 않아서, 예전 버전 파일이 그대로 남았다)
// 새 파일을 옆에 다 받은 다음 바꾸므로, 받다가 실패해도 예전 파일은 그대로 남는다
async function downloadReplacing(task: Parameters<typeof downloadFile>[0]): Promise<void> {
  const tmp = task.dest + '.new'
  fs.rmSync(tmp, { force: true })
  try {
    await downloadFile({ ...task, dest: tmp })
    fs.renameSync(tmp, task.dest)
  } finally {
    fs.rmSync(tmp, { force: true })
  }
}

export async function installLoader(
  loader: Loader,
  mcVersion: string,
  loaderVersion: string,
  dir: string,
  java: string,
  report: InstallReport
): Promise<void> {
  if (loader === 'paper') {
    const builds = await json<{ id: number; downloads: Record<string, { url: string; checksums?: { sha256?: string } }> }[]>(
      `${PAPER_API}/versions/${encodeURIComponent(mcVersion)}/builds`
    )
    const dl = builds?.find((b) => String(b.id) === loaderVersion)?.downloads['server:default']
    if (!dl) throw new Error(`Paper 빌드 ${loaderVersion}을(를) 찾지 못했어요.`)
    const msg = 'Paper 서버 파일을 받고 있어요'
    report(msg, 'loader')
    await downloadReplacing({
      url: dl.url,
      dest: path.join(dir, 'server.jar'),
      sha256: dl.checksums?.sha256, // Paper가 주는 SHA-256으로 손상 여부를 확인한다
      onBytes: (d, t) => report(msg, 'loader', d, t)
    })
    return
  }

  if (loader === 'arclight') {
    const build = (await arclightBuilds()).find((b) => b.id === loaderVersion)
    if (!build) throw new Error(`Arclight ${loaderVersion}을(를) 찾지 못했어요.`)
    const msg = 'Arclight 서버 파일을 받고 있어요'
    report(msg, 'loader')
    await downloadReplacing({ url: build.url, dest: path.join(dir, 'arclight.jar'), onBytes: (d, t) => report(msg, 'loader', d, t) })
    // 깃허브가 알려 준 크기와 다르면 받다 만 파일이다
    if (build.size && fs.statSync(path.join(dir, 'arclight.jar')).size !== build.size) throw new Error('Arclight 서버 파일을 다 받지 못했어요. 다시 시도해 주세요.')
    return
  }

  if (loader === 'purpur') {
    const msg = 'Purpur 서버 파일을 받고 있어요'
    report(msg, 'loader')
    await downloadReplacing({
      onBytes: (d, t) => report(msg, 'loader', d, t),
      url: `${PURPUR_API}/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/download`,
      dest: path.join(dir, 'server.jar')
    })
    return
  }

  if (loader === 'fabric') {
    // Fabric 서버 런처: 실행하면 옆의 server.jar(바닐라)를 불러 로더를 띄운다
    report('Fabric을 받고 있어요', 'loader')
    const installers = (await json<{ version: string; stable: boolean }[]>(`${FABRIC_META}/installer`)) ?? []
    const installer = (installers.find((i) => i.stable) ?? installers[0])?.version
    if (!installer) throw new Error('Fabric 설치 프로그램 정보를 찾지 못했어요.')
    await downloadReplacing({
      url: `${FABRIC_META}/loader/${mcVersion}/${loaderVersion}/${installer}/server/jar`,
      dest: path.join(dir, 'fabric-server-launch.jar')
    })
    return
  }

  if (loader === 'quilt') {
    report('Quilt 설치 프로그램을 받고 있어요', 'loader')
    const versions = await mavenVersions(QUILT_INSTALLER_MAVEN)
    const latest = versions.filter((v) => !isUnstable(v)).sort(compareDesc)[0] ?? versions.sort(compareDesc)[0]
    if (!latest) throw new Error('Quilt 설치 프로그램 정보를 찾지 못했어요.')
    const installer = path.join(dir, 'quilt-installer.jar')
    await downloadFile({ url: `${QUILT_INSTALLER_MAVEN}/${latest}/quilt-installer-${latest}.jar`, dest: installer })
    report('Quilt를 설치하고 있어요', 'install')
    await runProcess(
      java,
      // 설치 프로그램이 인자를 띄어쓰기로 다시 쪼개서, 경로에 공백이 있으면 엉뚱하게 실패한다.
      // 이미 서버 폴더에서 실행하므로 "."을 넘긴다.
      ['-jar', 'quilt-installer.jar', 'install', 'server', mcVersion, loaderVersion, '--install-dir=.'],
      dir,
      () => {} // 설치 프로그램 출력은 너무 잦아서 보여 주지 않는다
    )
    fs.rmSync(installer, { force: true })
    // 실패해도 종료 코드 0으로 끝나는 경우가 있어 결과 파일로 확인한다
    if (!fs.existsSync(path.join(dir, 'quilt-server-launch.jar'))) throw new Error('Quilt 설치에 실패했어요.')
    return
  }

  // Forge / NeoForge: 설치 프로그램이 libraries 폴더와 실행 인자 파일을 만든다
  const label = loader === 'forge' ? 'Forge' : 'NeoForge'
  const file =
    loader === 'forge' ? `forge-${mcVersion}-${loaderVersion}-installer.jar` : `neoforge-${loaderVersion}-installer.jar`
  const url =
    loader === 'forge'
      ? `${FORGE_MAVEN}/${mcVersion}-${loaderVersion}/${file}`
      : `${NEOFORGE_MAVEN}/${loaderVersion}/${file}`
  const msg = `${label} 설치 프로그램을 받고 있어요`
  report(msg, 'loader')
  await downloadFile({ url, dest: path.join(dir, file), onBytes: (d, t) => report(msg, 'loader', d, t) })
  report(`${label}를 설치하고 있어요`, 'install')
  await runProcess(java, ['-jar', file, '--installServer'], dir, () => {})
  fs.rmSync(path.join(dir, file), { force: true })
  fs.rmSync(path.join(dir, `${file}.log`), { force: true })
}

// java 뒤에 붙일 인자 중 "무엇을 실행할지" 부분 (메모리 옵션 뒤, nogui 앞)
export function launchTarget(software: Software, dir: string, mcVersion?: string, loaderVersion?: string): string[] {
  if (software === 'vanilla' || software === 'paper' || software === 'purpur') {
    return ['-jar', 'server.jar']
  }
  // Arclight: 처음 켤 때 필요한 라이브러리를 스스로 받는다 (첫 실행은 오래 걸린다)
  if (software === 'arclight') {
    // 앱이 만든 서버는 arclight.jar, 가져온 서버는 원래 이름(arclight-neoforge-….jar)일 수 있다
    const jar = fs.existsSync(path.join(dir, 'arclight.jar')) ? 'arclight.jar' : fs.readdirSync(dir).find((f) => /^arclight.*\.jar$/i.test(f))
    if (!jar) throw new Error('Arclight 서버 파일을 찾지 못했어요. 서버를 다시 만들어 주세요.')
    return ['-jar', jar]
  }
  if (software === 'fabric') return ['-jar', 'fabric-server-launch.jar']
  if (software === 'quilt') return ['-jar', 'quilt-server-launch.jar']

  // Forge 1.17+ / NeoForge: 설치 프로그램이 만든 win_args.txt를 쓴다
  const libRoot = path.join(dir, 'libraries', software === 'forge' ? 'net/minecraftforge/forge' : 'net/neoforged/neoforge')
  if (fs.existsSync(libRoot)) {
    // 정보 파일에 적힌 버전의 폴더를 먼저 쓴다 (예전 버전 폴더가 남아 있어도 엉뚱한 버전으로 켜지지 않게)
    const want = loaderVersion ? (software === 'forge' ? `${mcVersion}-${loaderVersion}` : loaderVersion) : null
    const dirs = fs.readdirSync(libRoot).sort((a, b) => Number(b === want) - Number(a === want))
    for (const ver of dirs) {
      const args = path.join(libRoot, ver, 'win_args.txt')
      if (fs.existsSync(args)) {
        const rel = path.relative(dir, args).replace(/\\/g, '/')
        return [...(fs.existsSync(path.join(dir, 'user_jvm_args.txt')) ? ['@user_jvm_args.txt'] : []), `@${rel}`]
      }
    }
  }
  // 오래된 Forge: 만들어진 forge 서버 jar를 직접 실행
  const jars = fs.readdirSync(dir).filter((f) => /^(forge|minecraftforge).*\.jar$/i.test(f) && !/installer/i.test(f))
  const jar = jars.find((f) => loaderVersion && f.includes(`${mcVersion}-${loaderVersion}`)) ?? jars[0]
  if (jar) return ['-jar', jar]
  throw new Error('서버 실행 파일을 찾지 못했어요. 서버를 다시 만들어 주세요.')
}
