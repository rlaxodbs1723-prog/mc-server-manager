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

// 그림 파일 -> data URL. 움직이는 그림(세로로 긴 그림)은 첫 장면만. 회색 그림(풀, 잎, 가죽 등)은 게임처럼 색을 입힌다
const rgb = (hex: number): number[] => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]
function tintImage(img: Electron.NativeImage, color: number): Electron.NativeImage {
  const [r, g, b] = rgb(color)
  const size = img.getSize()
  const bmp = Buffer.from(img.toBitmap()) // BGRA
  for (let i = 0; i < bmp.length; i += 4) {
    bmp[i] = (bmp[i] * b) / 255
    bmp[i + 1] = (bmp[i + 1] * g) / 255
    bmp[i + 2] = (bmp[i + 2] * r) / 255
  }
  return nativeImage.createFromBitmap(bmp, size)
}
async function textureUrl(jars: Jar[], ref: string | undefined, tint?: number): Promise<string | undefined> {
  if (!ref) return undefined
  const [ns, p] = splitRef(ref)
  const buf = await readAsset(jars, `assets/${ns}/textures/${p}.png`)
  if (!buf) return undefined
  let img = nativeImage.createFromBuffer(buf)
  if (img.isEmpty()) return undefined
  const { width, height } = img.getSize()
  if (height > width) img = img.crop({ x: 0, y: 0, width, height: width })
  if (tint != null) img = tintImage(img, tint)
  return img.toDataURL()
}

// 게임이 인벤토리에서 색을 입히는 아이템 (블록 모델의 tintindex 면, 평평한 아이템은 몇 번째 그림에)
// 벚나무·진달래·창백한 참나무 잎처럼 원래 색이 있는 것은 칠하지 않는다
const GRASS = 0x91bd59
const FOLIAGE = 0x48b518
const BLOCK_TINT: Record<string, number> = {
  grass_block: GRASS, short_grass: GRASS, tall_grass: GRASS, fern: GRASS, large_fern: GRASS,
  oak_leaves: FOLIAGE, jungle_leaves: FOLIAGE, acacia_leaves: FOLIAGE, dark_oak_leaves: FOLIAGE, vine: FOLIAGE,
  birch_leaves: 0x80a755, spruce_leaves: 0x619961, mangrove_leaves: 0x92c648, lily_pad: 0x208030
}
const LEATHER = 0xa06540
const WATER = 0x385dc6
// 아이템마다 색이 다른 것 (물약 종류, 염색)
const PER_ITEM_COLOR = new Set([
  'leather_helmet', 'leather_chestplate', 'leather_leggings', 'leather_boots', 'leather_horse_armor', 'potion', 'splash_potion', 'lingering_potion', 'tipped_arrow'
])
const FLAT_TINT: Record<string, [number, number]> = {
  short_grass: [0, GRASS], tall_grass: [0, GRASS], fern: [0, GRASS], large_fern: [0, GRASS], vine: [0, FOLIAGE], lily_pad: [0, 0x208030],
  leather_helmet: [0, LEATHER], leather_chestplate: [0, LEATHER], leather_leggings: [0, LEATHER], leather_boots: [0, LEATHER],
  leather_horse_armor: [0, LEATHER], potion: [0, WATER], splash_potion: [0, WATER], lingering_potion: [0, WATER], tipped_arrow: [0, WATER]
}

// 1.21.4부터 생긴 items/<이름>.json: 조건별 모델 중 인벤토리에서 보이는 기본 모델을 고른다
type Spec = Record<string, unknown>
function pickItemModel(def: unknown): { model?: string; special: boolean; spec?: Spec } {
  const m = def as Record<string, unknown> | undefined
  if (!m || typeof m !== 'object') return { special: false }
  const type = String(m.type ?? '').replace(/^minecraft:/, '')
  if (type === 'model') return { model: String(m.model), special: false }
  if (type === 'special') return { model: m.base ? String(m.base) : undefined, special: true, spec: m.model as Spec }
  if (type === 'composite') return pickItemModel((m.models as unknown[])?.[0])
  if (type === 'condition') return pickItemModel(m.on_false)
  if (type === 'select') {
    const cases = (m.cases as { when: unknown; model: unknown }[]) ?? []
    // 손에 들 때와 인벤토리에서 모양이 다른 아이템(삼지창 등)은 인벤토리(gui) 모양으로
    const gui = String(m.property ?? '').endsWith('display_context') ? cases.find((c) => [c.when].flat().includes('gui')) : undefined
    return pickItemModel(gui?.model ?? m.fallback ?? cases[0]?.model)
  }
  if (type === 'range_dispatch') return pickItemModel(m.fallback ?? (m.entries as { model: unknown }[])?.[0]?.model)
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

// 몹 텍스처의 "펼친 상자" 그림에서 상자 하나의 면들을 잘라 낸다 (u, v: 그림 위치, w: 너비, h: 높이, d: 깊이)
type Faces = { top: string; front: string; right: string; left: string; back: string }
async function entityImage(jars: Jar[], ref: string): Promise<Electron.NativeImage | null> {
  const [ns, p] = splitRef(ref)
  const buf = await readAsset(jars, `assets/${ns}/textures/${p}.png`)
  if (!buf) return null
  const img = nativeImage.createFromBuffer(buf)
  return img.isEmpty() ? null : img
}
function uvFaces(img: Electron.NativeImage, base: number, u: number, v: number, w: number, h: number, d: number, tint?: number): Faces {
  const k = img.getSize().width / base
  const crop = (x: number, y: number, cw: number, ch: number) => {
    const c = img.crop({ x: Math.round(x * k), y: Math.round(y * k), width: Math.max(1, Math.round(cw * k)), height: Math.max(1, Math.round(ch * k)) })
    return (tint != null ? tintImage(c, tint) : c).toDataURL()
  }
  return {
    top: crop(u + d, v, w, d),
    front: crop(u + d, v + d, w, h),
    right: crop(u, v + d, d, h),
    left: crop(u + d + w, v + d, d, h),
    back: crop(u + 2 * d + w, v + d, w, h)
  }
}
// 앞면이 왼쪽 앞(동쪽)을 보게 상자를 만든다 (게임 인벤토리의 머리·조각상 방향)
const FULL = [0, 0, 16, 16]
function faceBox(key: string, from: number[], to: number[]): ModelBox {
  return {
    from,
    to,
    faces: {
      up: { tex: `${key}top`, uv: FULL },
      east: { tex: `${key}front`, uv: FULL },
      north: { tex: `${key}left`, uv: FULL },
      south: { tex: `${key}right`, uv: FULL },
      west: { tex: `${key}back`, uv: FULL }
    }
  }
}
function boxesIcon(parts: [string, Faces, number[], number[]][]): ItemIcon {
  const textures: Record<string, string> = {}
  for (const [key, f] of parts) for (const [n, url] of Object.entries(f)) textures[`${key}${n}`] = url
  return { kind: 'model', textures, rotY: 225, boxes: parts.map(([key, , from, to]) => faceBox(key, from, to)) }
}

// 그림 일부를 정사각형 가운데에 놓은 평평한 아이콘 (배너·방패는 게임 인벤토리에서 앞모습으로 보인다)
function frontIcon(img: Electron.NativeImage, base: number, x: number, y: number, w: number, h: number, tint?: number): ItemIcon {
  const k = img.getSize().width / base
  let c = img.crop({ x: Math.round(x * k), y: Math.round(y * k), width: Math.round(w * k), height: Math.round(h * k) })
  if (tint != null) c = tintImage(c, tint)
  const cw = c.getSize().width
  const ch = c.getSize().height
  const n = Math.max(cw, ch)
  const out = Buffer.alloc(n * n * 4) // 투명 바탕
  const src = c.toBitmap()
  const ox = Math.floor((n - cw) / 2)
  const oy = Math.floor((n - ch) / 2)
  for (let row = 0; row < ch; row++) src.copy(out, ((oy + row) * n + ox) * 4, row * cw * 4, (row + 1) * cw * 4)
  return { kind: 'flat', layers: [nativeImage.createFromBitmap(out, { width: n, height: n }).toDataURL()] }
}

// 몹 모델처럼 여러 상자로 된 것 (드래곤 머리 등). 모델 좌표(y는 아래로, 앞은 -z)를 인벤토리 좌표로 바꾸고 16칸 안에 맞춘다
// [이름, x, y, z, 너비, 높이, 깊이, 그림 u, v]
type EntityBox = [string, number, number, number, number, number, number, number, number]
function entityModelIcon(img: Electron.NativeImage, base: number, parts: EntityBox[]): ItemIcon {
  // 앞(-z)이 왼쪽 앞(동쪽)을 보게: X = -z, Y = -y, Z = x
  const conv = parts.map(([key, x, y, z, w, h, d, u, v]) => ({ key, u, v, w, h, d, from: [-(z + d), -(y + h), x], to: [-z, -y, x + w] }))
  const lo = [0, 1, 2].map((i) => Math.min(...conv.map((c) => c.from[i])))
  const hi = [0, 1, 2].map((i) => Math.max(...conv.map((c) => c.to[i])))
  const scale = 16 / Math.max(...[0, 1, 2].map((i) => hi[i] - lo[i]))
  // 가로·앞뒤는 가운데에, 아래는 바닥에 맞춘다
  const off = [0, 1, 2].map((i) => (i === 1 ? 0 : (16 - (hi[i] - lo[i]) * scale) / 2))
  const fit = (p: number[]) => p.map((n, i) => (n - lo[i]) * scale + off[i])
  return boxesIcon(conv.map((c) => [c.key, uvFaces(img, base, c.u, c.v, c.w, c.h, c.d), fit(c.from), fit(c.to)] as [string, Faces, number[], number[]]))
}

// 염료 색 (배너)
const DYE: Record<string, number> = {
  white: 0xf9fffe, orange: 0xf9801d, magenta: 0xc74ebd, light_blue: 0x3ab3da, yellow: 0xfed83d, lime: 0x80c71f, pink: 0xf38baa, gray: 0x474f52,
  light_gray: 0x9d9d97, cyan: 0x169c9c, purple: 0x8932b8, blue: 0x3c44aa, brown: 0x835432, green: 0x5e7c16, red: 0xb02e26, black: 0x1d1d21
}

// 게임이 코드로 그리는 아이템(상자·머리·셜커 상자·배너·방패 등)을 게임 텍스처로 만든다. 모르는 것은 null
async function specialIcon(jars: Jar[], id: string, spec: Spec | undefined): Promise<ItemIcon | null> {
  const type = String(spec?.type ?? '').replace(/^minecraft:/, '')
  const texName = (v: unknown) => String(v ?? '').replace(/^minecraft:/, '').replace(/^textures\//, '').replace(/\.png$/, '')
  // 예전 버전(1.21.3까지)은 items/ 정의가 없어서 아이템 이름으로 고른다
  const name = id.replace(/^minecraft:/, '')
  if (type === 'chest' || CHESTS[id]) return chestIcon(jars, spec?.texture ? `minecraft:entity/chest/${texName(spec.texture)}` : CHESTS[id])
  if (type === 'head' || HEADS[id]) {
    const h = HEADS[id]
    if (!h) return null
    const [ref, base, u, v, w, hh, d] = h
    if (id === 'minecraft:dragon_head') {
      // 게임의 드래곤 머리 모양: 머리, 주둥이, 아래턱, 콧구멍 2개, 뿔 2개
      const dragon = await entityImage(jars, ref)
      if (!dragon) return null
      return entityModelIcon(dragon, 256, [
        ['a', -8, -8, -10, 16, 16, 16, 112, 30],
        ['b', -6, -1, -24, 12, 5, 16, 176, 44],
        ['c', -6, 4, -24, 12, 4, 16, 176, 65],
        ['d', -5, -3, -22, 2, 2, 4, 112, 0],
        ['e', 3, -3, -22, 2, 2, 4, 112, 0],
        ['f', -5, -12, -4, 2, 4, 6, 0, 0],
        ['g', 3, -12, -4, 2, 4, 6, 0, 0]
      ])
    }
    let img = await entityImage(jars, ref)
    if (!img && id === 'minecraft:player_head') img = await entityImage(jars, 'minecraft:entity/steve') // 예전 버전 위치
    if (!img) return null
    return boxesIcon([['h', uvFaces(img, base, u, v, w, hh, d), [2, 0, 2], [14, 12, 14]]])
  }
  if (type === 'shulker_box' || /shulker_box$/.test(name)) {
    const color = name.replace(/_?shulker_box$/, '')
    const img = await entityImage(jars, spec?.texture ? `minecraft:entity/shulker/${texName(spec.texture)}` : `minecraft:entity/shulker/shulker${color ? `_${color}` : ''}`)
    if (!img) return null
    // 몸통(아래 8칸)과 뚜껑(위 12칸)
    return boxesIcon([
      ['b', uvFaces(img, 64, 0, 28, 16, 8, 16), [0, 0, 0], [16, 8, 16]],
      ['l', uvFaces(img, 64, 0, 0, 16, 12, 16), [0, 4, 0], [16, 16, 16]]
    ])
  }
  if (type === 'banner' || /_banner$/.test(name)) {
    const color = String(spec?.color ?? name.replace(/_banner$/, ''))
    const img = (await entityImage(jars, 'minecraft:entity/banner/banner_base')) ?? (await entityImage(jars, 'minecraft:entity/banner_base'))
    if (!img) return null
    // 깃발 앞면(20x40)을 염료 색으로
    return frontIcon(img, 64, 1, 1, 20, 40, DYE[color] ?? 0xffffff)
  }
  if (type === 'shield' || name === 'shield') {
    const img = (await entityImage(jars, 'minecraft:entity/shield/shield_base_nopattern')) ?? (await entityImage(jars, 'minecraft:entity/shield_base_nopattern'))
    if (!img) return null
    return frontIcon(img, 64, 1, 1, 12, 22) // 방패 앞면
  }
  if (type === 'conduit' || name === 'conduit') {
    const img = await entityImage(jars, 'minecraft:entity/conduit/base')
    if (!img) return null
    return boxesIcon([['c', uvFaces(img, 32, 0, 0, 6, 6, 6), [3, 3, 3], [13, 13, 13]]])
  }
  if (type === 'decorated_pot' || name === 'decorated_pot') {
    const side = await entityImage(jars, 'minecraft:entity/decorated_pot/decorated_pot_side')
    const base = await entityImage(jars, 'minecraft:entity/decorated_pot/decorated_pot_base')
    if (!side || !base) return null
    const s = side.toDataURL()
    const top = uvFaces(base, 32, 0, 0, 14, 0, 14).top
    return boxesIcon([['p', { top, front: s, left: s, right: s, back: s }, [1, 0, 1], [15, 16, 15]]])
  }
  if (type === 'copper_golem_statue' || /copper_golem_statue$/.test(name)) {
    const stage = name.match(/(exposed|weathered|oxidized)/)?.[1]
    const img = spec?.texture
      ? await entityImage(jars, `minecraft:${texName(spec.texture)}`)
      : await entityImage(jars, `minecraft:entity/copper_golem/copper_golem${stage ? `_${stage}` : ''}`)
    if (!img) return null
    // 머리(8x5x10)와 몸통(8x6x6)
    return boxesIcon([
      ['b', uvFaces(img, 64, 0, 15, 8, 6, 6), [4.2, 0, 2.4], [12.6, 8.4, 13.6]],
      ['h', uvFaces(img, 64, 0, 0, 8, 5, 10), [1.4, 8.4, 2.4], [15.4, 15.4, 13.6]]
    ])
  }
  return null
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
      const t = ns === 'minecraft' ? FLAT_TINT[name] : undefined
      // 물약·가죽은 아이템마다 색이 달라서 회색 그대로 보내고 화면에서 칠한다
      const bake = t && t[0] === i && !PER_ITEM_COLOR.has(name)
      const u = await textureUrl(jars, resolveVar(textures, `#layer${i}`), bake ? t[1] : undefined)
      if (u) layers.push(u)
      else if (i > 0) break
    }
    if (!layers.length) {
      const u = await textureUrl(jars, resolveVar(textures, '#particle'))
      if (u) layers.push(u)
    }
    const t = ns === 'minecraft' && PER_ITEM_COLOR.has(name) ? FLAT_TINT[name] : undefined
    return layers.length ? { kind: 'flat', layers, ...(t ? { tint: { layer: t[0], color: t[1] } } : {}) } : null
  }
  // 손에 드는 평평한 아이템
  if (textures.layer0 || parents.some((p) => /builtin\/generated$/.test(p))) return flat()
  // 게임이 코드로 그리는 아이템: 게임 텍스처로 만든다. 못 만들면 대표 그림이 엉뚱해서 그림 없이 둔다
  if (picked.special || parents.some((p) => /builtin\/entity$/.test(p)) || CHESTS[`${ns}:${name}`] || HEADS[`${ns}:${name}`])
    return specialIcon(jars, `${ns}:${name}`, picked.spec)
  if (!elements?.length) return flat()
  // 블록: 모델의 상자들(계단은 2개, 버튼은 작은 1개 등)을 크기 그대로 입체로. 그림은 같은 것끼리 한 번만 보낸다
  const texMap: Record<string, string> = {}
  const boxes: ModelBox[] = []
  for (const el of elements.slice(0, 40)) {
    const faces: ModelBox['faces'] = {}
    for (const [dir, f] of Object.entries(el.faces ?? {})) {
      const ref = resolveVar(textures, f.texture)
      if (!ref) continue
      const tint = f.tintindex != null && ns === 'minecraft' ? BLOCK_TINT[name] : undefined
      const key = `${ref}${tint != null ? '#tint' : ''}`
      if (!(key in texMap)) {
        const url = await textureUrl(jars, ref, tint)
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

// 인챈트 반짝임 그림 (게임과 같은 보라색 무늬가 흐르게 하는 데 쓴다)
const glintCache = new Map<string, Promise<string | null>>()
export function glintTexture(mcVersion: string): Promise<string | null> {
  if (!glintCache.has(mcVersion)) {
    const p = (async () => {
      const jar = await jarOf(await clientJar(mcVersion))
      const buf = (await jar.read('assets/minecraft/textures/misc/enchanted_glint_item.png')) ?? (await jar.read('assets/minecraft/textures/misc/enchanted_item_glint.png'))
      return buf ? nativeImage.createFromBuffer(buf).toDataURL() : null
    })().catch(() => null)
    glintCache.set(mcVersion, p)
  }
  return glintCache.get(mcVersion)!
}
