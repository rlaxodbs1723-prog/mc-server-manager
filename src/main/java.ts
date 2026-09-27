import fs from 'fs'
import path from 'path'
import { downloadFile, fetchJson } from './download'

// Mojang이 배포하는 Java 런타임 목록 (공식 런처가 쓰는 것과 같다)
const RUNTIME_INDEX =
  'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json'
const CONCURRENCY = 16

type RuntimeIndex = Record<string, Record<string, { manifest: { url: string } }[]>>
interface RuntimeManifest {
  files: Record<
    string,
    { type: 'file' | 'directory' | 'link'; downloads?: { raw: { url: string; sha1: string } } }
  >
}

export type JavaReport = (message: string, done?: number, total?: number) => void

function platformKey(): string {
  if (process.platform !== 'win32') throw new Error('현재는 Windows만 지원해요.')
  return process.arch === 'ia32' ? 'windows-x86' : process.arch === 'arm64' ? 'windows-arm64' : 'windows-x64'
}

// 서버는 콘솔 출력을 읽어야 하므로 javaw.exe가 아니라 java.exe를 쓴다.
export const javaExe = (runtimeRoot: string, component: string): string =>
  path.join(runtimeRoot, component, 'bin', 'java.exe')

// 같은 런타임을 동시에 두 번 설치하지 않도록 합친다.
const pending = new Map<string, Promise<string>>()

// component(예: "java-runtime-epsilon")에 맞는 Java를 준비하고 java.exe 경로를 돌려준다.
export function ensureJava(runtimeRoot: string, component: string, report: JavaReport = () => {}): Promise<string> {
  const key = path.join(runtimeRoot, component)
  if (!pending.has(key)) {
    pending.set(key, installJava(runtimeRoot, component, report).finally(() => pending.delete(key)))
  }
  return pending.get(key)!
}

async function installJava(runtimeRoot: string, component: string, report: JavaReport): Promise<string> {
  const root = path.join(runtimeRoot, component)
  const marker = path.join(root, '.installed')
  const exe = javaExe(runtimeRoot, component)
  if (fs.existsSync(marker) && fs.existsSync(exe)) return exe

  report('Java를 확인하고 있어요')
  const index = await fetchJson<RuntimeIndex>(RUNTIME_INDEX)
  const entry = index[platformKey()]?.[component]?.[0]
  if (!entry) throw new Error(`이 컴퓨터용 Java(${component})를 찾을 수 없어요.`)

  const manifest = await fetchJson<RuntimeManifest>(entry.manifest.url)
  const tasks: { url: string; sha1: string; dest: string }[] = []
  for (const [rel, file] of Object.entries(manifest.files)) {
    const dest = path.join(root, rel)
    if (path.relative(root, dest).startsWith('..')) throw new Error(`잘못된 Java 파일 경로: ${rel}`)
    if (file.type === 'directory') fs.mkdirSync(dest, { recursive: true })
    else if (file.type === 'file' && file.downloads) tasks.push({ ...file.downloads.raw, dest })
  }

  // 파일이 수백 개라 여러 개를 동시에 받는다.
  let next = 0
  let done = 0
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      await downloadFile(tasks[next++])
      report('Java를 받고 있어요', ++done, tasks.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, worker))

  if (!fs.existsSync(exe)) throw new Error('Java 설치 후 java.exe를 찾지 못했어요.')
  fs.writeFileSync(marker, new Date().toISOString())
  return exe
}
