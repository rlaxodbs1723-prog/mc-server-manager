// 맵 zip 풀기: userData/world-temp/<시각>/ 에 풀고 level.dat이 있는 폴더를 찾는다.
// 압축 파일 안의 "../" 같은 경로로 폴더 밖에 쓰지 못하게 막는다.
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import yauzl from 'yauzl'

const MAX_TOTAL = 8 * 1024 ** 3 // 풀었을 때 8GB가 넘으면 이상한 파일로 본다

export const tempRoot = (): string => path.join(app.getPath('userData'), 'world-temp')

// 앱을 켤 때 지난번에 풀어 둔 것을 지운다
export function cleanWorldTemp(): void {
  fs.rmSync(tempRoot(), { recursive: true, force: true })
}

export function extractZip(zipFile: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipFile, { lazyEntries: true, decodeStrings: true }, (err, zip) => {
      if (err || !zip) return reject(new Error('zip 파일을 열지 못했어요. 파일이 망가졌을 수 있어요.'))
      let total = 0
      const fail = (e: Error): void => {
        zip.close()
        reject(e)
      }
      zip.on('error', fail)
      zip.on('end', () => resolve())
      zip.on('entry', (entry: yauzl.Entry) => {
        const target = path.resolve(dest, entry.fileName)
        if (target !== path.resolve(dest) && !target.startsWith(path.resolve(dest) + path.sep)) return fail(new Error('zip 안에 잘못된 경로가 있어요.'))
        total += entry.uncompressedSize
        if (total > MAX_TOTAL) return fail(new Error('압축을 풀면 너무 커요.'))
        if (/\/$/.test(entry.fileName)) {
          fs.mkdirSync(target, { recursive: true })
          return zip.readEntry()
        }
        fs.mkdirSync(path.dirname(target), { recursive: true })
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return fail(new Error('zip 파일을 읽지 못했어요.'))
          const out = fs.createWriteStream(target)
          stream.on('error', fail)
          out.on('error', fail)
          out.on('close', () => zip.readEntry())
          stream.pipe(out)
        })
      })
      zip.readEntry()
    })
  })
}

// level.dat이 있는 가장 얕은 폴더 (zip 안에 "맵이름/level.dat"처럼 한 겹 더 있는 경우가 많다)
export function findWorldRoot(dir: string, depth = 0): string | null {
  if (fs.existsSync(path.join(dir, 'level.dat'))) return dir
  if (depth >= 4) return null
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === '__MACOSX') continue
    const found = findWorldRoot(path.join(dir, e.name), depth + 1)
    if (found) return found
  }
  return null
}

// zip을 풀어서 월드 폴더 경로를 돌려준다
export async function unpackWorld(zipFile: string): Promise<string> {
  const dest = path.join(tempRoot(), String(Date.now()))
  fs.mkdirSync(dest, { recursive: true })
  try {
    await extractZip(zipFile, dest)
    const root = findWorldRoot(dest)
    if (!root) throw new Error('zip 안에 마인크래프트 월드(level.dat)가 없어요.')
    return root
  } catch (e) {
    fs.rmSync(dest, { recursive: true, force: true })
    throw e
  }
}
