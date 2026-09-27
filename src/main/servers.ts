import { app, shell } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  DEFAULT_AUTOMATION,
  PAPER_FIELDS,
  SOFTWARE_INFO,
  type ServerAutomation,
  type CreateServerOptions,
  type ModpackOrigin,
  type Progress,
  type ServerInfo,
  type ServerListItem,
  type SaveSettings,
  type ServerSettings,
  type Software
} from '../shared-types'
import { downloadFile } from './download'
import { ensureJava } from './java'
import { installLoader, launchTarget, needsVanillaJar } from './loaders'
import { readProperties, writeProperties } from './properties'
import { getVersionMeta, type VersionMeta } from './mojang'
import { startInvite } from './invite'
import { autoBackupBeforeStart, backupRoot, createBackup, listBackups } from './backup'
import { assertFree } from './lock'
import { importWorld } from './worldimport'
import { installModpack } from './modpack'
import { getServerIcon } from './icon'
import { notify } from './notify'
import { analyzeCrash } from './crash'
import { readYamlValue, writeYamlValue } from './yamlvalue'
import { emitEvent, getPlayers, getStartedAt, getState, serverPort, isEulaAccepted, onCrash, onServerEvent, startServer } from './runner'

const INFO_FILE = 'server-manager.json' // 서버 폴더마다 앱이 쓰는 정보 파일
const CREATING_FILE = '.creating' // 만드는 중 표시. 다 만들면 지운다 (앱이 도중에 꺼지면 남는다)

export const serversRoot = (): string => path.join(app.getPath('userData'), 'servers')
const runtimeRoot = (): string => path.join(app.getPath('userData'), 'runtime')

// 아주 옛날 버전은 javaVersion 정보가 없다. 공식 런처도 이때 Java 8(jre-legacy)을 쓴다.
const javaComponentOf = (meta: VersionMeta): string => meta.javaVersion?.component ?? 'jre-legacy'

// 앱이 정하는 server.properties 기본값. 나중에 추가한 기본값도 기존 서버에 한 번씩 적용되도록 차례대로 쌓는다.
// (한 번 적용한 뒤에 사용자가 바꾼 값은 다시 건드리지 않는다)
const DEFAULTS_BY_VERSION: Record<string, string>[] = [
  // 1: 최신 바닐라는 화이트리스트가 켜진 채로 만들어져 플레이어가 못 들어온다
  { 'white-list': 'false', 'enforce-whitelist': 'false' },
  // 2: 앱(콘솔)에서 보낸 명령 결과가 OP의 게임 채팅에 뜨지 않게
  { 'broadcast-console-to-ops': 'false' }
]

function applyDefaultsOnce(info: ServerInfo): void {
  const done = info.defaultsVersion ?? (info.defaultsApplied ? 1 : 0)
  if (done >= DEFAULTS_BY_VERSION.length) return
  writeProperties(info.folderPath, Object.assign({}, ...DEFAULTS_BY_VERSION.slice(done)))
  info.defaultsVersion = DEFAULTS_BY_VERSION.length
  fs.writeFileSync(path.join(info.folderPath, INFO_FILE), JSON.stringify(info, null, 2))
}

// Windows 폴더 이름에 못 쓰는 글자를 걸러 낸다.
function safeFolderName(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/[. ]+$/, '')
    .trim()
  if (!cleaned) throw new Error('서버 이름을 입력해 주세요.')
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(cleaned)) throw new Error('이 이름은 Windows에서 폴더 이름으로 쓸 수 없어요.')
  return cleaned.slice(0, 60)
}

// 서버 폴더 이름: 겹치면 "이름 (2)"처럼 번호를 붙인다
// (이름 바꾸기는 폴더를 그대로 두므로, 목록에 없는 이름인데 폴더는 있을 수 있다)
function freeFolder(name: string): string {
  const base = safeFolderName(name)
  for (let n = 1; ; n++) {
    const folder = path.join(serversRoot(), n === 1 ? base : `${base} (${n})`)
    if (!fs.existsSync(folder)) return folder
  }
}

// 모드 서버는 메모리를 많이 쓴다. 컴퓨터 메모리가 8GB 이상이면 4GB, 아니면 2GB로 시작한다.
function defaultMemoryMb(software: Software): number {
  const modded = software === 'fabric' || software === 'quilt' || software === 'forge' || software === 'neoforge'
  return modded && os.totalmem() >= 8 * 1024 ** 3 ? 4096 : 2048
}

export async function createServer(
  { name, software, mcVersion, loaderVersion, properties, importWorldFrom, modpackId }: CreateServerOptions,
  report: (p: Progress) => void
): Promise<ServerInfo> {
  if (!SOFTWARE_INFO[software]) throw new Error('지원하지 않는 서버 종류예요.')
  if (software !== 'vanilla' && !loaderVersion) throw new Error(`${SOFTWARE_INFO[software].label} 버전을 골라 주세요.`)
  const folderPath = freeFolder(name)

  report({ message: '버전 정보를 확인하고 있어요', phase: 'meta' })
  const meta = await getVersionMeta(mcVersion)
  const dl = meta.downloads.server
  if (needsVanillaJar(software) && !dl) throw new Error(`${mcVersion} 버전은 공식 서버 파일이 없어요.`)

  const oldBackups = backupRoot(folderPath) // 예전에 같은 이름으로 만들었다 지운 서버의 백업
  if (fs.existsSync(oldBackups)) await shell.trashItem(oldBackups).catch(() => undefined)
  fs.mkdirSync(folderPath, { recursive: true })
  fs.writeFileSync(path.join(folderPath, CREATING_FILE), new Date().toISOString())
  let modpackOrigin: ModpackOrigin | undefined
  try {
    if (needsVanillaJar(software) && dl) {
      await downloadFile({
        url: dl.url,
        dest: path.join(folderPath, 'server.jar'),
        sha1: dl.sha1,
        onBytes: (done) => report({ message: '마인크래프트 서버 파일을 받고 있어요', done, total: dl.size, unit: 'bytes', phase: 'vanilla' })
      })
    }
    // 로더 설치 프로그램(Forge 등)도 Java가 있어야 돌아가므로 먼저 준비한다
    const java = await ensureJava(runtimeRoot(), javaComponentOf(meta), (message, done, total) =>
      report({ message, done, total, unit: 'files', phase: 'java' })
    )
    if (software !== 'vanilla') {
      await installLoader(software, mcVersion, loaderVersion!, folderPath, java, (message, phase, done, total) =>
        report({ message, phase, done, total, unit: done != null ? 'bytes' : undefined })
      )
    }
    if (modpackId) modpackOrigin = await installModpack(folderPath, modpackId, report)
  } catch (e) {
    // 반쯤 만든 폴더를 남기지 않는다. 방금 끈 설치 프로그램이 파일을 잡고 있을 수 있어서 몇 번 다시 시도하고, 그래도 안 되면 다음에 앱을 켤 때 정리된다
    try {
      fs.rmSync(folderPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
    } catch {
      // .creating 표시가 남아 있어서 다음 실행 때 지워진다
    }
    throw e
  }

  const info: ServerInfo = {
    name: name.trim(),
    software,
    mcVersion,
    ...(software !== 'vanilla' && { loaderVersion }),
    javaComponent: javaComponentOf(meta),
    memoryMb: defaultMemoryMb(software),
    ...(modpackOrigin && { modpack: modpackOrigin }),
    folderPath,
    createdAt: new Date().toISOString()
  }
  fs.writeFileSync(path.join(folderPath, INFO_FILE), JSON.stringify(info, null, 2))
  applyDefaultsOnce(info)
  // 초기 설정 창에서 고른 값 (앱 기본값보다 우선). 처음 켤 때 이 값으로 월드가 만들어진다
  const chosen: Record<string, string> = {}
  for (const [key, value] of Object.entries(properties ?? {})) {
    if (/^[a-z0-9.-]{1,64}$/.test(key)) chosen[key] = String(value).replace(/[\r\n]+/g, ' ').slice(0, 500)
  }
  if (Object.keys(chosen).length) writeProperties(folderPath, chosen)
  if (importWorldFrom) {
    report({ message: '싱글플레이 월드를 복사하고 있어요' })
    await importWorld(folderPath, importWorldFrom)
  }
  fs.rmSync(path.join(folderPath, CREATING_FILE), { force: true })
  report({ message: '완료' })
  return info
}

// 정보 파일의 일부만 바꾼다
export function patchServerInfo(folderPath: string, patch: Partial<ServerInfo>): void {
  const info = { ...readServerInfo(folderPath), ...patch }
  fs.writeFileSync(path.join(folderPath, INFO_FILE), JSON.stringify(info, null, 2))
}

export function readServerInfo(folderPath: string): ServerInfo {
  const info = JSON.parse(fs.readFileSync(path.join(folderPath, INFO_FILE), 'utf8')) as ServerInfo
  return { ...info, folderPath }
}

// 서버에 맞는 Java를 준비하고 java.exe 경로를 돌려준다.
// (2단계 때 만든 서버는 javaComponent가 없어서 버전 정보에서 찾아 적어 둔다)
async function javaFor(folderPath: string, report: (p: Progress) => void): Promise<{ info: ServerInfo; java: string }> {
  const info = readServerInfo(folderPath)
  if (!info.javaComponent) {
    info.javaComponent = javaComponentOf(await getVersionMeta(info.mcVersion))
    fs.writeFileSync(path.join(folderPath, INFO_FILE), JSON.stringify(info, null, 2))
  }
  const java = await ensureJava(runtimeRoot(), info.javaComponent, (message, done, total) =>
    report({ message, done, total, unit: 'files' })
  )
  return { info, java }
}

// 서버 버전 바꾸기: 같은 서버 종류 안에서 마인크래프트 버전과 로더(빌드) 버전을 바꾼다.
// 월드가 있으면 먼저 백업한다 (버전을 낮추면 월드가 망가질 수 있고, 올려도 되돌릴 수 없다).
// 새 파일을 다 받은 다음에 바꿔 끼워서, 중간에 실패하면 원래 버전이 그대로 남는다.
export async function changeVersion(folderPath: string, mcVersion: string, loaderVersion: string | undefined, report: (p: Progress) => void): Promise<ServerInfo> {
  if (getState(folderPath) !== 'stopped') throw new Error('서버를 끈 다음에 버전을 바꿀 수 있어요.')
  const info = readServerInfo(folderPath)
  const software = info.software
  if (software !== 'vanilla' && !loaderVersion) throw new Error(`${SOFTWARE_INFO[software].label} 버전을 골라 주세요.`)
  if (mcVersion === info.mcVersion && (software === 'vanilla' || loaderVersion === info.loaderVersion)) throw new Error('지금과 같은 버전이에요.')

  report({ message: '버전 정보를 확인하고 있어요' })
  const meta = await getVersionMeta(mcVersion)
  const dl = meta.downloads.server
  if (needsVanillaJar(software) && !dl) throw new Error(`${mcVersion} 버전은 공식 서버 파일이 없어요.`)

  const level = readProperties(folderPath)['level-name'] || 'world'
  if (fs.existsSync(path.join(folderPath, level, 'level.dat'))) {
    report({ message: '바꾸기 전에 월드를 백업하고 있어요' })
    await createBackup(folderPath, true, `${info.mcVersion} → ${mcVersion} 바꾸기 전`)
  }

  const java = await ensureJava(runtimeRoot(), javaComponentOf(meta), (message, done, total) => report({ message, done, total, unit: 'files' }))
  const newJar = path.join(folderPath, 'server.jar.new')
  try {
    if (needsVanillaJar(software) && dl && mcVersion !== info.mcVersion) {
      await downloadFile({
        url: dl.url,
        dest: newJar,
        sha1: dl.sha1,
        onBytes: (done) => report({ message: '마인크래프트 서버 파일을 받고 있어요', done, total: dl.size, unit: 'bytes' })
      })
    }
    if (software !== 'vanilla') {
      // Forge·NeoForge는 버전마다 libraries 안에 폴더가 따로 생긴다. 새로 설치한 뒤 예전 것을 지워야 새 버전으로 켜진다
      const libRoot = path.join(folderPath, 'libraries', software === 'forge' ? 'net/minecraftforge/forge' : 'net/neoforged/neoforge')
      const before = fs.existsSync(libRoot) ? fs.readdirSync(libRoot) : []
      const keep = software === 'forge' ? `${mcVersion}-${loaderVersion}` : loaderVersion!
      const forgeLike = software === 'forge' || software === 'neoforge'
      try {
        await installLoader(software, mcVersion, loaderVersion!, folderPath, java, (message, _phase, done, total) =>
          report({ message, done, total, unit: done != null ? 'bytes' : undefined })
        )
        if (forgeLike) launchTarget(software, folderPath, mcVersion, loaderVersion) // 새 버전으로 켤 수 있는지 (없으면 오류)
      } catch (e) {
        // 반쯤 설치된 새 버전 폴더는 지운다 (예전 버전은 그대로 남아 있다)
        if (forgeLike && !before.includes(keep)) fs.rmSync(path.join(libRoot, keep), { recursive: true, force: true })
        throw e
      }
      if (forgeLike) {
        for (const d of before) if (d !== keep) fs.rmSync(path.join(libRoot, d), { recursive: true, force: true })
        // 1.17 전 Forge는 폴더에 서버 jar가 생긴다. 예전 버전 jar는 지운다
        for (const f of fs.readdirSync(folderPath))
          if (/^(forge|minecraftforge).*\.jar$/i.test(f) && !/installer/i.test(f) && !f.includes(`${mcVersion}-${loaderVersion}`)) fs.rmSync(path.join(folderPath, f), { force: true })
      }
    }
    if (fs.existsSync(newJar)) fs.renameSync(newJar, path.join(folderPath, 'server.jar'))
  } finally {
    fs.rmSync(newJar, { force: true })
  }

  const next: ServerInfo = { ...readServerInfo(folderPath), mcVersion, javaComponent: javaComponentOf(meta) }
  if (software !== 'vanilla') next.loaderVersion = loaderVersion
  fs.writeFileSync(path.join(folderPath, INFO_FILE), JSON.stringify(next, null, 2))
  report({ message: '완료' })
  return next
}

// 앱을 켤 때: 만드는 도중에 앱이 꺼져 "만드는 중" 표시가 남은 폴더를 지운다.
// (목록에는 안 보이는데 같은 이름으로 다시 만들 수 없게 막는 원인이었다)
export function cleanupUnfinished(): void {
  const root = serversRoot()
  if (!fs.existsSync(root)) return
  for (const dir of fs.readdirSync(root)) {
    const folder = path.join(root, dir)
    if (fs.existsSync(path.join(folder, CREATING_FILE))) fs.rmSync(folder, { recursive: true, force: true })
  }
}

// Aikar's flags (https://docs.papermc.io/paper/aikars-flags): 마인크래프트 서버에 맞춘 G1 GC 설정. 12GB가 넘으면 큰 메모리용 값을 쓴다
function aikarFlags(memMb: number): string[] {
  const big = memMb > 12 * 1024
  return [
    '-XX:+UseG1GC',
    '-XX:+ParallelRefProcEnabled',
    '-XX:MaxGCPauseMillis=200',
    '-XX:+UnlockExperimentalVMOptions',
    '-XX:+DisableExplicitGC',
    '-XX:+AlwaysPreTouch',
    `-XX:G1NewSizePercent=${big ? 40 : 30}`,
    `-XX:G1MaxNewSizePercent=${big ? 50 : 40}`,
    `-XX:G1HeapRegionSize=${big ? 16 : 8}M`,
    `-XX:G1ReservePercent=${big ? 15 : 20}`,
    '-XX:G1HeapWastePercent=5',
    '-XX:G1MixedGCCountTarget=4',
    `-XX:InitiatingHeapOccupancyPercent=${big ? 20 : 15}`,
    '-XX:G1MixedGCLiveThresholdPercent=90',
    '-XX:G1RSetUpdatingPauseTimePercent=5',
    '-XX:SurvivorRatio=32',
    '-XX:+PerfDisableSharedMem',
    '-XX:MaxTenuringThreshold=1',
    '-Dusing.aikars.flags=https://mcflags.emc.gs',
    '-Daikars.new.flags=true'
  ]
}

// 사용자가 더 넣은 자바 옵션을 나눈다 ("따옴표"로 묶은 것은 하나로). "-"로 시작하는 옵션만 받는다.
// 실행할 파일을 바꾸는 옵션(-jar, -cp, @파일)은 서버가 엉뚱한 것을 실행하게 되므로 막는다
export function parseJavaArgs(text: string): string[] {
  const out: string[] = []
  for (const m of String(text ?? '').matchAll(/"([^"]*)"|(\S+)/g)) out.push(m[1] ?? m[2])
  for (const a of out) {
    if (!a.startsWith('-')) throw new Error(`자바 옵션은 "-"로 시작해야 해요: ${a}`)
    if (/^-(jar|cp|classpath|-class-path)$/i.test(a)) throw new Error(`이 옵션은 쓸 수 없어요: ${a}`)
    // 메모리는 슬라이더와 따로 정하면 어느 쪽이 적용되는지 헷갈린다
    if (/^-Xm[sx]/i.test(a) || /^-XX:(Max|Initial)HeapSize=/i.test(a)) throw new Error(`메모리(${a})는 위의 "서버가 쓸 메모리"로 정해 주세요.`)
  }
  return out
}

// 사용자 옵션이 메모리 정리 방식(GC)을 고르는지 (예: -XX:+UseZGC). 그러면 G1용인 자바 최적화 옵션과 같이 쓸 수 없다
export const picksGc = (args: string[]): boolean => args.some((a) => /^-XX:\+Use\w*GC$/i.test(a))

export async function startServerAt(folderPath: string, report: (p: Progress) => void): Promise<void> {
  if (!isEulaAccepted(folderPath)) throw new Error('EULA에 동의해야 서버를 켤 수 있어요.')
  assertFree(folderPath) // 버전 바꾸기 등을 하는 중에는 켜지 않는다
  const { info, java } = await javaFor(folderPath, report) // 보통은 이미 받아 둬서 바로 끝난다
  await autoBackupBeforeStart(folderPath) // 켜기 전에 월드를 자동으로 백업해 둔다
  applyDefaultsOnce(info) // 기본값이 생기기 전에 만든 서버도 한 번 맞춰 준다
  const mem = info.memoryMb ?? 2048
  // 최적화를 켜면 처음부터 메모리를 다 잡고(Xms=Xmx) Aikar's flags로 멈춤(렉)을 줄인다
  const userArgs = parseJavaArgs(info.javaArgs ?? '')
  // 자바 최적화(Aikar's flags)는 G1 전용이라, 사용자가 다른 GC를 고르면 같이 넣지 않는다 (둘 다 넣으면 자바가 켜지지 않는다)
  const aikar = info.optimizeFlags && !picksGc(userArgs)
  const memArgs = info.optimizeFlags ? [`-Xms${mem}M`, `-Xmx${mem}M`, ...(aikar ? aikarFlags(mem) : [])] : [`-Xmx${mem}M`, `-Xms${Math.min(1024, mem)}M`]
  await startServer(folderPath, {
    java,
    args: [...memArgs, ...userArgs, ...launchTarget(info.software ?? 'vanilla', folderPath, info.mcVersion, info.loaderVersion), 'nogui']
  })
  startInvite(folderPath, info.name) // 공유기 포트 열기는 기다리지 않고 뒤에서 진행한다
}

// ---------- 목록 순서 ----------
const orderFile = (): string => path.join(app.getPath('userData'), 'server-order.json')
function readOrder(): string[] {
  try {
    const list = JSON.parse(fs.readFileSync(orderFile(), 'utf8'))
    return Array.isArray(list) ? list.map(String) : []
  } catch {
    return []
  }
}

export function setServerOrder(folderPaths: string[]): void {
  fs.writeFileSync(orderFile(), JSON.stringify(folderPaths.map((p) => path.basename(String(p)))))
}

// 모드·플러그인 수 (모드를 못 쓰는 서버면 null)
function countMods(folderPath: string, software: Software): number | null {
  const folder = ['fabric', 'quilt', 'forge', 'neoforge'].includes(software) ? 'mods' : ['paper', 'purpur'].includes(software) ? 'plugins' : null
  if (!folder) return null
  try {
    // 모드 탭 숫자와 같게: 꺼 둔 것도 세고, 앱이 알아서 까는 기본 모드(Fabric API 등)는 뺀다
    return fs.readdirSync(path.join(folderPath, folder)).filter((f) => /\.jar(\.disabled)?$/i.test(f) && !/^(fabric-api|qsl|quilted-fabric-api)[-_+]/i.test(f)).length
  } catch {
    return 0
  }
}

export function listServers(): ServerListItem[] {
  const root = serversRoot()
  if (!fs.existsSync(root)) return []
  const list: ServerListItem[] = []
  for (const dir of fs.readdirSync(root)) {
    const folderPath = path.join(root, dir)
    try {
      const info = readServerInfo(folderPath)
      list.push({
        ...info,
        state: getState(folderPath),
        eulaAccepted: isEulaAccepted(folderPath),
        icon: getServerIcon(folderPath),
        startedAt: getStartedAt(folderPath),
        playerCount: getPlayers(folderPath).length,
        modCount: countMods(folderPath, info.software ?? 'vanilla'),
        lastBackupAt: listBackups(folderPath)[0]?.createdAt ?? null
      })
    } catch {
      // 정보 파일이 없거나 깨진 폴더는 건너뛴다
    }
  }
  // 사용자가 끌어서 정한 순서가 먼저, 순서에 없는 서버(새로 만든 것)는 맨 위에 최신순
  const order = readOrder()
  const rank = (s: ServerListItem): number => {
    const i = order.indexOf(path.basename(s.folderPath))
    return i === -1 ? -1 : i
  }
  return list.sort((a, b) => rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt))
}

// ---------- 설정 화면 ----------
const MIN_MEMORY_MB = 1024

export function getSettings(folderPath: string): ServerSettings {
  const info = readServerInfo(folderPath)
  const totalMb = Math.floor(os.totalmem() / 1024 / 1024)
  return {
    properties: readProperties(folderPath),
    memoryMb: info.memoryMb ?? 2048,
    autoRestart: info.autoRestart !== false,
    optimizeFlags: !!info.optimizeFlags,
    minMemoryMb: MIN_MEMORY_MB,
    maxMemoryMb: Math.max(MIN_MEMORY_MB, totalMb - 2048), // 윈도우가 쓸 2GB는 남겨 둔다
    totalMemoryMb: totalMb,
    worldExists: worldExists(folderPath),
    javaArgs: info.javaArgs ?? '',
    automation: { ...DEFAULT_AUTOMATION, ...info.automation },
    otherAutoStart: listServers()
      .filter((s) => s.folderPath !== folderPath && s.automation?.autoStart)
      .map((s) => ({ name: s.name, port: serverPort(s.folderPath) })),
    paper: info.software === 'paper' || info.software === 'purpur' ? readPaper(folderPath) : null
  }
}

// ---------- Paper·Purpur 전용 설정 ----------
function readPaper(folderPath: string): Record<string, string> {
  const out: Record<string, string> = {}
  const cache = new Map<string, string | null>()
  for (const f of PAPER_FIELDS) {
    if (!cache.has(f.file)) {
      try {
        cache.set(f.file, fs.readFileSync(path.join(folderPath, f.file), 'utf8'))
      } catch {
        cache.set(f.file, null) // 아직 한 번도 안 켜서 파일이 없다
      }
    }
    const text = cache.get(f.file)
    const v = text == null ? null : readYamlValue(text, f.path)
    if (v != null) out[f.id] = v
  }
  return out
}

function savePaper(folderPath: string, changes: Record<string, string>): void {
  const byFile = new Map<string, string>()
  for (const [id, raw] of Object.entries(changes)) {
    const f = PAPER_FIELDS.find((x) => x.id === id)
    if (!f) throw new Error(`알 수 없는 설정이에요: ${id}`)
    let value: string
    if (f.type === 'bool') {
      if (raw !== 'true' && raw !== 'false') throw new Error(`${f.label}: 켜기·끄기만 고를 수 있어요.`)
      value = raw
    } else {
      const n = Number(raw)
      if (!Number.isFinite(n) || (f.min != null && n < f.min * (f.scale ?? 1)) || (f.max != null && n > f.max * (f.scale ?? 1))) throw new Error(`${f.label}: 범위를 벗어난 값이에요.`)
      value = String(n)
    }
    const file = path.join(folderPath, f.file)
    const text = byFile.get(f.file) ?? fs.readFileSync(file, 'utf8')
    const next = writeYamlValue(text, f.path, value)
    if (next == null) throw new Error(`${f.label}: 설정 파일에서 이 항목을 찾지 못했어요.`)
    byFile.set(f.file, next)
  }
  for (const [rel, text] of byFile) fs.writeFileSync(path.join(folderPath, rel), text)
}

export function saveSettings(folderPath: string, { properties, memoryMb, autoRestart, optimizeFlags, javaArgs, automation, paper }: SaveSettings): void {
  if (javaArgs != null) parseJavaArgs(javaArgs) // 잘못된 옵션이면 아무것도 저장하기 전에 알린다
  if (automation?.dailyRestart && !/^([01]\d|2[0-3]):[0-5]\d$/.test(automation.dailyRestart)) throw new Error('재시작 시각을 다시 골라 주세요.')
  if (paper && Object.keys(paper).length) savePaper(folderPath, paper)
  const clean: Record<string, string> = {}
  for (const [key, value] of Object.entries(properties ?? {})) {
    if (!/^[a-z0-9.-]{1,64}$/.test(key)) throw new Error(`잘못된 설정 이름이에요: ${key}`)
    clean[key] = String(value).replace(/[\r\n]+/g, ' ').slice(0, 500)
  }
  if (Object.keys(clean).length) writeProperties(folderPath, clean)

  if (memoryMb != null) {
    const { minMemoryMb, maxMemoryMb } = getSettings(folderPath)
    const info = readServerInfo(folderPath)
    info.memoryMb = Math.round(Math.min(maxMemoryMb, Math.max(minMemoryMb, Number(memoryMb) || 2048)))
    fs.writeFileSync(path.join(folderPath, INFO_FILE), JSON.stringify(info, null, 2))
  }
  if (autoRestart != null || optimizeFlags != null || javaArgs != null || automation) {
    const info = readServerInfo(folderPath)
    if (autoRestart != null) info.autoRestart = !!autoRestart
    if (optimizeFlags != null) info.optimizeFlags = !!optimizeFlags
    if (javaArgs != null) info.javaArgs = String(javaArgs).replace(/[\r\n]+/g, ' ').trim().slice(0, 1000)
    if (automation) info.automation = cleanAutomation({ ...DEFAULT_AUTOMATION, ...info.automation, ...automation })
    fs.writeFileSync(path.join(folderPath, INFO_FILE), JSON.stringify(info, null, 2))
  }
}

function cleanAutomation(a: ServerAutomation): ServerAutomation {
  return {
    autoStart: !!a.autoStart,
    dailyRestart: /^([01]\d|2[0-3]):[0-5]\d$/.test(a.dailyRestart) ? a.dailyRestart : '',
    emptyStopMin: Math.max(0, Math.min(24 * 60, Math.round(Number(a.emptyStopMin) || 0))),
    welcome: String(a.welcome ?? '').replace(/[\r\n]+/g, ' ').slice(0, 200)
  }
}

// ---------- 월드 새로 만들기 ----------
// 월드 폴더들(Paper/Purpur는 네더·엔드가 따로 있다)을 휴지통으로 보낸다. 다음에 켤 때 지금 설정으로 새 월드가 만들어진다.
function worldFolders(folderPath: string): string[] {
  const name = readProperties(folderPath)['level-name'] || 'world'
  return [name, `${name}_nether`, `${name}_the_end`]
    .map((n) => path.join(folderPath, n))
    .filter((p) => p.startsWith(folderPath + path.sep) && fs.existsSync(p))
}

export const worldExists = (folderPath: string): boolean => worldFolders(folderPath).length > 0

export async function resetWorld(folderPath: string): Promise<void> {
  if (getState(folderPath) !== 'stopped') throw new Error('서버를 끈 다음에 월드를 새로 만들 수 있어요.')
  // 휴지통만 믿지 않고 먼저 백업해 둔다 (큰 폴더는 휴지통에 안 들어갈 수 있다)
  if (worldExists(folderPath)) await createBackup(folderPath, false, '월드 리셋 전')
  for (const dir of worldFolders(folderPath)) await shell.trashItem(dir)
}

const serverName = (folderPath: string): string => {
  try {
    return readServerInfo(folderPath).name
  } catch {
    return path.basename(folderPath)
  }
}

// 서버가 다 켜지면 알려 준다 (켜는 데 오래 걸리는 모드 서버용). 창을 보고 있으면 알리지 않는다
onServerEvent((e) => {
  if (e.type === 'status' && e.state === 'running') notify(`${serverName(e.folderPath)} 서버가 켜졌어요`, '이제 플레이어들이 들어올 수 있어요.')
})

// ---------- 튕기면 자동으로 다시 켜기 ----------
// 다 켜진 뒤에 튕겼을 때만 5초 뒤 다시 켠다. 10분 안에 3번 넘게 튕기면 계속 튕기는 것이라 멈춘다.
const RESTART_DELAY_MS = 5000
const RESTART_WINDOW_MS = 10 * 60_000
const RESTART_MAX = 3
const recentCrashes = new Map<string, number[]>()
const pendingRestarts = new Set<ReturnType<typeof setTimeout>>()
// 앱을 끌 때 기다리던 재시작을 모두 취소한다
export function cancelAutoRestarts(): void {
  pendingRestarts.forEach(clearTimeout)
  pendingRestarts.clear()
}

onCrash((folderPath, { log, startedAt, wasRunning }) => {
  const analysis = analyzeCrash(folderPath, log, startedAt)
  const reason = analysis.title
  notify(`${serverName(folderPath)} 서버가 튕겼어요`, reason + (wasRunning ? '' : ' (켜지는 중에 꺼졌어요)'))
  const lines = [`[앱] 튕긴 원인: ${analysis.title}`, ...analysis.cause.split('\n').map((l) => `[앱]   ${l}`)]
  lines.forEach((line) => emitEvent({ type: 'log', folderPath, line }))
  let enabled = true
  try {
    enabled = readServerInfo(folderPath).autoRestart !== false
  } catch {
    enabled = false // 서버가 지워졌다
  }
  const now = Date.now()
  const times = (recentCrashes.get(folderPath) ?? []).filter((t) => now - t < RESTART_WINDOW_MS)
  times.push(now)
  recentCrashes.set(folderPath, times)
  const restarting = enabled && wasRunning && times.length <= RESTART_MAX
  const tooMany = enabled && wasRunning && !restarting
  emitEvent({
    type: 'crashed',
    folderPath,
    reason: tooMany ? `${reason} (10분 안에 여러 번 튕겨서 자동으로 다시 켜지 않았어요)` : reason,
    restarting,
    analysis
  })
  if (!restarting) return
  emitEvent({ type: 'log', folderPath, line: `[앱] ${RESTART_DELAY_MS / 1000}초 뒤에 서버를 다시 켜요…` })
  const timer = setTimeout(() => {
    pendingRestarts.delete(timer)
    if (getState(folderPath) !== 'stopped') return // 그사이 사용자가 직접 켰다
    startServerAt(folderPath, () => undefined).catch((e) =>
      emitEvent({ type: 'log', folderPath, line: `[앱] 다시 켜지 못했어요: ${e instanceof Error ? e.message : e}` })
    )
  }, RESTART_DELAY_MS)
  pendingRestarts.add(timer)
})

// ---------- 이름 바꾸기 · 복제 ----------
// 이름만 바꾸고 폴더는 그대로 둔다 (백업·실행 중인 서버가 폴더 경로로 묶여 있다)
export function renameServer(folderPath: string, name: string): void {
  const clean = String(name).replace(/[\r\n]+/g, ' ').trim().slice(0, 60)
  if (!clean) throw new Error('서버 이름을 입력해 주세요.')
  const info = readServerInfo(folderPath)
  info.name = clean
  fs.writeFileSync(path.join(folderPath, INFO_FILE), JSON.stringify(info, null, 2))
}

const SKIP_ON_COPY = new Set(['logs', 'crash-reports', CREATING_FILE, 'session.lock'])

export async function duplicateServer(folderPath: string, name: string): Promise<ServerInfo> {
  if (getState(folderPath) !== 'stopped') throw new Error('서버를 끈 다음에 복제할 수 있어요.')
  const target = freeFolder(name)
  const oldBackups = backupRoot(target)
  if (fs.existsSync(oldBackups)) await shell.trashItem(oldBackups).catch(() => undefined)
  fs.mkdirSync(target)
  fs.writeFileSync(path.join(target, CREATING_FILE), '') // 복사하다 앱이 꺼지면 다음에 정리된다
  try {
    await fs.promises.cp(folderPath, target, {
      recursive: true,
      // 맨 위의 로그 폴더 등과, 월드 안의 session.lock(켜진 서버 표시)은 복사하지 않는다
      filter: (src) => !(path.dirname(src) === folderPath && SKIP_ON_COPY.has(path.basename(src))) && path.basename(src) !== 'session.lock'
    })
    const info = readServerInfo(target)
    info.name = String(name).trim().slice(0, 60)
    info.createdAt = new Date().toISOString()
    fs.writeFileSync(path.join(target, INFO_FILE), JSON.stringify(info, null, 2))
    fs.rmSync(path.join(target, CREATING_FILE), { force: true })
    return { ...info, folderPath: target }
  } catch (e) {
    fs.rmSync(target, { recursive: true, force: true })
    throw e
  }
}
