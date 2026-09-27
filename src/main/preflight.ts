// 서버를 켜기 전 점검: 켜 보고 튕긴 다음에 아는 것보다 미리 알려 준다
// - 켜진 모드가 필요로 하는데 없는 모드 (jar 안의 정보 파일로 본다. 버전 범위는 보지 않고 있는지만 본다)
// - 서버에 준 메모리가 지금 컴퓨터에 남은 메모리보다 많은지
// - 서버에 맞지 않아 보이는 모드가 새로 생겼는지 (있으면 끌지 묻는다)
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { PreflightResult } from '../shared-types'
import { readEntries } from './clientjar'
import { scanForOff } from './mods'
import { readServerInfo } from './servers'

const MODDED = ['fabric', 'quilt', 'forge', 'neoforge']
// 로더·게임이 직접 주는 것이라 모드 파일로는 없는 ID
const BUILT_IN = new Set(['minecraft', 'java', 'fabricloader', 'fabric-loader', 'quilt_loader', 'quilt_base', 'mixinextras', 'forge', 'neoforge', 'fml', 'javafml'])

interface ModMeta {
  name: string
  provides: string[] // 이 jar가 주는 모드 ID (안에 든 jar 포함)
  needs: string[] // 꼭 있어야 하는 모드 ID
}

function fromFabric(text: string): Omit<ModMeta, 'name'> & { name?: string } {
  const j = JSON.parse(text)
  const q = j.quilt_loader
  if (q) {
    const deps = (Array.isArray(q.depends) ? q.depends : []).flatMap((d: unknown) =>
      typeof d === 'string' ? [d] : d && typeof d === 'object' && !(d as { optional?: boolean }).optional && typeof (d as { id?: string }).id === 'string' ? [(d as { id: string }).id] : []
    )
    const provides = (Array.isArray(q.provides) ? q.provides : []).map((p: unknown) => (typeof p === 'string' ? p : (p as { id?: string })?.id)).filter(Boolean)
    return { name: q.metadata?.name, provides: [q.id, ...provides].filter(Boolean), needs: deps.map((d: string) => d.split(':').pop()!) }
  }
  return { name: j.name, provides: [j.id, ...(Array.isArray(j.provides) ? j.provides : [])].filter(Boolean), needs: Object.keys(j.depends ?? {}) }
}

function fromToml(text: string): Omit<ModMeta, 'name'> & { name?: string } {
  const provides = [...text.matchAll(/\[\[mods\]\][^[]*?modId\s*=\s*"([^"]+)"/g)].map((m) => m[1])
  const name = text.match(/\[\[mods\]\][^[]*?displayName\s*=\s*"([^"]+)"/)?.[1]
  const needs: string[] = []
  // [[dependencies.xxx]] 블록마다: mandatory=true(옛 방식) 또는 type="required"(새 방식)
  for (const block of text.split(/\[\[dependencies\.[^\]]+\]\]/).slice(1)) {
    const body = block.split(/\n\s*\[/)[0]
    const id = body.match(/modId\s*=\s*"([^"]+)"/)?.[1]
    const required = /mandatory\s*=\s*true/.test(body) || /type\s*=\s*"required"/i.test(body)
    const clientOnly = /side\s*=\s*"CLIENT"/i.test(body)
    if (id && required && !clientOnly) needs.push(id)
  }
  return { name, provides, needs }
}

// jar 하나(와 안에 든 jar들)의 정보
async function readMod(jar: string | Buffer, depth = 0): Promise<ModMeta | null> {
  const files = await readEntries(jar, (n) =>
    ['fabric.mod.json', 'quilt.mod.json', 'META-INF/mods.toml', 'META-INF/neoforge.mods.toml'].includes(n) || (depth < 2 && /^META-INF\/(jars|jarjar)\/[^/]+\.jar$/i.test(n))
  )
  let meta: (Omit<ModMeta, 'name'> & { name?: string }) | null = null
  try {
    const q = files.get('quilt.mod.json')
    const f = files.get('fabric.mod.json')
    const t = files.get('META-INF/neoforge.mods.toml') ?? files.get('META-INF/mods.toml')
    if (q) meta = fromFabric(q.toString('utf8'))
    else if (f) meta = fromFabric(f.toString('utf8'))
    else if (t) meta = fromToml(t.toString('utf8'))
  } catch {
    meta = null // 주석이 들어 있는 등 읽을 수 없는 정보 파일
  }
  if (!meta) return null
  const provides = [...meta.provides]
  for (const [name, buf] of files) {
    if (!/\.jar$/i.test(name)) continue
    const inner = await readMod(buf, depth + 1).catch(() => null)
    if (inner) provides.push(...inner.provides)
  }
  return { name: meta.name || (typeof jar === 'string' ? path.basename(jar) : '?'), provides, needs: meta.needs }
}

// 파일 크기·수정 시각이 같으면 다시 열지 않는다 (서버를 켤 때마다 모드 수십 개를 여는 게 느려서)
const metaCache = new Map<string, { key: string; meta: ModMeta | null }>()
async function readModCached(file: string): Promise<ModMeta | null> {
  const st = fs.statSync(file)
  const key = `${st.size}:${st.mtimeMs}`
  const hit = metaCache.get(file.replace(/\.disabled$/i, ''))
  if (hit?.key === key) return hit.meta
  const meta = await readMod(file).catch(() => null)
  metaCache.set(file.replace(/\.disabled$/i, ''), { key, meta })
  return meta
}

async function findMissing(folderPath: string): Promise<PreflightResult['missing']> {
  const dir = path.join(folderPath, 'mods')
  if (!fs.existsSync(dir)) return []
  const files = fs.readdirSync(dir).filter((f) => /\.jar(\.disabled)?$/i.test(f))
  const on: ModMeta[] = []
  const have = new Set<string>()
  const off = new Set<string>() // 꺼 둔 모드가 주는 ID
  for (const f of files) {
    const m = await readModCached(path.join(dir, f)).catch(() => null)
    if (!m) continue
    if (/\.disabled$/i.test(f)) m.provides.forEach((id) => off.add(id))
    else {
      on.push(m)
      m.provides.forEach((id) => have.add(id))
    }
  }
  const out: PreflightResult['missing'] = []
  for (const m of on) {
    const needs = [...new Set(m.needs)].filter((id) => !BUILT_IN.has(id) && !have.has(id)).map((id) => (off.has(id) ? `${id} (꺼져 있음)` : id))
    if (needs.length) out.push({ mod: m.name, needs })
  }
  return out
}

// 자바는 준 메모리를 처음부터 다 쓰지 않아서, 정말 모자랄 때만 알린다
function memoryWarning(memoryMb: number | undefined): string | null {
  const gb = (mb: number): string => (mb / 1024).toFixed(1)
  const totalMb = Math.floor(os.totalmem() / 1024 / 1024)
  const freeMb = Math.floor(os.freemem() / 1024 / 1024)
  if (memoryMb && memoryMb > totalMb - 1536)
    return `서버에 ${gb(memoryMb)}GB를 주도록 돼 있는데, 컴퓨터 전체 메모리가 ${gb(totalMb)}GB라 윈도우가 쓸 자리가 모자라요. 설정에서 메모리를 줄여 주세요.`
  if (freeMb < 1024) return `지금 컴퓨터에 남은 메모리가 ${gb(freeMb)}GB뿐이에요. 다른 프로그램(게임, 브라우저 등)을 닫으면 서버가 더 잘 돌아가요.`
  return null
}

export async function runPreflight(folderPath: string): Promise<PreflightResult> {
  const info = readServerInfo(folderPath)
  const modded = MODDED.includes(info.software ?? 'vanilla')
  return {
    missing: modded ? await findMissing(folderPath).catch(() => []) : [],
    memory: memoryWarning(info.memoryMb),
    askOff: modded ? await scanForOff(folderPath).catch(() => false) : false
  }
}
