// 앱 언어: 한국어(원문) / 영어 / 중국어.
// 코드 안의 글자는 한국어 그대로 두고, 보여 줄 때 번역 표(en.json, zh.json: 한글 → 번역)로 바꾼다.
// 표는 build-tools/i18n-extract.mjs → 번역 → i18n-merge.mjs 로 만든다.
// 템플릿 문자열은 ${...} 자리를 {0}, {1}로 적어 두었으므로, 그 자리는 아무 글자나 맞춰 보고 그 안도 다시 번역한다.
import en from './en.json'
import zh from './zh.json'

export type Lang = 'ko' | 'en' | 'zh'
export const LANGS: { id: Lang; label: string }[] = [
  { id: 'ko', label: '한국어' },
  { id: 'en', label: 'English' },
  { id: 'zh', label: '中文' }
]

const HANGUL = /[가-힣]/
const TABLES: Record<Exclude<Lang, 'ko'>, Record<string, string>> = { en, zh }

export function langFromLocale(locale: string): Lang {
  const l = locale.toLowerCase()
  if (l.startsWith('ko')) return 'ko'
  if (l.startsWith('zh')) return 'zh'
  return 'en'
}

interface Pattern {
  re: RegExp
  order: number[] // 정규식의 n번째 묶음이 {몇}인지
  to: string
}

export interface Translator {
  (s: string): string
}

function build(table: Record<string, string>): Translator {
  const exact = new Map<string, string>()
  const patterns: (Pattern & { weight: number })[] = []
  for (const [ko, to] of Object.entries(table)) {
    if (!/\{\d\}/.test(ko)) {
      exact.set(ko, to)
      continue
    }
    const literal = ko.replace(/\{\d\}/g, '')
    if (!HANGUL.test(literal)) continue // 한글이 없는 틀은 아무 글에나 맞아서 쓰지 않는다
    const order: number[] = []
    const src = ko
      .split(/(\{\d\})/)
      .map((part) => {
        const m = /^\{(\d)\}$/.exec(part)
        if (m) {
          order.push(Number(m[1]))
          return '([\\s\\S]*?)'
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      })
      .join('')
    patterns.push({ re: new RegExp(`^${src}$`), order, to, weight: literal.length })
  }
  patterns.sort((a, b) => b.weight - a.weight) // 글자가 많이 맞는 틀부터
  const cache = new Map<string, string>()

  const tr = (s: string, depth = 0): string => {
    if (!s || !HANGUL.test(s)) return s
    const lead = /^\s*/.exec(s)![0]
    const trail = /\s*$/.exec(s)![0]
    const core = s.trim().replace(/\s+/g, ' ')
    const hit = cache.get(core)
    if (hit != null) return lead + hit + trail
    let out = exact.get(core)
    if (out == null && depth < 3) {
      for (const p of patterns) {
        const m = p.re.exec(core)
        if (!m) continue
        const vals: string[] = []
        p.order.forEach((n, i) => (vals[n] = tr(m[i + 1], depth + 1)))
        out = p.to.replace(/\{(\d)\}/g, (_, n) => vals[Number(n)] ?? '')
        break
      }
    }
    // 여러 줄 글(예: 오류 설명 + 목록)은 줄마다 따로 맞춰 본다
    if (out == null && /\n/.test(s.trim())) {
      const lines = s.split('\n')
      if (lines.length > 1) return lines.map((l) => tr(l, depth + 1)).join('\n')
    }
    if (out == null) out = core
    if (cache.size < 5000) cache.set(core, out)
    return lead + out + trail
  }
  return (s: string) => tr(s)
}

const built = new Map<Lang, Translator>()
export function translator(lang: Lang): Translator {
  if (lang === 'ko') return (s) => s
  if (!built.has(lang)) built.set(lang, build(TABLES[lang]))
  return built.get(lang)!
}
