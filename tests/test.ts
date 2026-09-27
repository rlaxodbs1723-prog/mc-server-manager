// 자동 테스트. tests/run.mjs가 가짜 electron으로 묶어서 돌린다 (앱 데이터는 테스트 전용 폴더에만 쓴다)
// 빠른 확인: 네트워크 없이 몇 초. --full: 실제로 Fabric 서버를 만들고 모드를 깔고 켜고 백업·되돌리기까지 (처음엔 몇 분)
import fs from 'fs'
import os from 'os'
import path from 'path'
import { sameMod } from '../src/shared-types'
import { readYamlValue, writeYamlValue } from '../src/main/yamlvalue'
import { readProperties, writeProperties } from '../src/main/properties'
import { parseJavaArgs, picksGc, createServer, startServerAt, readServerInfo, saveSettings, getSettings, duplicateServer, resetWorld, changeVersion } from '../src/main/servers'
import { getLoaderVersions } from '../src/main/loaders'
import { acceptEula, getLog, getState, onServerEvent, stopServer } from '../src/main/runner'
import { runPreflight } from '../src/main/preflight'
import { listDir, readConfigFile, writeConfigFile } from '../src/main/configfiles'
import * as datapacks from '../src/main/datapacks'
import type { CrashAnalysis } from '../src/shared-types'
import yazl from 'yazl'
import * as mods from '../src/main/mods'
import { hasCurseForgeKey } from '../src/main/curseforge'
import { createBackup, listBackups, restoreBackup } from '../src/main/backup'
import { analyzeCrash } from '../src/main/crash'

const full = process.argv.includes('--full')
let passed = 0
const failed: string[] = []

async function check(name: string, fn: () => unknown | Promise<unknown>): Promise<boolean> {
  const t = Date.now()
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name} (${((Date.now() - t) / 1000).toFixed(1)}초)`)
    return true
  } catch (e) {
    failed.push(name)
    console.log(`  ✗ ${name}\n      ${e instanceof Error ? e.message : e}`)
    return false
  }
}
function expect(ok: unknown, msg: string): void {
  if (!ok) throw new Error(msg)
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
async function waitFor(what: string, cond: () => boolean, maxMs: number): Promise<void> {
  const end = Date.now() + maxMs
  while (!cond()) {
    if (Date.now() > end) throw new Error(`${what}: ${Math.round(maxMs / 1000)}초 안에 안 됐어요`)
    await sleep(500)
  }
}

async function quick(): Promise<void> {
  console.log('\n[빠른 확인]')
  await check('자바 옵션: 막아야 할 것은 막는다', () => {
    expect(parseJavaArgs('-XX:+UseZGC -Dfoo=1').length === 2, '정상 옵션이 빠졌어요')
    for (const bad of ['-Xmx4G', '-jar x.jar', '-cp a', 'hello', '-XX:MaxHeapSize=1g']) {
      let threw = false
      try {
        parseJavaArgs(bad)
      } catch {
        threw = true
      }
      expect(threw, `"${bad}"를 막지 않았어요`)
    }
  })
  await check('자바 옵션: GC를 고르면 Aikar 옵션을 빼야 한다고 안다', () => {
    expect(picksGc(['-XX:+UseZGC']), 'ZGC를 못 알아봤어요')
    expect(!picksGc(['-Dfoo=1']), 'GC가 아닌데 GC라고 했어요')
  })
  await check('YAML: 주석·줄바꿈(CRLF)을 지키며 값만 바꾼다', () => {
    const text = '# 설명\r\nsettings:\r\n  # 안쪽 설명\r\n  max-players: 20\r\n  motd: hi\r\n'
    expect(readYamlValue(text, ['settings', 'max-players']) === '20', '값을 못 읽었어요')
    const out = writeYamlValue(text, ['settings', 'max-players'], '50')
    expect(out === text.replace('20', '50'), '값 말고 다른 곳도 바뀌었어요')
  })
  await check('server.properties: 읽고 쓰기, 모르는 줄은 그대로', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcsm-prop-'))
    fs.writeFileSync(path.join(dir, 'server.properties'), '#Minecraft server properties\nmotd=A\\u00E9\nserver-port=25565\nweird line\n')
    writeProperties(dir, { 'server-port': '25570', pvp: 'false' })
    const p = readProperties(dir)
    expect(p['server-port'] === '25570' && p.pvp === 'false' && p.motd === 'Aé', `읽은 값이 달라요: ${JSON.stringify(p)}`)
    expect(fs.readFileSync(path.join(dir, 'server.properties'), 'utf8').includes('weird line'), '모르는 줄이 사라졌어요')
    fs.rmSync(dir, { recursive: true, force: true })
  })
  await check('같은 모드 판단: 이름+제작자가 같아야 같은 모드', () => {
    expect(sameMod({ title: 'Cloth Config API', author: 'shedaniel' }, { title: 'Cloth Config API (Fabric/Forge)', author: 'shedaniel' }), '로더 표시만 다른 같은 모드를 다르다고 했어요')
    expect(!sameMod({ title: 'Cloth Config API', author: 'shedaniel' }, { title: 'Cloth Config API', author: 'someone' }), '제작자가 다른데 같다고 했어요')
  })
  await check('튕김 분석: 메모리 부족을 알아본다', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcsm-crash-'))
    const a = analyzeCrash(dir, ['[Server thread/ERROR]: Encountered an unexpected exception', 'java.lang.OutOfMemoryError: Java heap space'], Date.now())
    expect(/메모리/.test(a.title + a.cause), `원인이 메모리가 아니에요: ${a.title}`)
    fs.rmSync(dir, { recursive: true, force: true })
  })
}

// ---------- 실제 서버 ----------
// 가짜 Fabric 모드 jar를 만든다 (서버에 안 맞는 모드·필요한 모드가 빠진 모드 흉내)
function fakeFabricMod(file: string, meta: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile()
    zip.addBuffer(Buffer.from(JSON.stringify({ schemaVersion: 1, version: '1.0.0', ...meta })), 'fabric.mod.json')
    zip.outputStream.pipe(fs.createWriteStream(file)).on('close', () => resolve()).on('error', reject)
    zip.end()
  })
}

// 켜기 → 다 켜질 때까지 기다리고, 안 켜지면 마지막 로그를 보여 준다
async function startAndWait(folder: string): Promise<void> {
  await startServerAt(folder, () => undefined)
  await waitFor('서버 켜기', () => getState(folder) === 'running' || getState(folder) === 'stopped', 10 * 60_000)
  expect(getState(folder) === 'running', `켜지지 않았어요. 마지막 로그:\n${getLog(folder).slice(-15).join('\n')}`)
}
async function stopAndWait(folder: string): Promise<void> {
  stopServer(folder)
  await waitFor('서버 끄기', () => getState(folder) === 'stopped', 3 * 60_000)
}

const MC = '1.21.1'
const LITHIUM = 'gvQqBUqZ' // Modrinth: 서버에서 쓰는 모드
const SODIUM = 'AANobbMI' // Modrinth: 게임 화면 전용 모드 (서버에 깔면 안 된다)

async function real(): Promise<void> {
  console.log(`\n[실제 서버: Fabric ${MC}] 처음에는 Java·서버 파일을 받느라 몇 분 걸려요`)
  let folder = ''
  const ok = await check('서버 만들기', async () => {
    const loader = (await getLoaderVersions('fabric', MC)).find((v) => v.stable)
    expect(loader, 'Fabric 로더 버전을 못 찾았어요')
    const info = await createServer({ name: '자동 테스트', software: 'fabric', mcVersion: MC, loaderVersion: loader!.version, properties: { 'server-port': '25599' } }, () => undefined)
    folder = info.folderPath
    expect(fs.existsSync(folder), '서버 폴더가 없어요')
    acceptEula(folder)
  })
  if (!ok) return

  await check('기본 모드(Fabric API) 설치', async () => {
    await mods.installBaseMods(folder, true)
    // 기본 모드는 모드 목록에 안 보이므로 파일로 확인한다
    expect(fs.readdirSync(path.join(folder, 'mods')).some((f) => /^fabric-api-.*\.jar$/.test(f)), 'Fabric API 파일이 없어요')
    expect(!mods.list(folder).some((m) => /^fabric-api-/.test(m.fileName)), '기본 모드가 목록에 보여요')
  })
  await check('모드 검색 (Modrinth)', async () => {
    const r = await mods.search(folder, 'lithium', 0, 'modrinth')
    expect(r.hits.some((h) => h.projectId === LITHIUM), '검색에 Lithium이 안 나와요')
  })
  if (hasCurseForgeKey())
    await check('모드 검색 (CurseForge)', async () => {
      const r = await mods.search(folder, 'jei', 0, 'curseforge')
      expect(r.hits.length > 0 && r.hits.every((h) => h.projectId.startsWith('cf:')), 'CurseForge 결과가 없거나 다른 사이트 결과가 섞였어요')
    })
  else console.log('  - CurseForge 검색은 건너뜀 (.env에 키 없음)')
  await check('모드 설치 (Lithium)', async () => {
    const r = await mods.install(folder, LITHIUM)
    expect(r.failed.length === 0, `실패: ${r.failed.join(', ')}`)
    expect(mods.list(folder).some((m) => /lithium/i.test(m.fileName) && m.enabled), '설치된 모드 목록에 없어요')
  })
  await check('게임 화면 전용 모드(Sodium)는 서버에 안 깐다', async () => {
    let threw = false
    try {
      await mods.install(folder, SODIUM)
    } catch {
      threw = true
    }
    expect(threw, '서버에 깔려 버렸어요')
    expect(!mods.list(folder).some((m) => /sodium/i.test(m.fileName)), '파일이 남아 있어요')
  })

  await check('설정 저장: 자바 옵션(ZGC) + 최적화 + 서버 설정', () => {
    // 전에 "최적화 옵션 + 사용자가 고른 GC"를 같이 넣어서 자바가 안 켜지던 문제는 아래 켜기에서 같이 확인된다
    saveSettings(folder, { javaArgs: '-XX:+UseZGC', optimizeFlags: true, memoryMb: 2048, properties: { motd: '자동 테스트 서버', 'max-players': '7' } })
    expect(getSettings(folder).javaArgs === '-XX:+UseZGC', '자바 옵션이 저장되지 않았어요')
    const p = readProperties(folder)
    expect(p.motd === '자동 테스트 서버' && p['max-players'] === '7', '서버 설정이 저장되지 않았어요')
  })
  const started = await check('서버 켜기 → 다 켜질 때까지 (ZGC + 최적화 옵션으로)', async () => {
    await startAndWait(folder)
    expect(getLog(folder).some((l) => /lithium/i.test(l)), '로그에 Lithium이 안 보여요 (모드가 안 읽혔어요)')
  })
  if (started) {
    await check('켜진 채로 백업', async () => {
      const b = await createBackup(folder)
      expect(b.worlds.length > 0, '월드가 백업되지 않았어요')
    })
    await check('서버 끄기', () => stopAndWait(folder))
  }
  await check('백업으로 되돌리기 (지금 월드도 먼저 백업)', async () => {
    const world = path.join(folder, 'world')
    expect(fs.existsSync(world), '월드 폴더가 없어요')
    const target = listBackups(folder)[0]
    expect(target, '되돌릴 백업이 없어요')
    fs.writeFileSync(path.join(world, 'marker.txt'), '되돌리면 사라져야 함')
    await restoreBackup(folder, target.id)
    expect(!fs.existsSync(path.join(world, 'marker.txt')), '되돌렸는데 월드가 그대로예요')
    expect(listBackups(folder).some((b) => b.note === '되돌리기 전'), '"되돌리기 전" 백업이 없어요')
    expect(fs.existsSync(path.join(world, 'level.dat')), '되돌린 월드가 깨졌어요 (level.dat 없음)')
  })
  await check('서버 정보가 그대로 남아 있다', () => {
    const info = readServerInfo(folder)
    expect(info.software === 'fabric' && info.mcVersion === MC, '서버 정보가 바뀌었어요')
  })
  await check('설정 파일 탐색기: 목록·읽기·쓰기, 다른 곳에서 바뀌면 덮어쓰지 않기', () => {
    expect(listDir(folder, '').some((e) => e.name === 'server.properties'), '목록에 server.properties가 없어요')
    expect(!listDir(folder, '').some((e) => e.name.startsWith('.server-manager')), '앱 파일이 목록에 보여요')
    expect(listDir(folder, 'config').length > 0, 'config 폴더가 비었어요')
    const { text, modified } = readConfigFile(folder, 'server.properties')
    const next = writeConfigFile(folder, 'server.properties', text.replace(/max-players=\d+/, 'max-players=9'), modified)
    expect(readProperties(folder)['max-players'] === '9', '저장이 안 됐어요')
    let threw = false
    try {
      writeConfigFile(folder, 'server.properties', text, next - 10_000) // 연 시각이 오래됨 = 그사이 바뀜
    } catch {
      threw = true
    }
    expect(threw, '다른 곳에서 바뀐 파일을 덮어썼어요')
  })
  await check('모드 끄기·켜기', () => {
    const f = mods.list(folder).find((m) => /lithium/i.test(m.fileName))!
    mods.setEnabled(folder, f.fileName, false)
    expect(mods.list(folder).some((m) => /lithium/i.test(m.fileName) && !m.enabled), '꺼지지 않았어요')
    mods.setEnabled(folder, f.fileName, true)
    expect(mods.list(folder).some((m) => /lithium/i.test(m.fileName) && m.enabled), '다시 켜지지 않았어요')
  })
  await check('데이터팩 검색·설치', async () => {
    const r = await datapacks.search(folder, 'terralith', 0, 'modrinth')
    expect(r.hits[0], '데이터팩 검색 결과가 없어요')
    await datapacks.install(folder, r.hits[0].projectId)
    expect(datapacks.list(folder).length > 0, '설치된 데이터팩이 없어요')
  })
  await check('서버에 안 맞는 모드: 켜기 전에 끌지 물어본다 (바로 끄지 않음)', async () => {
    const jar = path.join(folder, 'mods', 'test-clientonly.jar')
    await fakeFabricMod(jar, { id: 'testclientonly', name: 'Test Client Only', environment: 'client' })
    const pf = await runPreflight(folder)
    expect(pf.askOff, '물어보지 않았어요')
    expect(fs.existsSync(jar), '묻기 전에 꺼 버렸어요')
    expect(mods.offSuggestions(folder).some((x) => x.fileName === 'test-clientonly.jar'), '끌 후보에 없어요')
    await mods.applyOffSuggestions(folder, ['test-clientonly.jar'])
    expect(!fs.existsSync(jar) && fs.existsSync(jar + '.disabled'), '"끄기"를 골랐는데 안 꺼졌어요')
    fs.rmSync(jar + '.disabled', { force: true })
  })
  await check('필요한 모드가 빠졌을 때: 켜기 전 확인 + 튕김 원인 분석', async () => {
    const jar = path.join(folder, 'mods', 'test-needsdep.jar')
    await fakeFabricMod(jar, { id: 'testneedsdep', name: 'Test Needs Dep', depends: { fabricloader: '*', nonexistentmodxyz: '*' } })
    const pf = await runPreflight(folder)
    expect(pf.missing.some((m) => m.needs.includes('nonexistentmodxyz')), `켜기 전 확인이 빠진 모드를 못 찾았어요: ${JSON.stringify(pf.missing)}`)
    // 그래도 켜면 튕기고, 원인이 "빠진 모드"로 나와야 한다
    let analysis: CrashAnalysis | undefined
    const off = onServerEvent((e) => {
      if (e.type === 'crashed' && e.folderPath === folder) analysis = e.analysis
    })
    try {
      await startServerAt(folder, () => undefined)
      await waitFor('튕김 알림', () => analysis != null, 5 * 60_000)
    } finally {
      off()
    }
    const a = analysis as CrashAnalysis | undefined
    expect(a?.deps.some((d) => d.id === 'nonexistentmodxyz' && d.missing), `원인 분석에 빠진 모드가 없어요: ${a?.title}`)
    await sleep(1000)
    expect(getState(folder) === 'stopped', '켜지는 중에 튕겼는데 다시 켜려고 해요')
    fs.rmSync(jar, { force: true })
  })
  await check('서버 복제 (월드·모드 포함, session.lock 제외)', async () => {
    const copy = await duplicateServer(folder, '자동 테스트 복제')
    expect(fs.existsSync(path.join(copy.folderPath, 'world', 'level.dat')), '월드가 복사되지 않았어요')
    expect(fs.readdirSync(path.join(copy.folderPath, 'mods')).some((f) => /lithium/i.test(f)), '모드가 복사되지 않았어요')
    expect(!fs.existsSync(path.join(copy.folderPath, 'world', 'session.lock')), 'session.lock이 복사됐어요')
  })
  await check('월드 새로 만들기 (먼저 백업)', async () => {
    await resetWorld(folder)
    expect(!fs.existsSync(path.join(folder, 'world')), '월드가 남아 있어요')
    expect(listBackups(folder).some((b) => b.note === '월드 리셋 전'), '"월드 리셋 전" 백업이 없어요')
  })
  const NEXT = '1.21.4'
  await check(`버전 바꾸기 ${MC} → ${NEXT} (모드도 새 버전에 맞추고 켜기)`, async () => {
    const loader = (await getLoaderVersions('fabric', NEXT)).find((v) => v.stable)!
    await changeVersion(folder, NEXT, loader.version, () => undefined)
    expect(readServerInfo(folder).mcVersion === NEXT, '버전 정보가 안 바뀌었어요')
    // 앱에서 켤 때처럼: 기본 모드를 새 버전에 맞추고, 설치한 모드를 업데이트한다
    await mods.refreshBaseMods(folder)
    const ups = await mods.checkUpdates(folder)
    expect(Object.keys(ups).some((f) => /lithium/i.test(f)), `Lithium 업데이트를 못 찾았어요: ${JSON.stringify(ups)}`)
    const r = await mods.updateMods(folder)
    expect(r.failed.length === 0, `업데이트 실패: ${r.failed.join(', ')}`)
    await startAndWait(folder)
    await stopAndWait(folder)
  })
}

async function paperServer(): Promise<void> {
  console.log(`\n[실제 서버: Paper ${MC}]`)
  let folder = ''
  const ok = await check('Paper 서버 만들기', async () => {
    const build = (await getLoaderVersions('paper', MC))[0]
    expect(build, 'Paper 빌드를 못 찾았어요')
    const info = await createServer({ name: '자동 테스트 페이퍼', software: 'paper', mcVersion: MC, loaderVersion: build.version, properties: { 'server-port': '25598' } }, () => undefined)
    folder = info.folderPath
    acceptEula(folder)
  })
  if (!ok) return
  await check('플러그인 검색·설치 (LuckPerms)', async () => {
    const r = await mods.search(folder, 'luckperms', 0, 'modrinth')
    const hit = r.hits.find((h) => /luckperms/i.test(h.title))
    expect(hit, '검색에 LuckPerms가 안 나와요')
    const res = await mods.install(folder, hit!.projectId)
    expect(res.failed.length === 0 && fs.readdirSync(path.join(folder, 'plugins')).some((f) => /luckperms/i.test(f)), '플러그인이 설치되지 않았어요')
  })
  await check('Paper 켜기·끄기 (플러그인이 읽히는지)', async () => {
    await startAndWait(folder)
    expect(getLog(folder).some((l) => /LuckPerms/i.test(l)), '로그에 LuckPerms가 안 보여요')
    await stopAndWait(folder)
  })
}

async function main(): Promise<void> {
  const t = Date.now()
  await quick()
  if (full) {
    await real()
    await paperServer()
  }
  else console.log('\n(실제 서버 테스트는 npm run test:full)')
  console.log(`\n결과: ${passed}개 통과, ${failed.length}개 실패 (${Math.round((Date.now() - t) / 1000)}초)`)
  if (failed.length) console.log(`실패: ${failed.join(' / ')}`)
  process.exit(failed.length ? 1 : 0)
}
void main()
