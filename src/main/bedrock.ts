// 배드락(Bedrock) 전용 서버(BDS): 공식 서버를 받아 풀고, 애드온(비헤이비어·리소스 팩)을 넣고 뺀다.
// 자바 서버와 달리 Java·로더·EULA 파일이 없고, 접속은 UDP 포트(기본 19132)를 쓴다.
import { shell } from 'electron'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { InstalledAddon, Progress } from '../shared-types'
import { downloadFile, fetchJson } from './download'
import { readProperties } from './properties'
import { extractZip } from './worldzip'

export const BEDROCK_PORT = 19132
export const BEDROCK_EXE = 'bedrock_server.exe'
// minecraft.net은 앱의 User-Agent(MC-CubePanel/…)로 받으려 하면 연결을 끊는다. 일반 브라우저처럼 보이게 받는다
export const BROWSER_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' }
const LINKS_URL = 'https://net-secondary.web.minecraft-services.net/api/v1.0/download/links'
const STATE_FILE = '.server-manager-bedrock.json' // 서버를 만들 때 들어 있던 기본 팩 이름 (애드온 목록에서 뺀다)

// 공식 다운로드 목록에서 윈도우용 최신 BDS를 찾는다 (옛 버전 목록은 공식으로 없다)
export async function latestBedrock(): Promise<{ version: string; url: string }> {
  const data = await fetchJson<{ result?: { links?: { downloadType: string; downloadUrl: string }[] } }>(LINKS_URL).catch(() => null)
  const url = data?.result?.links?.find((l) => l.downloadType === 'serverBedrockWindows')?.downloadUrl
  const version = url && /bedrock-server-([\d.]+)\.zip$/.exec(url)?.[1]
  if (!url || !version || !/^https:\/\/www\.minecraft\.net\//.test(url)) throw new Error('배드락 서버 파일 정보를 받지 못했어요. 인터넷 연결을 확인해 주세요.')
  return { version, url }
}

// 서버를 받아서 폴더에 푼다. 기본 팩 이름도 적어 둔다
export async function installBedrock(folderPath: string, url: string, report: (p: Progress) => void): Promise<void> {
  const zip = path.join(os.tmpdir(), `bedrock-${crypto.randomBytes(4).toString('hex')}.zip`)
  try {
    await downloadFile({
      url,
      dest: zip,
      headers: BROWSER_HEADERS,
      onBytes: (done, total) => report({ message: '배드락 서버 파일을 받고 있어요', done, total, unit: 'bytes', phase: 'vanilla' })
    })
    report({ message: '서버 파일을 풀고 있어요', phase: 'install' })
    await extractZip(zip, folderPath)
  } finally {
    fs.rmSync(zip, { force: true })
  }
  if (!fs.existsSync(path.join(folderPath, BEDROCK_EXE))) throw new Error('받은 파일에서 배드락 서버(bedrock_server.exe)를 찾지 못했어요.')
  const defaults = [...packDirs(folderPath, 'behavior_packs'), ...packDirs(folderPath, 'resource_packs')]
  fs.writeFileSync(path.join(folderPath, STATE_FILE), JSON.stringify({ defaults }))
}

// 업데이트로 새로 들어온 기본 팩 이름을 목록에서 뺄 것에 더한다
export function addDefaults(folderPath: string, more: string[]): void {
  const merged = [...new Set([...defaultsOf(folderPath), ...more])]
  fs.writeFileSync(path.join(folderPath, STATE_FILE), JSON.stringify({ defaults: merged }))
}

export const isBedrockFolder = (folderPath: string): boolean => fs.existsSync(path.join(folderPath, BEDROCK_EXE))

// 월드 폴더: worlds/<level-name>
export const bedrockWorldDir = (folderPath: string): string => path.join(folderPath, 'worlds', readProperties(folderPath)['level-name'] || 'Bedrock level')

// ---------- 애드온 ----------
type Kind = 'behavior' | 'resource'
const KIND_DIR: Record<Kind, string> = { behavior: 'behavior_packs', resource: 'resource_packs' }
const KIND_JSON: Record<Kind, string> = { behavior: 'world_behavior_packs.json', resource: 'world_resource_packs.json' }

interface Manifest {
  uuid: string
  version: [number, number, number]
  name: string
  description: string
  kind: Kind
  script: boolean // 스크립트(JavaScript) 모듈이 들어 있다
}

export function packDirs(folderPath: string, sub: string): string[] {
  try {
    return fs
      .readdirSync(path.join(folderPath, sub), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => `${sub}/${e.name}`)
  } catch {
    return []
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// manifest.json은 주석이나 끝 쉼표가 있는 경우가 많아서 느슨하게 읽는다
function readJson(file: string): any {
  let text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
  try {
    return JSON.parse(text)
  } catch {
    text = text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:"\\])\/\/.*$/gm, '$1')
      .replace(/,(\s*[}\]])/g, '$1')
    return JSON.parse(text)
  }
}

// "pack.name" 같은 번역 키면 texts/en_US.lang(없으면 첫 lang)에서 이름을 찾는다
function langText(dir: string, key: string): string {
  if (!/^[\w.]+$/.test(key)) return key
  try {
    const texts = path.join(dir, 'texts')
    const files = ['en_US.lang', ...fs.readdirSync(texts).filter((f) => f.endsWith('.lang'))]
    for (const f of files) {
      const m = new RegExp(`^${key.replace(/\./g, '\\.')}=(.*?)(\\s*#.*)?$`, 'm').exec(fs.readFileSync(path.join(texts, f), 'utf8'))
      if (m) return m[1].trim()
    }
  } catch {
    // 번역 파일이 없다
  }
  return key
}

function readManifest(dir: string): Manifest | null {
  try {
    const m = readJson(path.join(dir, 'manifest.json'))
    const uuid = String(m?.header?.uuid ?? '')
    const v = m?.header?.version
    if (!UUID.test(uuid) || !Array.isArray(v) || v.length < 3) return null
    const types: string[] = (m.modules ?? []).map((x: { type?: string }) => String(x?.type ?? '').toLowerCase())
    if (!types.length) return null
    // 리소스 모듈이 있으면 리소스 팩, 데이터·스크립트면 비헤이비어 팩 (스킨 팩 등은 서버에서 쓰지 않는다)
    const kind: Kind | null = types.includes('resources')
      ? 'resource'
      : types.some((t) => t === 'data' || t === 'script' || t === 'javascript' || t === 'client_data')
        ? 'behavior'
        : null
    if (!kind) return null
    const name = langText(dir, String(m.header.name ?? path.basename(dir))).slice(0, 80)
    return {
      uuid: uuid.toLowerCase(),
      version: [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0],
      name,
      description: langText(dir, String(m.header.description ?? '')).slice(0, 200),
      kind,
      script: kind === 'behavior' && types.some((t) => t === 'script' || t === 'javascript')
    }
  } catch {
    return null
  }
}

interface PackRef {
  pack_id: string
  version: number[]
}

function readEnabled(folderPath: string, kind: Kind): PackRef[] {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(bedrockWorldDir(folderPath), KIND_JSON[kind]), 'utf8'))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function writeEnabled(folderPath: string, kind: Kind, list: PackRef[]): void {
  const dir = bedrockWorldDir(folderPath)
  fs.mkdirSync(dir, { recursive: true }) // 처음 켜기 전이어도 미리 적어 두면 월드를 만들 때 적용된다
  fs.writeFileSync(path.join(dir, KIND_JSON[kind]), JSON.stringify(list, null, 2))
}

function defaultsOf(folderPath: string): Set<string> {
  try {
    return new Set(JSON.parse(fs.readFileSync(path.join(folderPath, STATE_FILE), 'utf8')).defaults ?? [])
  } catch {
    return new Set()
  }
}

export function listAddons(folderPath: string): InstalledAddon[] {
  const defaults = defaultsOf(folderPath)
  const out: InstalledAddon[] = []
  for (const kind of ['behavior', 'resource'] as const) {
    const enabled = readEnabled(folderPath, kind)
    for (const rel of packDirs(folderPath, KIND_DIR[kind])) {
      if (defaults.has(rel)) continue
      const m = readManifest(path.join(folderPath, rel))
      if (!m) continue
      out.push({
        id: rel,
        kind,
        title: m.name,
        description: m.description,
        version: m.version.join('.'),
        script: m.script,
        enabled: enabled.some((e) => String(e.pack_id).toLowerCase() === m.uuid),
        iconUrl: fs.existsSync(path.join(folderPath, rel, 'pack_icon.png'))
          ? `data:image/png;base64,${fs.readFileSync(path.join(folderPath, rel, 'pack_icon.png')).toString('base64')}`
          : null
      })
    }
  }
  return out.sort((a, b) => a.title.localeCompare(b.title))
}

// 팩 폴더 안의 id("behavior_packs/이름")만 받는다
function checkId(folderPath: string, id: string): { kind: Kind; dir: string } {
  const m = /^(behavior_packs|resource_packs)\/([^/\\]+)$/.exec(String(id))
  if (!m || m[2] === '..' || m[2] === '.') throw new Error('잘못된 애드온이에요.')
  const dir = path.join(folderPath, m[1], m[2])
  if (!fs.existsSync(dir)) throw new Error('애드온을 찾을 수 없어요.')
  return { kind: m[1] === 'behavior_packs' ? 'behavior' : 'resource', dir }
}

export function setAddonEnabled(folderPath: string, id: string, enabled: boolean): void {
  const { kind, dir } = checkId(folderPath, id)
  const m = readManifest(dir)
  if (!m) throw new Error('애드온 정보(manifest.json)를 읽지 못했어요.')
  const rest = readEnabled(folderPath, kind).filter((e) => String(e.pack_id).toLowerCase() !== m.uuid)
  writeEnabled(folderPath, kind, enabled ? [...rest, { pack_id: m.uuid, version: m.version }] : rest)
}

export async function removeAddon(folderPath: string, id: string): Promise<void> {
  const { kind, dir } = checkId(folderPath, id)
  const m = readManifest(dir)
  if (m)
    writeEnabled(
      folderPath,
      kind,
      readEnabled(folderPath, kind).filter((e) => String(e.pack_id).toLowerCase() !== m.uuid)
    )
  await shell.trashItem(dir)
}

// manifest.json이 있는 폴더를 찾는다 (.mcaddon은 팩 폴더가 여러 개, .mcpack은 보통 맨 위에 하나)
function findPacks(dir: string, depth = 0, found: string[] = []): string[] {
  if (fs.existsSync(path.join(dir, 'manifest.json'))) {
    found.push(dir)
    return found
  }
  if (depth >= 3) return found
  for (const e of fs.readdirSync(dir, { withFileTypes: true }))
    if (e.isDirectory() && e.name !== '__MACOSX') findPacks(path.join(dir, e.name), depth + 1, found)
  return found
}

const safeName = (s: string): string =>
  s
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/[. ]+$/, '')
    .trim()
    .slice(0, 40) || 'pack'

// .mcaddon / .mcpack / .zip 파일이나 팩 폴더를 풀어 넣고 켠다. 넣은 애드온 이름들을 돌려준다
export async function addAddonFile(folderPath: string, source: string): Promise<string[]> {
  const src = path.resolve(String(source))
  if (!fs.existsSync(src)) throw new Error('파일을 찾을 수 없어요.')
  const isDir = fs.statSync(src).isDirectory()
  if (!isDir && !/\.(mcaddon|mcpack|zip)$/i.test(src)) throw new Error('애드온 파일(.mcaddon, .mcpack, .zip)이나 팩 폴더가 아니에요.')
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'addon-'))
  try {
    if (isDir) await fs.promises.cp(src, path.join(temp, path.basename(src)), { recursive: true })
    else await extractZip(src, temp)
    // .mcaddon 안에 .mcpack이 들어 있는 경우도 있다
    for (const e of fs.readdirSync(temp, { withFileTypes: true })) {
      if (e.isFile() && /\.(mcpack|zip)$/i.test(e.name)) {
        const inner = path.join(temp, safeName(path.basename(e.name, path.extname(e.name))) + '-inner')
        await extractZip(path.join(temp, e.name), inner)
        fs.rmSync(path.join(temp, e.name), { force: true })
      }
    }
    const packs = findPacks(temp)
      .map((dir) => ({ dir, m: readManifest(dir) }))
      .filter((p): p is { dir: string; m: Manifest } => !!p.m)
    if (!packs.length) throw new Error('애드온 팩(manifest.json)을 찾지 못했어요. 배드락용 애드온이 맞는지 확인해 주세요.')
    const names: string[] = []
    for (const { dir, m } of packs) {
      // 같은 팩(uuid)이 이미 있으면 새 것으로 바꾼다
      const existing = listAddons(folderPath).find((a) => {
        const em = readManifest(path.join(folderPath, a.id))
        return em?.uuid === m.uuid
      })
      if (existing) await removeAddon(folderPath, existing.id).catch(() => undefined)
      const target = path.join(folderPath, KIND_DIR[m.kind], `${safeName(m.name)}-${m.uuid.slice(0, 8)}`)
      fs.rmSync(target, { recursive: true, force: true })
      await fs.promises.cp(dir, target, { recursive: true })
      setAddonEnabled(folderPath, `${KIND_DIR[m.kind]}/${path.basename(target)}`, true)
      names.push(m.name)
    }
    return names
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
}

// ---------- 서버 설정 ----------
// 만들기 창에서 넘어온 설정 중 배드락 server.properties에 있는 것만 받는다 (자바 전용 값은 버린다)
export function bedrockProps(chosen: Record<string, string>, name: string, port: number): Record<string, string> {
  const out: Record<string, string> = {
    'server-name': name.slice(0, 60).replace(/[\r\n;]+/g, ' '),
    'server-port': String(port),
    'server-portv6': String(port), // IPv4와 같은 번호 (게임이 localhost를 IPv6(::1)로 먼저 찾아서, 다르면 localhost로 접속이 안 된다)
    'allow-list': 'false', // 기본값이 허용 목록 켜짐이라 그대로면 친구가 못 들어온다
    // 1.26부터 기본 접속 방식(nethernet)은 TCP로 인사한 뒤 임의의 UDP 포트를 쓴다. 앱은 UDP 포트 하나(기본 19132)만 열 수 있어서 예전 방식(raknet)으로 맞춘다
    transport: 'raknet'
  }
  const gamemode = chosen['gamemode']
  if (gamemode && /^(survival|creative|adventure)$/.test(gamemode)) out['gamemode'] = gamemode
  const difficulty = chosen['difficulty']
  if (difficulty && /^(peaceful|easy|normal|hard)$/.test(difficulty)) out['difficulty'] = difficulty
  const max = Number(chosen['max-players'])
  if (Number.isInteger(max) && max >= 1 && max <= 200) out['max-players'] = String(max)
  if (chosen['online-mode'] === 'true' || chosen['online-mode'] === 'false') out['online-mode'] = chosen['online-mode']
  if (chosen['level-seed']) out['level-seed'] = chosen['level-seed'].replace(/[\r\n]+/g, ' ').slice(0, 64)
  return out
}

// ---------- 켜기 전 점검 ----------
// 팩의 manifest.json에는 "이 팩은 저 팩(uuid)이 있어야 한다"는 의존이 적혀 있다. 모듈(@minecraft/server 등) 의존은 서버가 갖고 있어서 보지 않는다.
// - 필요한 팩이 설치돼 있지 않다 / 설치는 됐는데 꺼져 있다 → missing
// - 같은 팩(uuid)이 두 폴더에 들어 있다 → duplicates
// - 월드에 켜 둔 팩이 폴더에 없다 (지워졌다) → missing
export function checkAddons(folderPath: string): { missing: { mod: string; needs: string[] }[]; duplicates: { mod: string; files: string[] }[] } {
  interface Found {
    rel: string
    title: string
    uuid: string
    deps: string[]
    isDefault: boolean
    enabled: boolean
  }
  const defaults = defaultsOf(folderPath)
  const found: Found[] = []
  for (const kind of ['behavior', 'resource'] as const) {
    const enabled = new Set(readEnabled(folderPath, kind).map((e) => String(e.pack_id).toLowerCase()))
    for (const rel of packDirs(folderPath, KIND_DIR[kind])) {
      const dir = path.join(folderPath, rel)
      const m = readManifest(dir)
      if (!m) continue
      let deps: string[] = []
      try {
        const raw = readJson(path.join(dir, 'manifest.json'))
        deps = (Array.isArray(raw?.dependencies) ? raw.dependencies : []).map((d: { uuid?: string }) => String(d?.uuid ?? '').toLowerCase()).filter((u: string) => UUID.test(u))
      } catch {
        // 읽지 못하면 의존 없음으로 본다
      }
      found.push({ rel, title: m.name, uuid: m.uuid, deps, isDefault: defaults.has(rel), enabled: enabled.has(m.uuid) })
    }
  }
  const byUuid = new Map<string, Found[]>()
  for (const f of found) byUuid.set(f.uuid, [...(byUuid.get(f.uuid) ?? []), f])

  const missing: { mod: string; needs: string[] }[] = []
  for (const f of found) {
    if (!f.enabled || f.isDefault) continue
    const needs: string[] = []
    for (const dep of f.deps) {
      const have = byUuid.get(dep)
      if (!have) needs.push(dep)
      else if (!have.some((h) => h.enabled)) needs.push(`${have[0].title} (꺼져 있음)`)
    }
    if (needs.length) missing.push({ mod: f.title, needs })
  }
  // 월드에 켜 둔 팩이 폴더에 없으면 서버가 팩을 찾지 못한다
  for (const kind of ['behavior', 'resource'] as const) {
    for (const e of readEnabled(folderPath, kind)) {
      const id = String(e.pack_id).toLowerCase()
      if (UUID.test(id) && !byUuid.has(id) && !found.some((f) => f.uuid === id)) missing.push({ mod: '월드에 켜 둔 팩', needs: [id] })
    }
  }
  const duplicates = [...byUuid.values()]
    .filter((list) => list.filter((f) => !f.isDefault).length > 1)
    .map((list) => ({ mod: list[0].title, files: list.filter((f) => !f.isDefault).map((f) => f.rel) }))
  return { missing, duplicates }
}
