// 마인크래프트 공식 한국어 번역(ko_kr.json)에서 게임 규칙 이름·설명을 가져온다. 게임 안 화면과 같은 이름을 쓰기 위해서다.
// 버전마다 번역 파일(에셋 인덱스)이 달라서, 인덱스별로 게임 규칙 부분만 떼어 저장해 둔다.
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { fetchJson } from './download'
import { getVersionMeta } from './mojang'
import { getAppSettings } from './appsettings'

const RESOURCES = 'https://resources.download.minecraft.net'
const cacheDir = (): string => path.join(app.getPath('userData'), 'lang')

interface AssetIndex {
  objects: Record<string, { hash: string; size: number }>
}

const memory = new Map<string, Promise<Record<string, string>>>()

// 앱 언어에 맞는 게임 번역 파일 (영어는 게임 원문)
const GAME_LANG = { ko: 'ko_kr', en: 'en_us', zh: 'zh_cn' } as const

export function getGameRuleLang(mcVersion: string): Promise<Record<string, string>> {
  const lang = GAME_LANG[getAppSettings().language] ?? 'ko_kr'
  const key = `${mcVersion}/${lang}`
  if (!memory.has(key)) {
    const p = load(mcVersion, lang)
    memory.set(key, p)
    p.catch(() => memory.delete(key)) // 실패하면 다음에 다시 시도
  }
  return memory.get(key)!
}

async function load(mcVersion: string, lang: string): Promise<Record<string, string>> {
  const meta = (await getVersionMeta(mcVersion)) as unknown as { assetIndex?: { id: string; url: string } }
  if (!meta.assetIndex) return {}
  const file = path.join(cacheDir(), `gamerules-${meta.assetIndex.id}-${lang}.json`)
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    // 아직 받지 않았다
  }
  const index = await fetchJson<AssetIndex>(meta.assetIndex.url)
  const obj = index.objects[`minecraft/lang/${lang}.json`]
  if (!obj) return {} // 영어(en_us)는 에셋에 없어서 앱에 들어 있는 이름을 쓴다
  const all = await fetchJson<Record<string, string>>(`${RESOURCES}/${obj.hash.slice(0, 2)}/${obj.hash}`)
  const picked = Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith('gamerule.')))
  fs.mkdirSync(cacheDir(), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(picked))
  return picked
}
