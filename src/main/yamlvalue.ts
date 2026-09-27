// 아주 단순한 YAML 값 읽기·바꾸기: "a: b: c: 값" 모양(들여쓰기로 나뉜 맵)의 한 값만 다룬다.
// 파일 전체를 다시 쓰지 않고 그 줄의 값만 바꿔서 주석·순서·모양이 그대로 남는다. (목록·여러 줄 값은 다루지 않는다)

const LINE = /^(\s*)([A-Za-z0-9_.-]+|'[^']*'|"[^"]*"):(\s*)(.*)$/

interface Hit {
  index: number // 줄 번호
  indent: string
  key: string
  gap: string
  value: string // 주석을 뺀 값
  comment: string // 값 뒤의 주석 (있으면 " # ..." 모양 그대로)
}

function splitComment(rest: string): { value: string; comment: string } {
  // 따옴표 밖의 " #"부터가 주석
  let quote = ''
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i]
    if (quote) {
      if (c === quote) quote = ''
    } else if (c === '"' || c === "'") quote = c
    else if (c === '#' && (i === 0 || /\s/.test(rest[i - 1]))) {
      let j = i
      while (j > 0 && /\s/.test(rest[j - 1])) j--
      return { value: rest.slice(0, j), comment: rest.slice(j) } // 주석 앞 공백까지 주석 쪽에 붙여 그대로 둔다
    }
  }
  return { value: rest.trimEnd(), comment: '' }
}

const unquote = (k: string): string => (/^(['"]).*\1$/.test(k) ? k.slice(1, -1) : k)

function find(lines: string[], path: string[]): Hit | null {
  const stack: { indent: number; key: string }[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '')
    if (!line.trim() || line.trimStart().startsWith('#') || line.trimStart().startsWith('- ')) continue
    const m = LINE.exec(line)
    if (!m) continue
    const indent = m[1].length
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
    stack.push({ indent, key: unquote(m[2]) })
    if (stack.length === path.length && stack.every((s, k) => s.key === path[k])) {
      const { value, comment } = splitComment(m[4])
      return { index: i, indent: m[1], key: m[2], gap: m[3], value, comment }
    }
  }
  return null
}

// 값 (따옴표는 벗긴다). 없거나 값이 아니라 하위 항목이면 null
export function readYamlValue(text: string, path: string[]): string | null {
  const hit = find(text.split('\n'), path)
  if (!hit || hit.value === '') return null
  return unquote(hit.value)
}

// 있는 항목의 값만 바꾼다. 없으면 null (새 항목은 만들지 않는다 — 서버가 만든 파일의 모양을 해치지 않게)
export function writeYamlValue(text: string, path: string[], value: string): string | null {
  // 줄바꿈 방식이 섞인 파일도 있어서, 줄마다 끝의 \r을 그대로 지킨다
  const lines = text.split('\n')
  const hit = find(lines, path)
  if (!hit || hit.value === '') return null
  const cr = lines[hit.index].endsWith('\r') ? '\r' : ''
  lines[hit.index] = `${hit.indent}${hit.key}:${hit.gap || ' '}${value}${hit.comment}${cr}`
  return lines.join('\n')
}
