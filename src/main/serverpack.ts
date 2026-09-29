// 서버 팩: 모드팩 제작자가 서버용으로 따로 묶어 준 zip (mods·config 등이 다 들어 있다).
// 버전 정보 파일이 따로 없는 경우가 많아서, 안에 든 파일을 보고 마인크래프트 버전·로더를 알아낸다.
import fs from 'fs'
import path from 'path'
import type { Software } from '../shared-types'
import { readEntries } from './clientjar'
import { getLoaderVersions } from './loaders'

export interface ServerPackInfo {
  root: string // mods 폴더가 들어 있는 폴더
  mcVersion: string
  software: Software
  loaderVersion: string
  modCount: number
}

const MC = /^1\.\d{1,2}(\.\d{1,2})?$|^\d{2}\.\d{1,2}(\.\d{1,2})?$/ // 1.21.1 / 26.3

// mods 폴더가 들어 있는 가장 얕은 폴더 (zip 안에 "모드팩 이름/mods"처럼 한 겹 더 있는 경우가 많다)
export function findPackRoot(dir: string, depth = 0): string | null {
  if (fs.existsSync(path.join(dir, 'mods')) && fs.statSync(path.join(dir, 'mods')).isDirectory()) return dir
  if (depth >= 3) return null
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === '__MACOSX') continue
    const found = findPackRoot(path.join(dir, e.name), depth + 1)
    if (found) return found
  }
  return null
}

const jarsIn = (dir: string): string[] => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.jar$/i.test(f)) : [])

// NeoForge 버전 → 마인크래프트 버전 (21.1.x → 1.21.1, 26.3.x → 26.3)
function mcOfNeoforge(v: string): string | null {
  const [a, b] = v.split('.')
  if (!a || !b) return null
  if (Number(a) >= 25) return `${a}.${b}`
  return b === '0' ? `1.${a}` : `1.${a}.${b}`
}

// 1) 서버 팩을 만든 도구가 남긴 정보, 2) 로더 파일 이름·경로에서 찾는다 (가장 정확)
function fromFiles(root: string): Partial<ServerPackInfo> {
  // ServerPackCreator: variables.txt
  const vars = path.join(root, 'variables.txt')
  if (fs.existsSync(vars)) {
    const t = fs.readFileSync(vars, 'utf8')
    const get = (k: string): string | undefined => new RegExp(`^${k}=["']?([^"'\\r\\n]+)`, 'm').exec(t)?.[1]?.trim()
    const loader = get('MODLOADER')?.toLowerCase()
    const mc = get('MINECRAFT_VERSION')
    const lv = get('MODLOADER_VERSION')
    if (mc && lv && loader && ['forge', 'neoforge', 'fabric', 'quilt'].includes(loader)) return { mcVersion: mc, software: loader as Software, loaderVersion: lv }
  }
  // 로더가 설치된 흔적 (libraries 폴더)
  const neo = path.join(root, 'libraries/net/neoforged/neoforge')
  if (fs.existsSync(neo)) {
    const v = fs.readdirSync(neo).sort().pop()
    const mc = v && mcOfNeoforge(v)
    if (v && mc) return { mcVersion: mc, software: 'neoforge', loaderVersion: v }
  }
  const forge = path.join(root, 'libraries/net/minecraftforge/forge')
  if (fs.existsSync(forge)) {
    const m = /^([\d.]+)-([\d.]+)/.exec(fs.readdirSync(forge).sort().pop() ?? '')
    if (m) return { mcVersion: m[1], software: 'forge', loaderVersion: m[2] }
  }
  // 로더 설치 프로그램·실행 파일 이름
  for (const f of jarsIn(root)) {
    let m = /^neoforge-([\d.]+(?:-beta)?)-installer\.jar$/i.exec(f)
    if (m && mcOfNeoforge(m[1])) return { mcVersion: mcOfNeoforge(m[1])!, software: 'neoforge', loaderVersion: m[1] }
    m = /^forge-([\d.]+)-([\d.]+)(?:-installer|-universal)?\.jar$/i.exec(f)
    if (m) return { mcVersion: m[1], software: 'forge', loaderVersion: m[2] }
    m = /^fabric-server-mc\.([\d.]+)-loader\.([\d.]+)-launcher\.[\d.]+\.jar$/i.exec(f)
    if (m) return { mcVersion: m[1], software: 'fabric', loaderVersion: m[2] }
  }
  return {}
}

// 3) 그래도 모르면 모드 파일들을 보고 짐작한다: 어느 로더용 모드가 많은지 + 파일 이름에 적힌 마인크래프트 버전
async function fromMods(root: string): Promise<Partial<ServerPackInfo>> {
  const dir = path.join(root, 'mods')
  const loaders = new Map<Software, number>()
  const versions = new Map<string, number>()
  for (const f of jarsIn(dir).slice(0, 80)) {
    const e = await readEntries(path.join(dir, f), (n) => ['fabric.mod.json', 'quilt.mod.json', 'META-INF/neoforge.mods.toml', 'META-INF/mods.toml', 'mcmod.info'].includes(n))
    const kind: Software | null = e.has('quilt.mod.json') ? 'quilt' : e.has('fabric.mod.json') ? 'fabric' : e.has('META-INF/neoforge.mods.toml') ? 'neoforge' : e.has('META-INF/mods.toml') || e.has('mcmod.info') ? 'forge' : null
    if (kind) loaders.set(kind, (loaders.get(kind) ?? 0) + 1)
    // 예: lithium-fabric-0.15.4+mc1.21.1.jar, jei-1.21.1-fabric-19.8.jar, fabric-api-0.116.17+1.21.1.jar
    for (const m of f.matchAll(/(?:mc|[+_-])(1\.\d{1,2}(?:\.\d{1,2})?)(?=[+_.-])/gi)) if (MC.test(m[1])) versions.set(m[1], (versions.get(m[1]) ?? 0) + 1)
  }
  const top = <T>(m: Map<T, number>): T | undefined => [...m].sort((a, b) => b[1] - a[1])[0]?.[0]
  return { software: top(loaders), mcVersion: top(versions) }
}

// 서버 팩 폴더(압축 푼 곳)를 보고 서버를 만들 정보를 모은다. 알 수 없으면 오류
export async function describeServerPack(unpacked: string): Promise<ServerPackInfo> {
  const root = findPackRoot(unpacked)
  if (!root) throw new Error('서버 팩이 아니에요. (mods 폴더가 없어요)')
  let info = fromFiles(root)
  if (!info.mcVersion || !info.software) info = { ...(await fromMods(root)), ...info }
  if (!info.software || !info.mcVersion) throw new Error('서버 팩의 마인크래프트 버전이나 로더(Forge·Fabric 등)를 알아내지 못했어요.')
  if (!info.loaderVersion) {
    // 로더 버전을 모르면 그 마인크래프트 버전에 맞는 최신 안정 버전을 쓴다
    const list = info.software === 'vanilla' ? [] : await getLoaderVersions(info.software, info.mcVersion)
    info.loaderVersion = (list.find((v) => v.stable) ?? list[0])?.version
    if (!info.loaderVersion) throw new Error(`${info.mcVersion}에 맞는 ${info.software} 버전을 찾지 못했어요.`)
  }
  return { root, mcVersion: info.mcVersion, software: info.software, loaderVersion: info.loaderVersion, modCount: jarsIn(path.join(root, 'mods')).length }
}
