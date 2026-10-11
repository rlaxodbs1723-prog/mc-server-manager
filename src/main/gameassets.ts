// 게임 그림·이름: 아이템을 게임과 똑같이 보여 주기 위해 Mojang 공식 게임 파일(클라이언트 jar)과 서버의 모드 파일 안에 든
// 아이템 그림, 모델, 번역을 읽는다. 그림을 새로 그리지 않고, 파일 안의 진짜 그림을 그대로 쓴다.
// 게임 파일은 버전마다 한 번(약 30MB) 받아서 userData/game-assets 에 둔다.
import { app, nativeImage } from 'electron'
import fs from 'fs'
import path from 'path'
import yauzl from 'yauzl'
import type { ItemIcon, ModelBox } from '../shared-types'
import { downloadFile, fetchJson } from './download'
import { getVersionMeta } from './mojang'
import { getAppSettings } from './appsettings'

const RESOURCES = 'https://resources.download.minecraft.net'
const dir = (): string => path.join(app.getPath('userData'), 'game-assets')

// ---------- jar 읽기: 파일 목록만 먼저 읽고, 필요한 파일만 꺼낸다 ----------
interface Jar {
  names: Set<string>
  read: (name: string) => Promise<Buffer | null>
}

function openJar(file: string): Promise<Jar> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, decodeStrings: true, autoClose: false }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('jar를 열지 못했어요.'))
      const entries = new Map<string, yauzl.Entry>()
      zip.on('error', reject)
      zip.on('entry', (e: yauzl.Entry) => {
        if (e.fileName.startsWith('assets/')) entries.set(e.fileName, e)
        zip.readEntry()
      })
      zip.on('end', () =>
        resolve({
          names: new Set(entries.keys()),
          read: (name) =>
            new Promise((res) => {
              const e = entries.get(name)
              if (!e) return res(null)
              zip.openReadStream(e, (er, s) => {
                if (er || !s) return res(null)
                const parts: Buffer[] = []
                s.on('data', (c: Buffer) => parts.push(c))
                s.on('end', () => res(Buffer.concat(parts)))
                s.on('error', () => res(null))
              })
            })
        })
      )
      zip.readEntry()
    })
  })
}

// 같은 파일은 한 번만 연다 (바뀌면 다시)
const jarCache = new Map<string, { mtime: number; jar: Promise<Jar> }>()
function jarOf(file: string): Promise<Jar> {
  const mtime = fs.statSync(file).mtimeMs
  const hit = jarCache.get(file)
  if (hit && hit.mtime === mtime) return hit.jar
  const jar = openJar(file)
  jarCache.set(file, { mtime, jar })
  jar.catch(() => jarCache.delete(file))
  return jar
}

// ---------- 게임 파일 받기 ----------
interface ClientMeta {
  downloads: { client?: { url: string; sha1: string } }
  assetIndex?: { id: string; url: string }
}

const clientJars = new Map<string, Promise<string>>()
export function clientJar(mcVersion: string): Promise<string> {
  if (!clientJars.has(mcVersion)) {
    const p = (async () => {
      const dest = path.join(dir(), `${mcVersion}.jar`)
      if (fs.existsSync(dest)) return dest
      const meta = (await getVersionMeta(mcVersion)) as unknown as ClientMeta
      if (!meta.downloads.client) throw new Error('이 버전은 게임 파일이 없어요.')
      await downloadFile({ url: meta.downloads.client.url, dest, sha1: meta.downloads.client.sha1 })
      return dest
    })()
    clientJars.set(mcVersion, p)
    p.catch(() => clientJars.delete(mcVersion))
  }
  return clientJars.get(mcVersion)!
}

// ---------- 번역 ----------
const GAME_LANG = { ko: 'ko_kr', en: 'en_us', zh: 'zh_cn' } as const
const langCache = new Map<string, Promise<Record<string, string>>>()

// 게임 전체 번역 (앱 언어). 영어 원문은 게임 파일 안에 있다
export function gameLang(mcVersion: string, lang: string = GAME_LANG[getAppSettings().language] ?? 'ko_kr'): Promise<Record<string, string>> {
  const key = `${mcVersion}/${lang}`
  if (!langCache.has(key)) {
    const p = (async () => {
      if (lang === 'en_us') {
        const jar = await jarOf(await clientJar(mcVersion))
        const buf = await jar.read('assets/minecraft/lang/en_us.json')
        return buf ? JSON.parse(buf.toString('utf8')) : {}
      }
      const meta = (await getVersionMeta(mcVersion)) as unknown as ClientMeta
      if (!meta.assetIndex) return {}
      const file = path.join(dir(), `lang-${meta.assetIndex.id}-${lang}.json`)
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8'))
      } catch {
        // 아직 받지 않았다
      }
      const index = await fetchJson<{ objects: Record<string, { hash: string }> }>(meta.assetIndex.url)
      const obj = index.objects[`minecraft/lang/${lang}.json`]
      if (!obj) return {}
      const all = await fetchJson<Record<string, string>>(`${RESOURCES}/${obj.hash.slice(0, 2)}/${obj.hash}`)
      fs.mkdirSync(dir(), { recursive: true })
      fs.writeFileSync(file, JSON.stringify(all))
      return all
    })()
    langCache.set(key, p)
    p.catch(() => langCache.delete(key))
  }
  return langCache.get(key)!
}

// ---------- 서버의 그림 출처: 게임 파일 + 모드 파일들 ----------
async function sources(folderPath: string, mcVersion: string): Promise<Jar[]> {
  const jars: Jar[] = []
  const modsDir = path.join(folderPath, 'mods')
  try {
    for (const f of fs.readdirSync(modsDir)) if (f.endsWith('.jar')) jars.push(await jarOf(path.join(modsDir, f)).catch(() => null as never))
  } catch {
    // 모드 폴더 없음
  }
  // 모드가 바닐라 그림을 바꾸는 경우는 드물어서 게임 파일을 맨 뒤에 둔다 (모드 아이템은 모드 파일에서 찾는다)
  jars.push(await jarOf(await clientJar(mcVersion)))
  return jars.filter(Boolean)
}

async function readAsset(jars: Jar[], name: string): Promise<Buffer | null> {
  for (const j of jars) if (j.names.has(name)) return j.read(name)
  return null
}
async function readJson<T>(jars: Jar[], name: string): Promise<T | null> {
  const buf = await readAsset(jars, name)
  if (!buf) return null
  try {
    return JSON.parse(buf.toString('utf8').replace(/^﻿/, ''))
  } catch {
    return null
  }
}

// "minecraft:item/apple", "item/apple" -> [네임스페이스, 경로]
const splitRef = (ref: string, ns = 'minecraft'): [string, string] => {
  const i = ref.indexOf(':')
  return i < 0 ? [ns, ref] : [ref.slice(0, i), ref.slice(i + 1)]
}

interface Model {
  parent?: string
  textures?: Record<string, string | { sprite: string }>
  elements?: { from: number[]; to: number[]; faces?: Record<string, { texture: string; uv?: number[]; tintindex?: number }> }[]
  display?: { gui?: { rotation?: number[] } }
}

// 부모를 따라가며 그림 변수와 모양(elements)을 모은다
async function loadModel(
  jars: Jar[],
  ref: string
): Promise<{ textures: Record<string, string>; elements?: Model['elements']; parents: string[]; guiY?: number }> {
  const textures: Record<string, string> = {}
  const parents: string[] = []
  let elements: Model['elements']
  let guiY: number | undefined // 인벤토리에서 보이는 방향 (가로 회전)
  let cur: string | undefined = ref
  for (let depth = 0; cur && depth < 16; depth++) {
    const [ns, p] = splitRef(cur)
    parents.push(`${ns}:${p}`)
    if (p.startsWith('builtin/')) break
    const m: Model | null = await readJson<Model>(jars, `assets/${ns}/models/${p}.json`)
    if (!m) break
    // 새 버전은 그림을 {sprite: ...} 로 적기도 한다
    for (const [k, v] of Object.entries(m.textures ?? {})) if (!(k in textures)) textures[k] = typeof v === 'string' ? v : v?.sprite
    if (!elements && m.elements) elements = m.elements
    if (guiY == null && m.display?.gui?.rotation) guiY = m.display.gui.rotation[1]
    cur = m.parent
  }
  return { textures, elements, parents, guiY }
}

const resolveVar = (textures: Record<string, string>, v: string | undefined): string | undefined => {
  for (let i = 0; v?.startsWith('#') && i < 10; i++) v = textures[v.slice(1)]
  return v?.startsWith('#') ? undefined : v
}

// 그림 파일 -> data URL. 움직이는 그림(세로로 긴 그림)은 첫 장면만, 풀색처럼 회색 그림은 기본 풀색을 입힌다
const GRASS = [0x7c, 0xbd, 0x6b]
async function textureUrl(jars: Jar[], ref: string | undefined, tint = false): Promise<string | undefined> {
  if (!ref) return undefined
  const [ns, p] = splitRef(ref)
  const buf = await readAsset(jars, `assets/${ns}/textures/${p}.png`)
  if (!buf) return undefined
  let img = nativeImage.createFromBuffer(buf)
  if (img.isEmpty()) return undefined
  const { width, height } = img.getSize()
  if (height > width) img = img.crop({ x: 0, y: 0, width, height: width })
  if (tint) {
    const size = img.getSize()
    const bmp = Buffer.from(img.toBitmap()) // BGRA
    for (let i = 0; i < bmp.length; i += 4) {
      bmp[i] = (bmp[i] * GRASS[2]) / 255
      bmp[i + 1] = (bmp[i + 1] * GRASS[1]) / 255
      bmp[i + 2] = (bmp[i + 2] * GRASS[0]) / 255
    }
    img = nativeImage.createFromBitmap(bmp, size)
  }
  return img.toDataURL()
}

// 1.21.4부터 생긴 items/<이름>.json: 조건별 모델 중 기본 모델을 고른다
function pickItemModel(def: unknown): { model?: string; special: boolean } {
  const m = def as Record<string, unknown> | undefined
  if (!m || typeof m !== 'object') return { special: false }
  const type = String(m.type ?? '').replace(/^minecraft:/, '')
  if (type === 'model') return { model: String(m.model), special: false }
  if (type === 'special') return { model: m.base ? String(m.base) : undefined, special: true }
  if (type === 'composite') return pickItemModel((m.models as unknown[])?.[0])
  if (type === 'condition') return pickItemModel(m.on_false)
  if (type === 'select') return pickItemModel(m.fallback ?? (m.cases as { model: unknown }[])?.[0]?.model)
  if (type === 'range_dispatch') return pickItemModel(m.fallback ?? (m.entries as { model: unknown }[])?.[0]?.model)
  if (type === 'bundle/selected_item') return { special: false }
  return { special: false }
}

const CHESTS: Record<string, string> = {
  'minecraft:chest': 'minecraft:entity/chest/normal',
  'minecraft:trapped_chest': 'minecraft:entity/chest/trapped',
  'minecraft:ender_chest': 'minecraft:entity/chest/ender'
}

// 상자 그림(64x64)에서 윗면, 앞면(뚜껑+몸통), 옆면을 잘라 붙인다
async function chestIcon(jars: Jar[], ref: string): Promise<ItemIcon | null> {
  const [ns, p] = splitRef(ref)
  const buf = await readAsset(jars, `assets/${ns}/textures/${p}.png`)
  if (!buf) return null
  const img = nativeImage.createFromBuffer(buf)
  const k = img.getSize().width / 64
  if (!k) return null
  const crop = (x: number, y: number, w: number, h: number) => img.crop({ x: x * k, y: y * k, width: w * k, height: h * k })
  // 위아래로 붙이기 (뚜껑 5칸 + 몸통 10칸)
  const stack = (a: Electron.NativeImage, b: Electron.NativeImage) => {
    const w = a.getSize().width
    const out = Buffer.concat([Buffer.from(a.toBitmap()), Buffer.from(b.toBitmap())])
    return nativeImage.createFromBitmap(out, { width: w, height: a.getSize().height + b.getSize().height }).toDataURL()
  }
  // 상자 모양(1~15칸, 높이 14) 하나로 그린다
  const side = stack(crop(0, 14, 14, 5), crop(0, 33, 14, 10))
  const tex = { top: crop(14, 0, 14, 14).toDataURL(), front: stack(crop(14, 14, 14, 5), crop(14, 33, 14, 10)), side }
  const full = [0, 0, 16, 16]
  return {
    kind: 'model',
    textures: tex,
    rotY: 225,
    boxes: [
      {
        from: [1, 0, 1],
        to: [15, 14, 15],
        faces: { up: { tex: 'top', uv: full }, north: { tex: 'front', uv: full }, east: { tex: 'side', uv: full }, south: { tex: 'side', uv: full }, west: { tex: 'side', uv: full } }
      }
    ]
  }
}

// 머리 아이템: 게임이 코드로 그려서 모델이 없다. 몹 텍스처의 머리 부분(상자 펼친 그림)을 잘라 상자로 만든다
// [텍스처, 텍스처 기준 너비, 머리 상자의 그림 위치 u, v, 크기 w, h, d]
const HEADS: Record<string, [string, number, number, number, number, number, number]> = {
  'minecraft:skeleton_skull': ['minecraft:entity/skeleton/skeleton', 64, 0, 0, 8, 8, 8],
  'minecraft:wither_skeleton_skull': ['minecraft:entity/skeleton/wither_skeleton', 64, 0, 0, 8, 8, 8],
  'minecraft:zombie_head': ['minecraft:entity/zombie/zombie', 64, 0, 0, 8, 8, 8],
  'minecraft:creeper_head': ['minecraft:entity/creeper/creeper', 64, 0, 0, 8, 8, 8],
  'minecraft:piglin_head': ['minecraft:entity/piglin/piglin', 64, 0, 0, 10, 8, 8],
  'minecraft:player_head': ['minecraft:entity/player/wide/steve', 64, 0, 0, 8, 8, 8],
  'minecraft:dragon_head': ['minecraft:entity/enderdragon/dragon', 256, 112, 30, 16, 16, 16]
}

async function headIcon(jars: Jar[], id: string): Promise<ItemIcon | null> {
  const h = HEADS[id]
  if (!h) return null
  const [ref, base, u, v, w, hh, d] = h
  const [ns, p] = splitRef(ref)
  let buf = await readAsset(jars, `assets/${ns}/textures/${p}.png`)
  if (!buf && id === 'minecraft:player_head') buf = await readAsset(jars, 'assets/minecraft/textures/entity/steve.png') // 예전 버전 위치
  if (!buf) return null
  const img = nativeImage.createFromBuffer(buf)
  const k = img.getSize().width / base
  if (!k) return null
  const crop = (x: number, y: number, cw: number, ch: number) => img.crop({ x: x * k, y: y * k, width: cw * k, height: ch * k }).toDataURL()
  // 펼친 상자 그림: 위(u+d, v), 앞(u+d, v+d), 오른쪽(u, v+d), 왼쪽(u+d+w, v+d), 뒤(u+2d+w, v+d)
  const tex = {
    top: crop(u + d, v, w, d),
    front: crop(u + d, v + d, w, hh),
    right: crop(u, v + d, d, hh),
    left: crop(u + d + w, v + d, d, hh),
    back: crop(u + 2 * d + w, v + d, w, hh)
  }
  const full = [0, 0, 16, 16]
  // 게임 인벤토리처럼 얼굴이 왼쪽 앞을 보게 둔다
  return {
    kind: 'model',
    textures: tex,
    rotY: 225,
    boxes: [
      {
        from: [2, 0, 2], // 인벤토리의 머리는 블록보다 조금 작다
        to: [14, 12, 14],
        faces: {
          up: { tex: 'top', uv: full },
          east: { tex: 'front', uv: full },
          north: { tex: 'left', uv: full },
          south: { tex: 'right', uv: full },
          west: { tex: 'back', uv: full }
        }
      }
    ]
  }
}

async function itemIcon(jars: Jar[], id: string): Promise<ItemIcon | null> {
  const [ns, name] = splitRef(id)
  const def = await readJson<{ model?: unknown }>(jars, `assets/${ns}/items/${name}.json`)
  const picked = def ? pickItemModel(def.model) : { model: `${ns}:item/${name}`, special: false }
  if (!picked.model) return null
  const { textures, elements, parents, guiY } = await loadModel(jars, splitRef(picked.model, ns).join(':'))
  const flat = async (): Promise<ItemIcon | null> => {
    const layers: string[] = []
    for (let i = 0; i < 5; i++) {
      const u = await textureUrl(jars, resolveVar(textures, `#layer${i}`))
      if (u) layers.push(u)
      else if (i > 0) break
    }
    if (!layers.length) {
      const u = await textureUrl(jars, resolveVar(textures, '#particle'))
      if (u) layers.push(u)
    }
    return layers.length ? { kind: 'flat', layers } : null
  }
  // 손에 드는 평평한 아이템
  if (textures.layer0 || parents.some((p) => /builtin\/generated$/.test(p))) return flat()
  // 상자는 게임이 코드로 그려서 모델이 없다. 상자 그림에서 뚜껑과 몸통을 잘라 입체로 만든다
  const chest = CHESTS[`${ns}:${name}`]
  if (chest) {
    const c = await chestIcon(jars, chest)
    if (c) return c
  }
  if (HEADS[`${ns}:${name}`]) {
    const hd = await headIcon(jars, `${ns}:${name}`)
    if (hd) return hd
  }
  // 방패·머리처럼 코드로 그리는 나머지는 대표 그림이 엉뚱해서 그림 없이 둔다
  if (picked.special || parents.some((p) => /builtin\/entity$/.test(p))) return null
  if (!elements?.length) return flat()
  // 블록: 모델의 상자들(계단은 2개, 버튼은 작은 1개 등)을 크기 그대로 입체로. 그림은 같은 것끼리 한 번만 보낸다
  const texMap: Record<string, string> = {}
  const boxes: ModelBox[] = []
  for (const el of elements.slice(0, 40)) {
    const faces: ModelBox['faces'] = {}
    for (const [dir, f] of Object.entries(el.faces ?? {})) {
      const ref = resolveVar(textures, f.texture)
      if (!ref) continue
      const key = `${ref}${f.tintindex != null ? '#tint' : ''}`
      if (!(key in texMap)) {
        const url = await textureUrl(jars, ref, f.tintindex != null)
        if (!url) continue
        texMap[key] = url
      }
      faces[dir as keyof ModelBox['faces']] = { tex: key, uv: f.uv }
    }
    if (Object.keys(faces).length) boxes.push({ from: el.from, to: el.to, faces })
  }
  if (!boxes.length) return flat()
  return { kind: 'model', textures: texMap, boxes, rotY: guiY ?? 225 }
}

// 여러 아이템의 그림과 이름을 한 번에. 못 찾은 것은 그림 없이 이름만
const iconCache = new Map<string, ItemIcon | null>()
export async function getItemIcons(folderPath: string, mcVersion: string, ids: string[]): Promise<Record<string, ItemIcon | null>> {
  const jars = await sources(folderPath, mcVersion)
  const out: Record<string, ItemIcon | null> = {}
  for (const id of [...new Set(ids)]) {
    const key = `${folderPath}|${mcVersion}|${id}`
    if (!iconCache.has(key)) iconCache.set(key, await itemIcon(jars, id).catch(() => null))
    out[id] = iconCache.get(key)!
  }
  return out
}

// 아이템·인챈트 이름 번역 (게임 + 모드). 없으면 영어, 그것도 없으면 id
export async function getItemLang(folderPath: string, mcVersion: string, namespaces: string[]): Promise<Record<string, string>> {
  const lang = GAME_LANG[getAppSettings().language] ?? 'ko_kr'
  const out: Record<string, string> = {}
  const base = await gameLang(mcVersion).catch(() => ({}) as Record<string, string>)
  const en = await gameLang(mcVersion, 'en_us').catch(() => ({}) as Record<string, string>)
  Object.assign(out, en, base)
  const jars = await sources(folderPath, mcVersion).catch(() => [] as Jar[])
  for (const ns of new Set(namespaces)) {
    if (ns === 'minecraft') continue
    const mEn = await readJson<Record<string, string>>(jars, `assets/${ns}/lang/en_us.json`)
    const mLang = lang === 'en_us' ? null : await readJson<Record<string, string>>(jars, `assets/${ns}/lang/${lang}.json`)
    Object.assign(out, mEn ?? {}, mLang ?? {})
  }
  return out
}

// 게임 글꼴의 숫자 0~9 (아이템 개수를 게임과 똑같이 그리기 위해). 8x8 칸 10개를 가로로 붙인 그림
const digitCache = new Map<string, Promise<string | null>>()
export function digitFont(mcVersion: string): Promise<string | null> {
  if (!digitCache.has(mcVersion)) {
    const p = (async () => {
      const jar = await jarOf(await clientJar(mcVersion))
      const buf = await jar.read('assets/minecraft/textures/font/ascii.png')
      if (!buf) return null
      const img = nativeImage.createFromBuffer(buf)
      const k = img.getSize().width / 128
      return img.crop({ x: 0, y: 24 * k, width: 80 * k, height: 8 * k }).toDataURL()
    })().catch(() => null)
    digitCache.set(mcVersion, p)
  }
  return digitCache.get(mcVersion)!
}
