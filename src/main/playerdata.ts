// 플레이어 정보: 월드의 playerdata/<uuid>.dat 를 읽어 체력, 배고픔, 레벨, 위치, 인벤토리, 엔더 상자를 보여 준다.
// 서버가 꺼져 있어도 읽을 수 있다 (켜져 있으면 마지막으로 저장된 상태).
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import type { InvItem, PlayerData } from '../shared-types'
import { digitFont, getItemIcons, getItemLang, glintTexture } from './gameassets'
import { parseNbt, type Tag } from './nbt'
import { readProperties } from './properties'
import { getPlayers, getState, quietQuery } from './runner'
import { readServerInfo } from './servers'

// NBT를 다루기 쉬운 JS 값으로
type Plain = string | number | boolean | null | Plain[] | { [k: string]: Plain }
function plain(t: Tag): Plain {
  switch (t.type) {
    case 1: case 2: case 3: case 5: case 6: return t.value
    case 4: return Number(t.value)
    case 7: return [...t.value]
    case 8: return t.value.toString('utf8')
    case 9: return t.value.items.map(plain)
    case 10: return Object.fromEntries(t.value.map(([k, v]) => [k.toString('utf8'), plain(v)]))
    case 11: return [...t.value]
    case 12: return t.value.map(Number)
  }
}
type Obj = { [k: string]: Plain }
const obj = (v: Plain | undefined): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})
const arr = (v: Plain | undefined): Plain[] => (Array.isArray(v) ? v : [])
const num = (v: Plain | undefined, d = 0): number => (typeof v === 'number' ? v : d)

// 이름 -> uuid: 서버가 적어 둔 usercache.json, 없으면 정품 인증 없는 서버의 uuid 규칙
function uuidsOf(folderPath: string, name: string): string[] {
  const out: string[] = []
  try {
    const cache = JSON.parse(fs.readFileSync(path.join(folderPath, 'usercache.json'), 'utf8')) as { name: string; uuid: string }[]
    for (const c of cache) if (c.name.toLowerCase() === name.toLowerCase()) out.push(c.uuid)
  } catch {
    // 없음
  }
  const md5 = crypto.createHash('md5').update(`OfflinePlayer:${name}`).digest()
  md5[6] = (md5[6] & 0x0f) | 0x30
  md5[8] = (md5[8] & 0x3f) | 0x80
  const h = md5.toString('hex')
  out.push(`${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`)
  return out
}

function findDat(folderPath: string, name: string): string | null {
  const world = path.join(folderPath, readProperties(folderPath)['level-name'] || 'world')
  for (const uuid of uuidsOf(folderPath, name))
    for (const sub of ['playerdata', path.join('players', 'data')]) {
      const f = path.join(world, sub, `${uuid}.dat`)
      if (fs.existsSync(f)) return f
    }
  return null
}

// 이름표 문자열(JSON 글자)이나 글자 컴파운드에서 글자만
function textOf(v: Plain | undefined): string | undefined {
  if (v == null) return undefined
  if (typeof v === 'string') {
    try {
      return textOf(JSON.parse(v) as Plain) ?? v
    } catch {
      return v
    }
  }
  if (Array.isArray(v)) return v.map(textOf).join('')
  if (typeof v === 'object') return `${textOf(v.text) ?? ''}${arr(v.extra).map(textOf).join('')}` || undefined
  return String(v)
}

// 인챈트가 없어도 원래 반짝이는 아이템
const GLINT_ITEMS = new Set(
  ['enchanted_golden_apple', 'enchanted_book', 'nether_star', 'experience_bottle', 'end_crystal', 'written_book', 'debug_stick'].map((n) => `minecraft:${n}`)
)

// 물약 종류별 색 (게임의 효과 색). long_/strong_ 은 같은 색
const POTION_COLOR: Record<string, number> = {
  night_vision: 0xc2ff66, invisibility: 0xf6f6f6, leaping: 0xfdff84, fire_resistance: 0xff9900, swiftness: 0x33ebff, slowness: 0x8bafe0,
  turtle_master: 0x8e7aa8, water_breathing: 0x98dac0, healing: 0xf82423, harming: 0xa9656a, poison: 0x87a363, regeneration: 0xcd5cab,
  strength: 0xffc700, weakness: 0x484d48, luck: 0x59c106, slow_falling: 0xf3cfb9, wind_charged: 0xbdc9ff, weaving: 0x78695a, oozing: 0x99ffa3,
  infested: 0x8c9b8c
}
function itemColor(tag: Obj, comp: Obj): number | undefined {
  const pc = comp['minecraft:potion_contents']
  const pcObj = obj(pc)
  const custom = typeof pcObj.custom_color === 'number' ? pcObj.custom_color : typeof tag.CustomPotionColor === 'number' ? tag.CustomPotionColor : undefined
  if (custom != null) return custom >>> 0 & 0xffffff
  const potion = typeof pc === 'string' ? pc : typeof pcObj.potion === 'string' ? pcObj.potion : typeof tag.Potion === 'string' ? tag.Potion : undefined
  if (potion) return POTION_COLOR[potion.replace(/^minecraft:/, '').replace(/^(long|strong)_/, '')]
  const dyed = comp['minecraft:dyed_color']
  const dye = typeof dyed === 'number' ? dyed : typeof obj(dyed).rgb === 'number' ? obj(dyed).rgb : obj(tag.display).color
  return typeof dye === 'number' ? dye & 0xffffff : undefined
}

interface RawItem {
  id: string
  count: number
  slot: number
  name?: string
  ench: [string, number][]
  damage: number
  glint: boolean
  color?: number
}

function rawItem(v: Plain, slot?: number): RawItem | null {
  const o = obj(v)
  const id = typeof o.id === 'string' ? (o.id.includes(':') ? o.id : `minecraft:${o.id}`) : null
  if (!id || id === 'minecraft:air') return null
  const tag = obj(o.tag) // 1.20.4까지
  const comp = obj(o.components) // 1.20.5부터
  const ench: [string, number][] = []
  for (const e of arr(tag.Enchantments).concat(arr(tag.StoredEnchantments))) {
    const eo = obj(e)
    if (typeof eo.id === 'string') ench.push([eo.id, num(eo.lvl, 1)])
  }
  for (const key of ['minecraft:enchantments', 'minecraft:stored_enchantments']) {
    const c = obj(comp[key])
    const levels = c.levels !== undefined ? obj(c.levels) : c
    for (const [k, lv] of Object.entries(levels)) if (typeof lv === 'number') ench.push([k, lv])
  }
  return {
    id,
    count: num(o.Count ?? o.count, 1),
    slot: slot ?? num(o.Slot, -1),
    name: textOf(comp['minecraft:custom_name']) ?? textOf(obj(tag.display).Name),
    ench,
    damage: num(comp['minecraft:damage'] ?? tag.Damage),
    color: itemColor(tag, comp),
    // 반짝임: 따로 정했으면 그대로, 아니면 인챈트가 있거나 원래 반짝이는 아이템
    glint: typeof comp['minecraft:enchantment_glint_override'] === 'number' ? comp['minecraft:enchantment_glint_override'] !== 0 : ench.length > 0 || GLINT_ITEMS.has(id)
  }
}

const roman = (n: number): string => (['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n] ?? String(n))

// 명령어 답으로 오는 SNBT 글자(예: {Health:20.0f,Inventory:[{id:"minecraft:dirt",count:3}]})를 JS 값으로
export function parseSnbt(text: string): Plain {
  let i = 0
  const ws = () => {
    while (i < text.length && /\s/.test(text[i])) i++
  }
  const value = (): Plain => {
    ws()
    const c = text[i]
    if (c === '{') {
      i++
      const o: Obj = {}
      for (ws(); text[i] !== '}'; ws()) {
        const k = c2key()
        ws()
        i++ // :
        o[k] = value()
        ws()
        if (text[i] === ',') i++
        ws()
      }
      i++
      return o
    }
    if (c === '[') {
      i++
      if (/^[BIL];/.test(text.slice(i, i + 2))) i += 2 // [I; 1, 2] 같은 배열
      const a: Plain[] = []
      for (ws(); text[i] !== ']'; ws()) {
        a.push(value())
        ws()
        if (text[i] === ',') i++
      }
      i++
      return a
    }
    if (c === '"' || c === "'") return quoted()
    const m = text.slice(i).match(/^[^,}\]:\s]+/)
    const raw = m ? m[0] : ''
    i += raw.length
    if (raw === 'true') return 1
    if (raw === 'false') return 0
    const n = raw.match(/^(-?\d*\.?\d+(?:e-?\d+)?)[bslfdBSLFD]?$/)
    return n ? Number(n[1]) : raw
  }
  const quoted = (): string => {
    const q = text[i++]
    let out = ''
    while (i < text.length && text[i] !== q) {
      if (text[i] === '\\') i++
      out += text[i++]
    }
    i++
    return out
  }
  const c2key = (): string => {
    ws()
    if (text[i] === '"' || text[i] === "'") return quoted()
    const m = text.slice(i).match(/^[^:\s]+/)
    i += m ? m[0].length : 1
    return m ? m[0] : ''
  }
  return value()
}

// 켜진 서버에 접속 중이면 저장 없이 그 플레이어 정보만 물어본다 (렉 없음).
// 답이 서버 로그에도 남아서, 전체(레시피 목록까지 아주 길다) 대신 필요한 것만 묻는다.
// 답에는 무슨 값인지 적혀 있지 않아서, 늘 있는 값은 한 번에 묻고 순서로 맞춘다. 없을 수 있는 값은 따로 묻는다
const ALWAYS = ['Health', 'foodLevel', 'XpLevel', 'XpP', 'playerGameType', 'Dimension', 'Pos', 'Inventory', 'EnderItems']
const MAYBE = ['equipment', 'LastDeathLocation']
const MARK = ' has the following entity data: '

async function ask(folderPath: string, name: string, fields: string[], wait = 4000): Promise<Plain[]> {
  const lines = await quietQuery(folderPath, fields.map((f) => `data get entity ${name} ${f}`), (l) => l.includes(MARK), {
    idleMs: 200,
    maxMs: wait,
    firstMs: wait
  }).catch(() => [] as string[])
  return lines.map((l) => {
    try {
      return parseSnbt(l.slice(l.indexOf(MARK) + MARK.length))
    } catch {
      return null
    }
  })
}

async function liveData(folderPath: string, name: string): Promise<Obj | null> {
  if (getState(folderPath) !== 'running' || !/^\w{1,16}$/.test(name) || !getPlayers(folderPath).includes(name)) return null
  const got = await ask(folderPath, name, ALWAYS)
  if (got.length !== ALWAYS.length) return null // 순서를 맞출 수 없으면 저장 파일을 쓴다
  const out: Obj = Object.fromEntries(ALWAYS.map((f, i) => [f, got[i]]))
  for (const f of MAYBE) {
    const [v] = await ask(folderPath, name, [f], 1000) // 없으면 답이 안 오므로 짧게 기다린다
    if (v !== undefined) out[f] = v
  }
  return out
}

export async function getPlayerData(folderPath: string, name: string): Promise<PlayerData | null> {
  const live = await liveData(folderPath, name)
  const file = live ? null : findDat(folderPath, name)
  if (!live && !file) return null
  const root = live ?? obj(plain(parseNbt(fs.readFileSync(file!)).root))

  const inv: RawItem[] = []
  for (const v of arr(root.Inventory)) {
    const it = rawItem(v)
    if (it) inv.push(it)
  }
  // 1.21.5부터 갑옷·왼손은 equipment 에 따로 있다. 예전 칸 번호(100~103, -106)로 맞춘다
  const EQUIP: Record<string, number> = { feet: 100, legs: 101, chest: 102, head: 103, offhand: -106 }
  for (const [k, v] of Object.entries(obj(root.equipment))) {
    const it = EQUIP[k] != null ? rawItem(v, EQUIP[k]) : null
    if (it) inv.push(it)
  }
  const ender: RawItem[] = []
  for (const v of arr(root.EnderItems)) {
    const it = rawItem(v)
    if (it) ender.push(it)
  }

  const { mcVersion } = readServerInfo(folderPath)
  const all = [...inv, ...ender]
  const ids = all.map((i) => i.id)
  const [icons, lang, digits, glint] = await Promise.all([
    getItemIcons(folderPath, mcVersion, ids).catch(() => ({}) as Record<string, null>),
    getItemLang(folderPath, mcVersion, ids.map((i) => i.split(':')[0])).catch(() => ({}) as Record<string, string>),
    digitFont(mcVersion),
    glintTexture(mcVersion)
  ])
  const itemName = (id: string): string => {
    const [ns, p] = id.split(':')
    return lang[`item.${ns}.${p}`] ?? lang[`block.${ns}.${p}`] ?? p.replace(/_/g, ' ')
  }
  const enchName = (id: string): string => {
    const full = id.includes(':') ? id : `minecraft:${id}`
    const [ns, p] = full.split(':')
    return lang[`enchantment.${ns}.${p}`] ?? p.replace(/_/g, ' ')
  }
  const done = (i: RawItem): InvItem => ({
    id: i.id,
    slot: i.slot,
    count: i.count,
    name: itemName(i.id),
    customName: i.name,
    enchants: i.ench.map(([e, lv]) => `${enchName(e)} ${roman(lv)}`),
    damage: i.damage,
    glint: i.glint,
    color: i.color,
    icon: icons[i.id] ?? null
  })

  const pos = arr(root.Pos).map((n) => num(n))
  const death = obj(root.LastDeathLocation)
  const deathPos = arr(death.pos).map((n) => num(n))
  const dim = (d: Plain | undefined): string => {
    const s = typeof d === 'string' ? d : typeof d === 'number' ? ['minecraft:the_nether', 'minecraft:overworld', 'minecraft:the_end'][d + 1] : ''
    return s ?? ''
  }
  return {
    live: !!live,
    health: num(root.Health),
    food: num(root.foodLevel),
    level: num(root.XpLevel),
    xpProgress: num(root.XpP),
    gameMode: num(root.playerGameType),
    dimension: dim(root.Dimension),
    pos: pos.length === 3 ? pos : null,
    deathDimension: deathPos.length === 3 ? dim(death.dimension) : null,
    deathPos: deathPos.length === 3 ? deathPos : null,
    savedAt: file ? fs.statSync(file).mtimeMs : Date.now(),
    inventory: inv.map(done),
    ender: ender.map(done),
    digits,
    glint
  }
}
