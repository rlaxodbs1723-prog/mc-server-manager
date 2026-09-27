// 자동 테스트. tests/run.mjs가 가짜 electron으로 묶어서 돌린다 (앱 데이터는 테스트 전용 폴더에만 쓴다)
// 빠른 확인: 네트워크 없이 몇 초. --full: 실제로 Fabric 서버를 만들고 모드를 깔고 켜고 백업·되돌리기까지 (처음엔 몇 분)
import fs from 'fs'
import os from 'os'
import path from 'path'
import { sameMod } from '../src/shared-types'
import { readYamlValue, writeYamlValue } from '../src/main/yamlvalue'
import { readProperties, writeProperties } from '../src/main/properties'
import { parseJavaArgs, picksGc, createServer, startServerAt, readServerInfo } from '../src/main/servers'
import { getLoaderVersions } from '../src/main/loaders'
import { acceptEula, getLog, getState, stopServer } from '../src/main/runner'
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

  const started = await check('서버 켜기 → 다 켜질 때까지', async () => {
    await startServerAt(folder, () => undefined)
    await waitFor('서버 켜기', () => getState(folder) === 'running' || getState(folder) === 'stopped', 10 * 60_000)
    expect(getState(folder) === 'running', `켜지지 않았어요. 마지막 로그:\n${getLog(folder).slice(-15).join('\n')}`)
    expect(getLog(folder).some((l) => /lithium/i.test(l)), '로그에 Lithium이 안 보여요 (모드가 안 읽혔어요)')
  })
  if (started) {
    await check('켜진 채로 백업', async () => {
      const b = await createBackup(folder)
      expect(b.worlds.length > 0, '월드가 백업되지 않았어요')
    })
    await check('서버 끄기', async () => {
      stopServer(folder)
      await waitFor('서버 끄기', () => getState(folder) === 'stopped', 3 * 60_000)
    })
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
}

async function main(): Promise<void> {
  const t = Date.now()
  await quick()
  if (full) await real()
  else console.log('\n(실제 서버 테스트는 npm run test:full)')
  console.log(`\n결과: ${passed}개 통과, ${failed.length}개 실패 (${Math.round((Date.now() - t) / 1000)}초)`)
  if (failed.length) console.log(`실패: ${failed.join(' / ')}`)
  process.exit(failed.length ? 1 : 0)
}
void main()
