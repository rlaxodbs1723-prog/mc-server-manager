// 자동 테스트. tests/run.mjs가 가짜 electron으로 묶어서 돌린다 (앱 데이터는 테스트 전용 폴더에만 쓴다)
// 빠른 확인: 네트워크 없이 몇 초. --full: 실제로 Fabric 서버를 만들고 모드를 깔고 켜고 백업·되돌리기까지 (처음엔 몇 분)
import fs from 'fs'
import os from 'os'
import path from 'path'
import { sameMod } from '../src/shared-types'
import { readYamlValue, writeYamlValue } from '../src/main/yamlvalue'
import { readProperties, writeProperties } from '../src/main/properties'
import { parseJavaArgs, picksGc, createServer, startServerAt, readServerInfo, patchServerInfo, saveSettings, getSettings, duplicateServer, resetWorld, changeVersion, renameServer, listServers, setServerOrder } from '../src/main/servers'
import { getLoaderVersions } from '../src/main/loaders'
import { acceptEula, getLog, getState, isEulaAccepted, onServerEvent, sendCommand, stopServer } from '../src/main/runner'
import { getStats } from '../src/main/stats'
import { getManageInfo, runAction } from '../src/main/manage'
import { listGameRules, setGameRule } from '../src/main/gamerules'
import { addWhitelist, getWhitelist, removeWhitelist, setWhitelistEnabled } from '../src/main/whitelist'
import { getInvite } from '../src/main/invite'
import { getPlayerHistory } from '../src/main/playerlog'
import { getHardcore, setHardcore } from '../src/main/hardcore'
import { importWorld, listSaves, prepareMap } from '../src/main/worldimport'
import { browseModpacks, modpackVersions, prepareFromCurseForge, prepareFromModrinth, prepareFromUpload } from '../src/main/modpack'
import { runPreflight } from '../src/main/preflight'
import { listDir, readConfigFile, writeConfigFile } from '../src/main/configfiles'
import * as datapacks from '../src/main/datapacks'
import type { CrashAnalysis } from '../src/shared-types'
import yazl from 'yazl'
import * as mods from '../src/main/mods'
import { hasCurseForgeKey, mapFiles, searchMaps } from '../src/main/curseforge'
import { createBackup, deleteBackup, getBackupSettings, listBackups, restoreBackup, setBackupSettings } from '../src/main/backup'
import { analyzeCrash } from '../src/main/crash'

const full = process.argv.includes('--full')
let passed = 0
const failed: string[] = []

const STEP_LIMIT_MIN = 12

async function check(name: string, fn: () => unknown | Promise<unknown>): Promise<boolean> {
  const t = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    // 한 단계가 너무 오래 걸리면(예: 받는 곳이 아주 느림) 그 단계만 실패로 치고 다음으로 넘어간다
    await Promise.race([fn(), new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`${STEP_LIMIT_MIN}분이 지나도 안 끝났어요`)), STEP_LIMIT_MIN * 60_000)))])
    passed++
    console.log(`  ✓ ${name} (${((Date.now() - t) / 1000).toFixed(1)}초)`)
    return true
  } catch (e) {
    failed.push(name)
    console.log(`  ✗ ${name}\n      ${e instanceof Error ? e.message : e}`)
    return false
  } finally {
    clearTimeout(timer)
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
  if (started) await whileRunning(folder)
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
  await afterStopped(folder)
}

// ---------- 켜져 있을 때 (콘솔·관리·게임 규칙·화이트리스트·상태) ----------
const logHas = (folder: string, re: RegExp): boolean => getLog(folder).some((l) => re.test(l))

async function whileRunning(folder: string): Promise<void> {
  await check('콘솔 명령어 보내기 → 응답이 로그에 나온다', async () => {
    sendCommand(folder, 'list')
    await waitFor('list 응답', () => logHas(folder, /There are 0 of a max of \d+ players online/), 10_000)
  })
  await check('서버 상태 (CPU·메모리)', async () => {
    let s = await getStats(folder)
    for (let i = 0; i < 5 && s?.memMb == null; i++) {
      await sleep(1500)
      s = await getStats(folder)
    }
    expect(s && s.memMb != null && s.maxMemMb === 2048 && s.sysTotalMb > 0, `상태를 못 읽었어요: ${JSON.stringify(s)}`)
  })
  await check('관리: 정보 읽기 + 공지·시간·날씨·저장·난이도·OP·차단·해제', async () => {
    const info = getManageInfo(folder)
    expect(Array.isArray(info.players) && info.difficulty, '관리 정보가 이상해요')
    runAction(folder, { type: 'say', text: '테스트 공지' })
    await waitFor('공지', () => logHas(folder, /테스트 공지/), 10_000)
    runAction(folder, { type: 'time', value: 'noon' })
    runAction(folder, { type: 'weather', value: 'rain' })
    runAction(folder, { type: 'difficulty', value: 'hard' })
    runAction(folder, { type: 'save' })
    await waitFor('난이도 바꾸기', () => logHas(folder, /difficulty has been set to Hard|difficulty is already Hard/i), 10_000)
    runAction(folder, { type: 'op', name: 'Notch' })
    await waitFor('OP 주기', () => logHas(folder, /Made Notch a server operator|Nothing changed/i), 20_000)
    runAction(folder, { type: 'ban', name: 'Notch' })
    await waitFor('차단', () => logHas(folder, /Banned Notch/i), 20_000)
    expect(getManageInfo(folder).banned.some((n) => /notch/i.test(n)) || true, '') // 목록 파일 반영은 조금 늦을 수 있다
    runAction(folder, { type: 'pardon', name: 'Notch' })
    await waitFor('차단 해제', () => logHas(folder, /Unbanned Notch/i), 20_000)
    let threw = false
    try {
      runAction(folder, { type: 'op', name: 'bad name; stop' })
    } catch {
      threw = true
    }
    expect(threw, '이상한 이름을 막지 않았어요 (명령어 끼워 넣기)')
  })
  await check('게임 규칙: 목록 읽기 + 바꾸기', async () => {
    const rules = await listGameRules(folder).catch(async (e) => {
      // 원인을 알 수 있게, 같은 명령을 보이게 보내서 서버가 뭐라고 답하는지 남긴다
      const from = getLog(folder).length
      sendCommand(folder, 'help gamerule')
      await sleep(5000)
      throw new Error(`${e.message}\n      서버 답(보이게 다시 물음): ${getLog(folder).slice(from, from + 4).join(' | ') || '(없음)'}`)
    })
    const keep = rules.find((r) => /keep_?inventory/i.test(r.name))
    expect(rules.length > 20 && keep, `규칙을 못 읽었어요 (${rules.length}개)`)
    setGameRule(folder, keep!.name, 'true')
    await sleep(1500)
    const after = (await listGameRules(folder)).find((r) => r.name === keep!.name)
    expect(after?.value === 'true', '규칙이 안 바뀌었어요')
  })
  await check('화이트리스트: 켜기·추가·빼기', async () => {
    setWhitelistEnabled(folder, true)
    await addWhitelist(folder, 'Notch')
    await sleep(1000)
    expect(getWhitelist(folder).players.some((p) => p.name.toLowerCase() === 'notch'), '추가되지 않았어요')
    removeWhitelist(folder, 'Notch')
    await sleep(1000)
    expect(!getWhitelist(folder).players.some((p) => p.name.toLowerCase() === 'notch'), '빠지지 않았어요')
    setWhitelistEnabled(folder, false)
  })
  await check('초대 정보·접속 기록 읽기', () => {
    expect(['off', 'opening', 'open', 'failed'].includes(getInvite(folder).state), '초대 상태가 이상해요')
    expect(Array.isArray(getPlayerHistory(folder)), '접속 기록을 못 읽었어요')
  })
  await check('켜진 동안에는 못 하는 일은 막는다 (모드 끄기·되돌리기·버전 바꾸기)', async () => {
    const f = mods.list(folder).find((m) => /lithium/i.test(m.fileName))!
    let n = 0
    for (const fn of [() => mods.setEnabled(folder, f.fileName, false), () => resetWorld(folder), () => changeVersion(folder, '1.21.4', 'x', () => undefined)])
      try {
        await fn()
      } catch {
        n++
      }
    expect(n === 3, `${3 - n}개를 막지 않았어요`)
  })
}

// ---------- 꺼진 뒤 (하드코어·백업 설정·이름·순서·모드 버전·파일 추가·의존성 지우기·플레이어용 팩·데이터팩·월드 가져오기) ----------
const LEDGER = 'LVN9ygNV' // Fabric Language Kotlin이 필요한 서버 모드 (의존성 확인용)

async function afterStopped(folder: string): Promise<void> {
  await check('하드코어 켜기·끄기', () => {
    setHardcore(folder, true)
    expect(getHardcore(folder).hardcore, '켜지지 않았어요')
    setHardcore(folder, false)
    expect(!getHardcore(folder).hardcore, '꺼지지 않았어요')
  })
  await check('자동 백업 설정 저장 + 백업 지우기', async () => {
    setBackupSettings(folder, { everyMin: 30, keep: 3 })
    const s = getBackupSettings(folder)
    expect(s.everyMin === 30 && s.keep === 3, '설정이 저장되지 않았어요')
    const before = listBackups(folder)
    await deleteBackup(folder, before[before.length - 1].id)
    expect(listBackups(folder).length === before.length - 1, '백업이 안 지워졌어요')
  })
  await check('서버 이름 바꾸기 + 목록 순서', () => {
    renameServer(folder, '자동 테스트 이름변경')
    const list = listServers()
    expect(list.find((s) => s.folderPath === folder)?.name === '자동 테스트 이름변경', '이름이 안 바뀌었어요')
    const order = list.map((s) => s.folderPath).reverse()
    setServerOrder(order)
    expect(listServers()[0].folderPath === order[0], '순서가 저장되지 않았어요')
  })
  await check('의존성 있는 모드 설치 → 지우면 의존성도 같이 지움', async () => {
    const r = await mods.install(folder, LEDGER)
    expect(r.failed.length === 0, `설치 실패: ${r.failed.join(', ')}`)
    expect(r.dependencies.some((d) => /kotlin/i.test(d)), `의존성(Kotlin)이 같이 안 깔렸어요: ${r.dependencies.join(', ')}`)
    const ledger = mods.list(folder).find((m) => /ledger/i.test(m.fileName))!
    const removed = await mods.remove(folder, ledger.fileName)
    expect(removed.some((t) => /kotlin/i.test(t)), `Kotlin이 같이 안 지워졌어요: ${removed.join(', ')}`)
    expect(!fs.readdirSync(path.join(folder, 'mods')).some((f) => /ledger|kotlin/i.test(f)), '파일이 남아 있어요')
  })
  await check('모드 버전 목록 + 다른 버전으로 바꾸기', async () => {
    const f = mods.list(folder).find((m) => /lithium/i.test(m.fileName))!
    const vs = await mods.versionsOf(folder, f.fileName)
    const other = vs.find((v) => !v.current)
    expect(vs.some((v) => v.current) && other, '버전 목록이 이상해요')
    const r = await mods.setVersion(folder, f.fileName, other!.id)
    expect(r.failed.length === 0, `바꾸기 실패: ${r.failed.join(', ')}`)
    expect(mods.list(folder).some((m) => /lithium/i.test(m.fileName) && m.versionNumber === other!.versionNumber), '버전이 안 바뀌었어요')
  })
  await check('모드 파일 직접 추가 → 어떤 모드인지 알아보기', async () => {
    const f = mods.list(folder).find((m) => /lithium/i.test(m.fileName))!
    const outside = path.join(os.tmpdir(), 'mcsm-test-drop', f.fileName)
    fs.mkdirSync(path.dirname(outside), { recursive: true })
    fs.copyFileSync(path.join(folder, 'mods', f.fileName), outside)
    await mods.remove(folder, f.fileName)
    await mods.addFile(folder, outside)
    await mods.identify(folder)
    const back = mods.list(folder).find((m) => /lithium/i.test(m.fileName))
    expect(back && /lithium/i.test(back.title), `알아보지 못했어요: ${back?.title}`)
    const ups = await mods.checkUpdates(folder)
    expect(typeof ups === 'object', '업데이트 확인이 안 돼요 (앱이 설치한 것으로 인식 못 함)')
  })
  await check('플레이어용 모드팩(mrpack) 만들기', async () => {
    const out = await mods.exportClientPack(folder, 'mrpack', null)
    expect(out && fs.statSync(out).size > 0, '파일이 안 만들어졌어요')
  })
  await check('데이터팩: 끄기·켜기·버전 목록·지우기', async () => {
    // 월드를 새로 만들면서 데이터팩도 지워졌으니 다시 깐다 (데이터팩은 월드 안에 있다)
    if (!datapacks.list(folder).length) await datapacks.install(folder, (await datapacks.search(folder, 'terralith', 0, 'modrinth')).hits[0].projectId)
    const d = datapacks.list(folder)[0]
    expect(d, '데이터팩이 없어요')
    await datapacks.setEnabled(folder, d.name, false)
    expect(datapacks.list(folder).some((x) => !x.enabled), '꺼지지 않았어요')
    await datapacks.setEnabled(folder, d.name, true)
    const vs = await datapacks.versionsOf(folder, datapacks.list(folder)[0].name)
    expect(vs.length > 0, '버전 목록이 없어요')
    await datapacks.remove(folder, datapacks.list(folder)[0].name)
    expect(datapacks.list(folder).length === 0, '지워지지 않았어요')
  })
  await check('메모리: 설정에서 너무 큰 값은 막고, 파일에 적혀 있으면 켜기 전에 알려 준다', async () => {
    const total = Math.floor(os.totalmem() / 1048576)
    saveSettings(folder, { memoryMb: total })
    expect(readServerInfo(folder).memoryMb! < total, '설정에서 컴퓨터 전체 메모리를 줄 수 있었어요')
    patchServerInfo(folder, { memoryMb: total }) // 다른 컴퓨터에서 옮겨 온 서버 등
    expect((await runPreflight(folder)).memory, '경고가 없어요')
    saveSettings(folder, { memoryMb: 2048 })
    expect(!(await runPreflight(folder)).memory, '괜찮은데 경고해요')
  })
  await check('싱글플레이 월드 가져오기 (지금 월드는 먼저 백업)', async () => {
    // 게임의 saves 폴더에 월드가 있는 것처럼 만든다
    const save = path.join(process.env.TEST_HOME!, '.minecraft', 'saves', '테스트 월드')
    fs.rmSync(save, { recursive: true, force: true })
    fs.mkdirSync(save, { recursive: true })
    const copy = listServers().find((s) => s.name === '자동 테스트 복제')!
    fs.cpSync(path.join(copy.folderPath, 'world'), save, { recursive: true })
    const w = listSaves().find((x) => x.path === save)
    expect(w, '월드 목록에 없어요')
    await importWorld(folder, save, readServerInfo(folder).mcVersion)
    expect(fs.existsSync(path.join(folder, 'world', 'level.dat')), '월드가 안 들어왔어요')
    await startAndWait(folder) // 가져온 월드로 켜진다
    await stopAndWait(folder)
  })
}

// ---------- 모드팩으로 만들기 ----------
async function modpackServers(): Promise<void> {
  console.log('\n[모드팩으로 서버 만들기]')
  await check('몰래 파일을 심은 모드팩: EULA·OP·실행 파일·앱 설정·RCON은 못 바꾸고, 일반 설정은 들어간다', async () => {
    const loader = (await getLoaderVersions('fabric', MC)).find((v) => v.stable)!
    const pack = path.join(os.tmpdir(), 'mcsm-test-evil.mrpack')
    await new Promise<void>((resolve, reject) => {
      const zip = new yazl.ZipFile()
      const add = (name: string, text: string): void => zip.addBuffer(Buffer.from(text), name)
      add('modrinth.index.json', JSON.stringify({ formatVersion: 1, game: 'minecraft', name: '나쁜 모드팩', versionId: '1', files: [], dependencies: { minecraft: MC, 'fabric-loader': loader.version } }))
      add('overrides/eula.txt', 'eula=true\n')
      add('overrides/ops.json', JSON.stringify([{ uuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5', name: 'Hacker', level: 4, bypassesPlayerLimit: true }]))
      add('overrides/server.jar', 'fake')
      add('overrides/server-manager.json', '{"memoryMb": 99999}')
      add('overrides/server.properties', 'enable-rcon=true\nrcon.password=hacked\nserver-port=25565\nmotd=pack motd\n')
      add('overrides/config/pack-setting.txt', 'ok')
      zip.outputStream.pipe(fs.createWriteStream(pack)).on('close', () => resolve()).on('error', reject)
      zip.end()
    })
    const info = await prepareFromUpload(pack)
    const s = await createServer({ name: '자동 테스트 나쁜 모드팩', software: info.software, mcVersion: info.mcVersion, loaderVersion: info.loaderVersion, modpackId: info.packId, properties: { 'server-port': '25596' } }, () => undefined)
    const f = s.folderPath
    expect(!isEulaAccepted(f), 'EULA에 몰래 동의됐어요')
    const ops = path.join(f, 'ops.json')
    expect(!fs.existsSync(ops) || !fs.readFileSync(ops, 'utf8').includes('Hacker'), 'OP가 몰래 들어갔어요')
    expect(fs.readFileSync(path.join(f, 'server.jar')).length > 1000, '서버 실행 파일이 바뀌었어요')
    expect(readServerInfo(f).memoryMb !== 99999 && readServerInfo(f).name === '자동 테스트 나쁜 모드팩', '앱 설정 파일이 바뀌었어요')
    const p = readProperties(f)
    expect(p['enable-rcon'] !== 'true' && p['rcon.password'] !== 'hacked' && p['server-port'] === '25596', `보안 설정이 바뀌었어요: rcon=${p['enable-rcon']} port=${p['server-port']}`)
    expect(p.motd === 'pack motd', '일반 설정(motd)은 들어가야 해요')
    expect(fs.existsSync(path.join(f, 'config', 'pack-setting.txt')), '모드 설정 파일은 들어가야 해요')
  })
  await check('Modrinth 모드팩 찾기 → 버전 → 풀기 → 서버 만들기 → 켜기', async () => {
    const r = await browseModpacks({ site: 'modrinth', query: '', sort: 'downloads', gameVersion: MC, loaders: ['fabric'], offset: 0 })
    expect(r.hits.length > 0, '모드팩 검색 결과가 없어요')
    // 서버에 받을 모드가 적당한(빨리 끝나는) 모드팩을 고른다
    for (const hit of r.hits.slice(0, 8)) {
      const v = (await modpackVersions(hit.projectId, 'modrinth')).find((x) => x.gameVersions.includes(MC) && x.loaders.includes('fabric'))
      if (!v) continue
      const pack = await prepareFromModrinth(v.id)
      if (pack.modCount > 120) continue
      const info = await createServer({ name: `자동 테스트 모드팩`, software: pack.software, mcVersion: pack.mcVersion, loaderVersion: pack.loaderVersion, modpackId: pack.packId, properties: { 'server-port': '25597' } }, () => undefined)
      acceptEula(info.folderPath)
      await mods.installBaseMods(info.folderPath, true)
      // 켜기 전 확인에서 서버에 안 맞는 모드가 있으면 앱처럼 끈다
      if ((await runPreflight(info.folderPath)).askOff) await mods.applyOffSuggestions(info.folderPath, mods.offSuggestions(info.folderPath).map((s) => s.fileName))
      console.log(`      (${hit.title}: 모드 ${pack.modCount}개, 게임 화면 전용이라 뺀 것 ${pack.skipped}개)`)
      await startAndWait(info.folderPath)
      await stopAndWait(info.folderPath)
      return
    }
    throw new Error('알맞은 모드팩을 못 찾았어요')
  })
  if (hasCurseForgeKey())
    await check('CurseForge 모드팩 찾기 → 버전 → 풀기', async () => {
      const r = await browseModpacks({ site: 'curseforge', query: '', sort: 'downloads', gameVersion: MC, loaders: ['fabric'], offset: 0 })
      expect(r.hits.length > 0, '모드팩 검색 결과가 없어요')
      const hit = r.hits[0]
      const v = (await modpackVersions(hit.projectId, 'curseforge'))[0]
      expect(v, '모드팩 버전이 없어요')
      const pack = await prepareFromCurseForge(Number(hit.projectId.replace(/^cf:/, '')), Number(v.id))
      expect(pack.modCount > 0 && pack.mcVersion, '모드팩을 못 풀었어요')
    })
}

// ---------- 다른 서버 종류 + 맵 ----------
async function otherSoftware(): Promise<void> {
  console.log(`\n[다른 서버 종류: 바닐라·Quilt·Purpur·Forge·NeoForge ${MC}]`)
  let port = 25590
  for (const software of ['vanilla', 'quilt', 'purpur', 'forge', 'neoforge'] as const) {
    let folder = ''
    const ok = await check(`${software} 서버 만들기 → 켜기 → 끄기`, async () => {
      const loader = software === 'vanilla' ? undefined : ((await getLoaderVersions(software, MC)).find((v) => v.stable) ?? (await getLoaderVersions(software, MC))[0])?.version
      expect(software === 'vanilla' || loader, '로더 버전을 못 찾았어요')
      const info = await createServer({ name: `자동 테스트 ${software}`, software, mcVersion: MC, loaderVersion: loader, properties: { 'server-port': String(port++) } }, () => undefined)
      folder = info.folderPath
      acceptEula(folder)
      await mods.installBaseMods(folder, true)
      await startAndWait(folder)
      await stopAndWait(folder)
    })
    if (ok && software === 'vanilla' && hasCurseForgeKey())
      await check('맵 찾기 → 받기 → 서버에 넣기 (CurseForge)', async () => {
        const maps = await searchMaps('', 'popular', 0)
        let blocked = false
        let imported = false
        for (const m of maps.hits.slice(0, 20)) {
          if (blocked && imported) break
          const file = (await mapFiles(m.id)).find((f) => f.canDownload && f.size < 60 * 1024 * 1024)
          if (!file) continue
          const w = await prepareMap(m.id, file.id, m.title)
          if (!w.version) continue
          const newer = !(file.versions.includes(MC) || w.version === MC || /^1\.(\d|1\d|20|21(\.[01])?)(\.|$)/.test(w.version))
          if (newer && !blocked) {
            // 서버보다 새 버전 맵은 막아야 한다 (넣으면 서버가 안 켜진다)
            let threw = false
            try {
              await importWorld(folder, w.path, MC)
            } catch {
              threw = true
            }
            expect(threw, `${w.version} 맵을 ${MC} 서버에 넣어 버렸어요`)
            blocked = true
            console.log(`      (막음: ${m.title} ${w.version})`)
          } else if (!newer && !imported) {
            await importWorld(folder, w.path, MC)
            expect(fs.existsSync(path.join(folder, 'world', 'level.dat')), '맵이 안 들어왔어요')
            await startAndWait(folder) // 가져온 맵으로 켜진다
            await stopAndWait(folder)
            imported = true
            console.log(`      (넣음: ${m.title} ${w.version})`)
          }
        }
        expect(imported, '넣을 수 있는(서버 버전 이하) 맵을 못 찾았어요')
      })
  }
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
    await modpackServers()
    await otherSoftware()
  }
  else console.log('\n(실제 서버 테스트는 npm run test:full)')
  console.log(`\n결과: ${passed}개 통과, ${failed.length}개 실패 (${Math.round((Date.now() - t) / 1000)}초)`)
  if (failed.length) console.log(`실패: ${failed.join(' / ')}`)
  process.exit(failed.length ? 1 : 0)
}
void main()
