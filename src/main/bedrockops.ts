// 배드락 서버 작업: 월드 가져오기 · 서버 업데이트 · CurseForge에서 받아 넣기
import { shell } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { BedrockKind, BedrockUpdateInfo, Progress, ServerInfo } from '../shared-types'
import { addAddonFile, addDefaults, bedrockWorldDir, BROWSER_HEADERS, latestBedrock, packDirs } from './bedrock'
import { createBackup } from './backup'
import { downloadBedrockHit } from './curseforge'
import { downloadFile } from './download'
import { getState } from './runner'
import { patchServerInfo, readServerInfo } from './servers'
import { extractZip, findWorldRoot } from './worldzip'

const PACK_JSONS = ['world_behavior_packs.json', 'world_resource_packs.json']

function readList(file: string): { pack_id?: string }[] {
  try {
    const list = JSON.parse(fs.readFileSync(file, 'utf8'))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

// .mcworld / .zip 파일이나 월드 폴더를 서버의 월드로 넣는다. 지금 월드는 백업한 뒤 휴지통으로 보낸다
export async function importBedrockWorld(folderPath: string, source: string): Promise<void> {
  const src = path.resolve(String(source))
  if (!fs.existsSync(src)) throw new Error('파일을 찾을 수 없어요.')
  if (getState(folderPath) !== 'stopped') throw new Error('서버를 끈 다음에 월드를 가져올 수 있어요.')
  const isDir = fs.statSync(src).isDirectory()
  if (!isDir && !/\.(mcworld|zip)$/i.test(src)) throw new Error('월드 파일(.mcworld, .zip)이나 월드 폴더가 아니에요.')
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bworld-'))
  try {
    if (isDir) await fs.promises.cp(src, path.join(temp, path.basename(src)), { recursive: true })
    else await extractZip(src, temp)
    const root = findWorldRoot(temp)
    if (!root) throw new Error('월드(level.dat)를 찾지 못했어요. 배드락 월드 파일(.mcworld)이 맞는지 확인해 주세요.')
    if (!fs.existsSync(path.join(root, 'db'))) throw new Error('배드락 월드가 아니에요. (자바 월드는 배드락 서버에 넣을 수 없어요)')
    const target = bedrockWorldDir(folderPath)
    // 지금 켜 둔 애드온 등록은 새 월드에도 이어 준다
    const before = PACK_JSONS.map((f) => readList(path.join(target, f)))
    if (fs.existsSync(target)) {
      await createBackup(folderPath, false, '월드 가져오기 전')
      await shell.trashItem(target)
    }
    await fs.promises.cp(root, target, { recursive: true })
    PACK_JSONS.forEach((f, i) => {
      const file = path.join(target, f)
      const mine = readList(file)
      const extra = before[i].filter((e) => e.pack_id && !mine.some((m) => m.pack_id === e.pack_id))
      if (extra.length) fs.writeFileSync(file, JSON.stringify([...mine, ...extra], null, 2))
    })
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
}

// ---------- 서버 업데이트 ----------
const cmpVersion = (a: string, b: string): number => {
  const x = a.split('.').map(Number)
  const y = b.split('.').map(Number)
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0)
  return 0
}

export async function checkBedrockUpdate(folderPath: string): Promise<BedrockUpdateInfo> {
  const current = readServerInfo(folderPath).mcVersion
  const latest = await latestBedrock()
    .then((l) => l.version)
    .catch(() => null)
  return { current, latest, available: !!latest && cmpVersion(latest, current) > 0 }
}

// 설정·월드·허용 목록·관리자 목록은 그대로 두고 서버 프로그램 파일만 새 버전으로 바꾼다
const KEEP = new Set(['server.properties', 'allowlist.json', 'permissions.json', 'worlds', 'server-manager.json', 'server.properties.bak'])

export async function updateBedrock(folderPath: string, report: (p: Progress) => void): Promise<ServerInfo> {
  if (getState(folderPath) !== 'stopped') throw new Error('서버를 끈 다음에 업데이트할 수 있어요.')
  report({ message: '새 버전을 확인하고 있어요' })
  const { version, url } = await latestBedrock()
  const info = readServerInfo(folderPath)
  if (cmpVersion(version, info.mcVersion) <= 0) throw new Error('이미 최신 버전이에요.')
  if (fs.existsSync(bedrockWorldDir(folderPath))) {
    report({ message: '업데이트하기 전에 월드를 백업하고 있어요' })
    await createBackup(folderPath, true, `${info.mcVersion} → ${version} 업데이트 전`)
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bupdate-'))
  try {
    const zip = path.join(temp, 'server.zip')
    await downloadFile({
      url,
      dest: zip,
      headers: BROWSER_HEADERS,
      onBytes: (done, total) => report({ message: '새 배드락 서버 파일을 받고 있어요', done, total, unit: 'bytes' })
    })
    const fresh = path.join(temp, 'fresh')
    report({ message: '서버 파일을 풀고 있어요' })
    await extractZip(zip, fresh)
    if (!fs.existsSync(path.join(fresh, 'bedrock_server.exe'))) throw new Error('받은 파일에서 배드락 서버(bedrock_server.exe)를 찾지 못했어요.')
    report({ message: '서버 파일을 바꾸고 있어요' })
    for (const name of fs.readdirSync(fresh)) {
      if (KEEP.has(name)) continue
      const from = path.join(fresh, name)
      const to = path.join(folderPath, name)
      // config는 사용자가 고쳤을 수 있어서 없는 파일만 채운다
      await fs.promises.cp(from, to, { recursive: true, force: name !== 'config', errorOnExist: false })
    }
    addDefaults(folderPath, [...packDirs(fresh, 'behavior_packs'), ...packDirs(fresh, 'resource_packs')])
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
  patchServerInfo(folderPath, { mcVersion: version })
  report({ message: '완료' })
  return readServerInfo(folderPath)
}

// ---------- CurseForge에서 받아 넣기 ----------
export async function installBedrockHit(folderPath: string, modId: number, kind: BedrockKind): Promise<string> {
  const { file, fileName, title } = await downloadBedrockHit(modId)
  try {
    if (kind === 'map') await importBedrockWorld(folderPath, file)
    else {
      if (/\.mcworld$/i.test(fileName)) throw new Error('이 파일은 월드예요. "맵" 탭에서 설치해 주세요.')
      await addAddonFile(folderPath, file)
    }
  } finally {
    fs.rmSync(file, { force: true })
  }
  return title
}
