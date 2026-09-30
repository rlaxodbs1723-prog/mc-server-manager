// 화면 번역: 화면에 올라온 글자(와 title·placeholder)를 보고 한국어면 고른 언어로 바꾼다.
// 컴포넌트마다 번역 함수를 부르지 않아도 되고, 메인 프로세스에서 온 오류·진행 문구도 같이 바뀐다.
// 서버 콘솔처럼 사용자·서버가 쓴 글은 바꾸지 않는다 (data-notr 을 붙인 곳 안).
import { translator, type Lang } from '../../i18n'

const ATTRS = ['title', 'placeholder', 'aria-label']
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT'])
const HANGUL = /[가-힣]/
let tr: (s: string) => string = (s) => s
let current: Lang = 'ko'
const done = new WeakMap<Node, string>() // 마지막으로 바꿔 넣은 글자 (다시 바꾸지 않게)

export const getLang = (): Lang => current
export const t = (s: string): string => tr(s) // 코드에서 직접 번역할 때 (예: confirm 창)

function skipped(el: Element | null): boolean {
  for (let e = el; e; e = e.parentElement) {
    if (SKIP.has(e.tagName) || e.hasAttribute('data-notr') || (e as HTMLElement).isContentEditable) return true
  }
  return false
}

function text(node: Text): void {
  const v = node.nodeValue
  if (!v || !HANGUL.test(v) || done.get(node) === v || skipped(node.parentElement)) return
  const out = tr(v)
  done.set(node, out)
  if (out !== v) node.nodeValue = out
}

function attrs(el: Element): void {
  if (skipped(el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ? el.parentElement : el)) return
  for (const a of ATTRS) {
    const v = el.getAttribute(a)
    if (v && HANGUL.test(v)) {
      const out = tr(v)
      if (out !== v) el.setAttribute(a, out)
    }
  }
}

function walk(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) return text(root as Text)
  if (root.nodeType !== Node.ELEMENT_NODE) return
  attrs(root as Element)
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) text(n as Text)
    else attrs(n as Element)
  }
}

export function startTranslating(lang: Lang): void {
  current = lang
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang
  if (lang === 'ko') return
  tr = translator(lang)
  document.title = tr(document.title)
  walk(document.body)
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') text(m.target as Text)
      else if (m.type === 'attributes') attrs(m.target as Element)
      else m.addedNodes.forEach(walk)
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS })
}
