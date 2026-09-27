// server.properties 읽기/쓰기
// 자바 properties 형식이라 한글은 \uXXXX로, ':' '=' 같은 글자는 앞에 \를 붙여 저장된다. (예: level-type=minecraft\:normal)
import fs from 'fs'
import path from 'path'

const fileOf = (folderPath: string): string => path.join(folderPath, 'server.properties')
const KEY_RE = /^\s*([^#!=:\s][^=:\s]*)\s*[=:]\s?(.*)$/

function unescape(value: string): string {
  return value.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, c: string) => {
    if (c[0] === 'u' && c.length === 5) return String.fromCharCode(parseInt(c.slice(1), 16))
    return { t: '\t', n: '\n', r: '\r', f: '\f' }[c] ?? c
  })
}

function escape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/[:=#!]/g, (c) => `\\${c}`)
    .replace(/\n/g, '\\n')
    .replace(/^ /, '\\ ')
    .replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`) // 한글 등
}

// 예전 마인크래프트는 ISO-8859-1(한글은 \uXXXX)로, 최신 버전은 UTF-8(한글 그대로)로 파일을 쓴다.
// UTF-8로 깨짐 없이 읽히면 UTF-8, 아니면 ISO-8859-1로 읽는다. 다시 쓸 때도 같은 방식으로 쓴다.
type FileEncoding = 'utf8' | 'latin1'
function readText(file: string): { text: string; encoding: FileEncoding } {
  const buf = fs.readFileSync(file)
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), encoding: 'utf8' }
  } catch {
    return { text: buf.toString('latin1'), encoding: 'latin1' }
  }
}

export function readProperties(folderPath: string): Record<string, string> {
  const out: Record<string, string> = {}
  let text = ''
  try {
    text = readText(fileOf(folderPath)).text
  } catch {
    return out // 처음 켜기 전에는 파일이 없다
  }
  for (const line of text.split(/\r?\n/)) {
    const m = KEY_RE.exec(line)
    if (m) out[m[1]] = unescape(m[2])
  }
  return out
}

// 주어진 키만 바꾸고 나머지 줄(주석 포함)은 그대로 둔다. 파일이 없으면 새로 만든다.
export function writeProperties(folderPath: string, changes: Record<string, string>): void {
  const file = fileOf(folderPath)
  const { text, encoding } = fs.existsSync(file) ? readText(file) : { text: '', encoding: 'utf8' as FileEncoding }
  const eol = text.includes('\r\n') ? '\r\n' : '\n' // 마인크래프트가 쓴 줄바꿈 방식을 그대로 유지
  const lines = text ? text.split(/\r?\n/) : []
  const left = new Map(Object.entries(changes))
  const out = lines.map((line) => {
    const key = KEY_RE.exec(line)?.[1]
    if (key && left.has(key)) {
      const value = left.get(key)!
      left.delete(key)
      return `${key}=${escape(value)}`
    }
    return line
  })
  while (out.length && out[out.length - 1] === '') out.pop()
  for (const [key, value] of left) out.push(`${key}=${escape(value)}`)
  // 새로 쓰는 값은 한글을 \uXXXX로 바꿔 ASCII만 남기므로 어느 방식으로 읽어도 깨지지 않는다
  fs.writeFileSync(file, out.join(eol) + eol, encoding)
}
