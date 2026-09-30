// build-tools/i18n/t*.tsv (번호<TAB>영어<TAB>중국어, 번호 대신 한글을 써도 된다)를
// src/i18n/en.json, zh.json (한글 → 번역) 으로 합친다. 번호는 source.json 순서다.
import fs from 'fs'

const keys = Object.keys(JSON.parse(fs.readFileSync('build-tools/i18n/source.json', 'utf8')))
const en = {}
const zh = {}
for (const f of fs.readdirSync('build-tools/i18n').filter((f) => /^t\d+\.tsv$/.test(f)).sort()) {
  for (const line of fs.readFileSync(`build-tools/i18n/${f}`, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue
    const [id, e = '', z = ''] = line.split('\t')
    const key = /^\d+$/.test(id) ? keys[Number(id)] : id
    if (key == null) throw new Error(`${f}: 없는 번호 ${id}`)
    en[key] = e
    zh[key] = z
  }
}
const missing = keys.filter((k) => !(k in en))
fs.mkdirSync('src/i18n', { recursive: true })
fs.writeFileSync('src/i18n/en.json', JSON.stringify(en, null, 1))
fs.writeFileSync('src/i18n/zh.json', JSON.stringify(zh, null, 1))
console.log(Object.keys(en).length, 'translated,', missing.length, 'missing')
if (missing.length) console.log(missing.join('\n'))
