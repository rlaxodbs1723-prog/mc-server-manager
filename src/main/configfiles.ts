// 서버 폴더 파일 탐색기 + 설정 파일 편집기.
// 폴더를 오가며 보고, 글자로 된 파일(yml·json·toml·properties 등)은 고쳐서 저장한다.
// 이름 바꾸기·새로 만들기·휴지통으로 보내기도 된다. 앱이 쓰는 파일은 건드리지 못하게 막는다.
import { shell } from 'electron'
import fs from 'fs'
import path from 'path'
import type { DirEntry } from '../shared-types'
import { getState } from './runner'

const TEXT_EXT = /\.(properties|json|json5|jsonc|toml|ya?ml|cfg|conf|ini|txt|snbt|mcmeta|md|log|csv|mcfunction|js|zs|lang|list|secret)$/i
const MAX_BYTES = 2 * 1024 * 1024 // 이보다 큰 파일은 편집기로 열지 않는다

// 앱이 쓰는 파일·폴더: 목록에서 숨긴다 (망가지면 앱이 서버를 못 읽는다)
const isAppFile = (name: string): boolean => name === 'server-manager.json' || name.startsWith('.server-manager') || name.startsWith('.restoring-') || name === '.importing-world' || name === '.creating'
const BAD_NAME = /[<>:"/\\|?*\x00-\x1f]|^\.+$|[. ]$/

// 화면이 넘긴 상대 경로가 서버 폴더 안인지 확인한다 (빈 문자열이면 서버 폴더 자체)
function resolveIn(folderPath: string, rel: string): string {
  const root = path.resolve(folderPath)
  const target = path.resolve(root, String(rel ?? ''))
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error('서버 폴더 밖이에요.')
  if (target !== root && path.relative(root, target).split(path.sep).some(isAppFile)) throw new Error('앱이 쓰는 파일이라 여기서 다룰 수 없어요.')
  return target
}

const editable = (name: string, size: number): boolean => TEXT_EXT.test(name) && size <= MAX_BYTES

export function listDir(folderPath: string, rel: string): DirEntry[] {
  const dir = resolveIn(folderPath, rel)
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error('폴더를 찾을 수 없어요.')
  const out: DirEntry[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (isAppFile(e.name)) continue
    try {
      const st = fs.statSync(path.join(dir, e.name))
      const isDir = st.isDirectory()
      out.push({ name: e.name, dir: isDir, size: isDir ? 0 : st.size, modified: st.mtimeMs, editable: !isDir && editable(e.name, st.size) })
    } catch {
      // 읽을 수 없는 항목은 뺀다
    }
  }
  return out
}

export function readConfigFile(folderPath: string, rel: string): { text: string; modified: number } {
  const file = resolveIn(folderPath, rel)
  const st = fs.statSync(file)
  if (!editable(path.basename(file), st.size)) throw new Error(st.size > MAX_BYTES ? '파일이 너무 커서 여기서 열 수 없어요.' : '글자로 된 설정 파일만 열 수 있어요.')
  const buf = fs.readFileSync(file)
  if (buf.includes(0)) throw new Error('글자로 된 파일이 아니에요.')
  return { text: buf.toString('utf8'), modified: st.mtimeMs }
}

// expectedModified: 연 뒤에 다른 곳(서버·다른 프로그램)이 파일을 바꿨으면 덮어쓰지 않고 알린다
export function writeConfigFile(folderPath: string, rel: string, text: string, expectedModified?: number): number {
  const file = resolveIn(folderPath, rel)
  if (!TEXT_EXT.test(file)) throw new Error('글자로 된 설정 파일만 저장할 수 있어요.')
  if (expectedModified != null && fs.existsSync(file) && Math.abs(fs.statSync(file).mtimeMs - expectedModified) > 1)
    throw new Error('연 뒤에 다른 곳에서 이 파일이 바뀌었어요. 다시 불러온 뒤 고쳐 주세요.')
  const body = String(text)
  if (Buffer.byteLength(body) > MAX_BYTES) throw new Error('파일이 너무 커요.')
  // 임시 파일에 쓴 뒤 바꿔 끼운다 (쓰다가 멈춰도 원래 파일이 반쯤 망가지지 않게)
  const tmp = `${file}.saving`
  fs.writeFileSync(tmp, body)
  fs.renameSync(tmp, file)
  return fs.statSync(file).mtimeMs
}

// 켜진 서버의 파일을 옮기거나 지우면 월드·모드가 망가질 수 있어서 꺼져 있을 때만 한다
function assertStopped(folderPath: string): void {
  if (getState(folderPath) !== 'stopped') throw new Error('서버를 끈 다음에 할 수 있어요.')
}

function checkName(name: string): string {
  const n = String(name ?? '').trim()
  if (!n || BAD_NAME.test(n) || n.length > 120) throw new Error('쓸 수 없는 이름이에요. (\\ / : * ? " < > | 는 못 써요)')
  if (isAppFile(n)) throw new Error('앱이 쓰는 이름이라 쓸 수 없어요.')
  return n
}

export function renameEntry(folderPath: string, rel: string, newName: string): void {
  assertStopped(folderPath)
  const from = resolveIn(folderPath, rel)
  if (from === path.resolve(folderPath)) throw new Error('서버 폴더 자체는 바꿀 수 없어요.')
  const to = path.join(path.dirname(from), checkName(newName))
  if (fs.existsSync(to)) throw new Error('같은 이름이 이미 있어요.')
  fs.renameSync(from, to)
}

// 휴지통으로 (되살릴 수 있게)
export async function trashEntries(folderPath: string, rels: string[]): Promise<void> {
  assertStopped(folderPath)
  const root = path.resolve(folderPath)
  for (const rel of rels) {
    const p = resolveIn(folderPath, rel)
    if (p === root) throw new Error('서버 폴더 자체는 지울 수 없어요.')
    if (fs.existsSync(p)) await shell.trashItem(p)
  }
}

export function createEntry(folderPath: string, rel: string, name: string, kind: 'dir' | 'file'): string {
  const dir = resolveIn(folderPath, rel)
  const target = path.join(dir, checkName(name))
  if (fs.existsSync(target)) throw new Error('같은 이름이 이미 있어요.')
  if (kind === 'dir') fs.mkdirSync(target)
  else {
    if (!TEXT_EXT.test(target)) throw new Error('새 파일은 .txt .yml .json 같은 글자 파일만 만들 수 있어요.')
    fs.writeFileSync(target, '')
  }
  return path.relative(path.resolve(folderPath), target).split(path.sep).join('/')
}

export function revealEntry(folderPath: string, rel: string): void {
  const p = resolveIn(folderPath, rel)
  if (p === path.resolve(folderPath) || fs.statSync(p).isDirectory()) void shell.openPath(p)
  else shell.showItemInFolder(p)
}
