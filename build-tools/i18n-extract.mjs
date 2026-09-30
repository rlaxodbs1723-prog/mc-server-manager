// 소스에서 한글이 든 글자를 모두 뽑아 build-tools/i18n/source.json 으로 저장한다 (번역할 목록).
// 템플릿 문자열의 ${...} 자리는 {0}, {1} ... 로 바꾼다. 주석은 뽑지 않는다.
import { parse } from '@babel/parser'
import fs from 'fs'
import path from 'path'

const HANGUL = /[가-힣]/
const out = new Map()

function walkDir(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f)
    if (fs.statSync(p).isDirectory()) walkDir(p)
    else if (/\.tsx?$/.test(f) && !f.endsWith('.d.ts')) scan(p)
  }
}

function add(s, file) {
  s = s.replace(/\s+/g, ' ').trim()
  if (!HANGUL.test(s)) return
  if (!out.has(s)) out.set(s, file)
}

function visit(n, file) {
  if (!n || typeof n.type !== 'string') return
  if (n.type === 'StringLiteral') add(n.value, file)
  else if (n.type === 'JSXText') add(n.value, file)
  else if (n.type === 'TemplateLiteral') {
    let s = ''
    n.quasis.forEach((q, i) => {
      s += q.value.cooked ?? q.value.raw
      if (i < n.expressions.length) s += `{${i}}`
    })
    add(s, file)
  }
  for (const k of Object.keys(n)) {
    if (k === 'loc' || k === 'leadingComments' || k === 'trailingComments' || k === 'innerComments') continue
    const v = n[k]
    if (Array.isArray(v)) v.forEach((c) => visit(c, file))
    else if (v && typeof v === 'object') visit(v, file)
  }
}

function scan(file) {
  const ast = parse(fs.readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['typescript', 'jsx'] })
  visit(ast.program, path.relative('src', file).split(path.sep).join('/'))
}

walkDir('src')
fs.mkdirSync('build-tools/i18n', { recursive: true })
fs.writeFileSync('build-tools/i18n/source.json', JSON.stringify(Object.fromEntries(out), null, 1))
console.log(out.size, 'strings')
