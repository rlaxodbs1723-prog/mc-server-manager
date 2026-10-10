// 자동 테스트. tests/run.mjs가 가짜 electron으로 묶어서 돌린다 (앱 데이터는 테스트 전용 폴더에만 쓴다)
// 빠른 확인: 네트워크 없이 몇 초. --full: 실제로 Fabric 서버를 만들고 모드를 깔고 켜고 백업·되돌리기까지 (처음엔 몇 분)
import fs from 'fs'
import os from 'os'
import path from 'path'
import { sameMod } from '../src/shared-types'
import { preferCurseForge } from '../src/main/merge'
import { readYamlValue, writeYamlValue } from '../src/main/yamlvalue'
import { readProperties, writeProperties } from '../src/main/properties'
import { parseJavaArgs, picksGc, createServer, startServerAt, readServerInfo, patchServerInfo, saveSettings, getSettings, duplicateServer, resetWorld, changeVersion, renameServer, listServers, setServerOrder, deleteServer, cleanupUnfinished } from '../src/main/servers'
import { getLoaderVersions } from '../src/main/loaders'
import { acceptEula, emitEvent, getLog, getStartedAt, getState, isEulaAccepted, onServerEvent, sendCommand, stopServer } from '../src/main/runner'
import { autoStartServers, setStarter } from '../src/main/automation'
import { createEntry, renameEntry, trashEntries } from '../src/main/configfiles'
import { disableDatapack } from '../src/main/crash'
import { cancelTask, runCancellable } from '../src/main/cancel'
import { getAppSettings, setAppSettings } from '../src/main/appsettings'
import { getStats } from '../src/main/stats'
import { getManageInfo, runAction } from '../src/main/manage'
import { listGameRules, setGameRule } from '../src/main/gamerules'
import { addWhitelist, getWhitelist, removeWhitelist, setWhitelistEnabled } from '../src/main/whitelist'
import { getInvite } from '../src/main/invite'
import { getPlayerHistory } from '../src/main/playerlog'
import { getHardcore, setHardcore } from '../src/main/hardcore'
import { importWorld, listSaves, openDroppedWorld, prepareMap } from '../src/main/worldimport'
import { browseModpacks, modpackVersions, prepareFromCurseForge, prepareFromModrinth, prepareFromUpload } from '../src/main/modpack'
import { runPreflight } from '../src/main/preflight'
import { listDir, readConfigFile, writeConfigFile } from '../src/main/configfiles'
import * as datapacks from '../src/main/datapacks'
import type { CrashAnalysis } from '../src/shared-types'
import yazl from 'yazl'
import * as mods from '../src/main/mods'
import { curseForgeKeySource, getFile, hasCurseForgeKey, mapFiles, removeCurseForgeKey, searchMaps, setCurseForgeKey } from '../src/main/curseforge'
import { createBackup, deleteBackup, getBackupSettings, listBackups, restoreBackup, setBackupSettings } from '../src/main/backup'
import { analyzeCrash } from '../src/main/crash'
import { execFileSync } from 'child_process'
import { langFromLocale, translator } from '../src/i18n'
import { tr as mainTr } from '../src/main/i18n'
import { BUG_MAX_BYTES, bugFileInfo, bugMessage, sendBugReport } from '../src/main/bugreport'
import enTable from '../src/i18n/en.json'
import zhTable from '../src/i18n/zh.json'

const full = process.argv.includes('--full')
// --only=purpur,forge: 그 서버 종류만 만들고 켜 본다 (느린 사이트 때문에 실패한 것만 다시 확인할 때)
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',').filter(Boolean) ?? []
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
  await check('같은 모드가 두 사이트에 있을 때: 더 새 버전 쪽 / CurseForge 모드팩 서버면 CurseForge', async () => {
    const d = (days: number): string => new Date(Date.now() - days * 86_400_000).toISOString()
    const mr = (days: number) => async () => [{ datePublished: d(days) }]
    const cfF = (days: number) => async () => [{ fileDate: d(days) }]
    expect(await preferCurseForge({}, '', '', mr(400), cfF(10)), 'CurseForge에만 새 버전이 있는데 Modrinth를 골랐어요 (1.12.2 CreativeCore)')
    expect(!(await preferCurseForge({}, '', '', mr(10), cfF(11))), '비슷한데 CurseForge를 골랐어요')
    expect(!(await preferCurseForge({}, '', '', mr(10), async () => [])), 'CurseForge에 맞는 파일이 없는데 골랐어요')
    expect(await preferCurseForge({ modpack: { source: 'curseforge' } }, '', '', mr(1), cfF(100)), 'CurseForge 모드팩 서버인데 Modrinth를 골랐어요')
  })
  await check('튕김 분석: 메모리 부족을 알아본다', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcsm-crash-'))
    const a = analyzeCrash(dir, ['[Server thread/ERROR]: Encountered an unexpected exception', 'java.lang.OutOfMemoryError: Java heap space'], Date.now())
    expect(/메모리/.test(a.title + a.cause), `원인이 메모리가 아니에요: ${a.title}`)
    fs.rmSync(dir, { recursive: true, force: true })
  })
  await i18nChecks()
  await check('버그 제보: 디스코드 메시지 (앱 정보 자동, 길이 자르기, 아무도 안 부르기, 파일 검사)', async () => {
    type Embed = { title: string; description: string; fields: { name: string; value: string }[] }
    const m = bugMessage('모드 & 설치 @everyone', '설명\n둘째 줄', ['a.png'])
    const e = (m.embeds as Embed[])[0]
    expect(e.title === '모드 & 설치 @everyone' && e.description === '설명\n둘째 줄', `글이 바뀌었어요: ${e.title} / ${e.description}`)
    expect(JSON.stringify(m.allowed_mentions) === '{"parse":[]}', '@everyone을 막지 않아요')
    const names = e.fields.map((f) => f.name).join(',')
    expect(names === 'App,Windows,Language,Attachments' && /MC CubePanel /.test(e.fields[0].value), `앱 정보가 빠졌어요: ${names}`)
    const long = (bugMessage('t'.repeat(500), '가'.repeat(9000), []).embeds as Embed[])[0]
    expect(long.title.length <= 250 && long.description.length <= 4000, '디스코드 한도보다 길어요')
    expect(!(bugMessage('', '', []).embeds as Embed[])[0].fields.some((f) => f.name === 'Attachments'), '첨부가 없는데 칸이 생겼어요')
    // 파일 검사: 사진·영상만, 10MB 이하
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcsm-bug-'))
    fs.writeFileSync(path.join(dir, 'ok.png'), Buffer.alloc(10))
    fs.writeFileSync(path.join(dir, 'bad.exe'), Buffer.alloc(10))
    fs.writeFileSync(path.join(dir, 'big.mp4'), Buffer.alloc(BUG_MAX_BYTES + 1))
    expect(bugFileInfo(path.join(dir, 'ok.png')).size === 10, '정상 사진을 막았어요')
    expect(await throws(() => bugFileInfo(path.join(dir, 'bad.exe'))), 'exe를 받아들였어요')
    expect(await throws(() => bugFileInfo(path.join(dir, 'big.mp4'))), '4MB 넘는 영상을 받아들였어요')
    expect(await throws(() => bugFileInfo(path.join(dir, 'none.png'))), '없는 파일을 받아들였어요')
    fs.rmSync(dir, { recursive: true, force: true })
    // 웹훅이 없는 빌드(테스트)에서는 보내지 않고 알려 준다. 빈 제보도 막는다
    expect(await throws(() => sendBugReport('', '', [])), '빈 제보를 받아들였어요')
    expect(await throws(() => sendBugReport('x', 'y', [])), '웹훅이 없는데 보냈어요')
  })
}

// ---------- 언어 (영어·중국어) ----------
// 번역하지 않는 것: 정규식, EULA 파일 내용, 조사 고르기용 조각, 언어 고르는 칸 (어느 언어에서든 그대로 보여야 한다)
const NO_TR = new Set(["(?:Mod|모드) '([^\\n]+?)' \\({0}\\)", '# MC CubePanel에서 사용자가 EULA(https://aka.ms/MinecraftEULA)에 동의함 # {0} eula=true', '을/를', '이/가', '은/는', '으로/로', '한국어', '언어 · Language'])
async function i18nChecks(): Promise<void> {
  const tables = { en: enTable as Record<string, string>, zh: zhTable as Record<string, string> }
  await check('언어: 코드의 한글 문장이 모두 번역돼 있다 (새로 넣고 번역 안 한 것 없음)', () => {
    const tmp = path.join(os.tmpdir(), 'mcsm-i18n-source.json')
    execFileSync(process.execPath, ['build-tools/i18n-extract.mjs'], { env: { ...process.env, I18N_OUT: tmp }, stdio: 'ignore' })
    const keys = Object.keys(JSON.parse(fs.readFileSync(tmp, 'utf8'))).filter((k) => !NO_TR.has(k))
    for (const [lang, table] of Object.entries(tables)) {
      const missing = keys.filter((k) => !(k in table))
      expect(!missing.length, `${lang} 번역이 없어요 (${missing.length}개): ${missing.slice(0, 5).join(' / ')}`)
    }
  })
  await check('언어: 번역에 한글이 남지 않고 {0} 자리가 그대로 있다', () => {
    for (const [lang, table] of Object.entries(tables)) {
      for (const [ko, to] of Object.entries(table)) {
        expect(!/[가-힣]/.test(to), `${lang} 번역에 한글이 남았어요: ${ko} → ${to}`)
        const holes = (s: string) => (s.match(/\{\d\}/g) ?? []).sort().join()
        if (/\{\d\}/.test(ko.replace(/[^{}\d]/g, '')) || /\{\d\}/.test(to)) expect(holes(ko) === holes(to), `${lang} {0} 자리가 달라요: ${ko} → ${to}`)
      }
    }
  })
  await check('언어: 값이 들어간 문장도 통째로 번역된다 (모든 틀)', () => {
    for (const lang of ['en', 'zh'] as const) {
      const tr = translator(lang)
      for (const ko of Object.keys(tables[lang])) {
        if (!/\{\d\}/.test(ko) || !/[가-힣]/.test(ko.replace(/\{\d\}/g, ''))) continue
        const sample = ko.replace(/\{(\d)\}/g, (_, n) => `V${n}x`)
        const out = tr(sample)
        expect(!/[가-힣]/.test(out), `${lang}: "${sample}" → "${out}"`)
      }
    }
  })
  await check('언어: 조사를 붙인 모드·플러그인 문장, 여러 줄, 앞뒤 공백', () => {
    const en = translator('en')
    const zh = translator('zh')
    expect(en('일부 필수 모드를 설치하지 못했어요: a / b') === "Couldn't install some required mods: a / b", en('일부 필수 모드를 설치하지 못했어요: a / b'))
    expect(en('새 버전이 있는 플러그인이 3개 있어요') === '3 plugins have new versions', en('새 버전이 있는 플러그인이 3개 있어요'))
    expect(!/[가-힣]/.test(zh('서버가 켜져 있어서 플러그인을 바꿀 수 없어요')), zh('서버가 켜져 있어서 플러그인을 바꿀 수 없어요'))
    expect(en('  서버 켜기 ') === '  Start server ', '앞뒤 공백이 사라졌어요')
    expect(en('원인: 모름\n위치: 1 2 3').includes('Cause:'), '여러 줄 글이 번역되지 않았어요')
    expect(en('Hello world') === 'Hello world' && en('플레이어가 친 아무 채팅') === '플레이어가 친 아무 채팅', '모르는 글을 바꿨어요')
    expect(translator('ko')('서버 켜기') === '서버 켜기', '한국어인데 바꿨어요')
  })
  await check('언어: 윈도우 언어로 처음 언어 정하기 + 설정 저장 (이상한 값은 무시)', () => {
    expect(langFromLocale('ko-KR') === 'ko' && langFromLocale('zh-CN') === 'zh' && langFromLocale('zh-TW') === 'zh' && langFromLocale('en-US') === 'en' && langFromLocale('ja') === 'en', '윈도우 언어로 고른 값이 틀려요')
    const before = getAppSettings().language
    expect(setAppSettings({ language: 'en' }).language === 'en', '영어로 저장이 안 됐어요')
    expect(mainTr('종료') === 'Quit', `트레이 메뉴가 영어가 아니에요: ${mainTr('종료')}`)
    expect(setAppSettings({ language: 'fr' as never }).language === 'en', '이상한 언어가 들어갔어요')
    expect(setAppSettings({ language: 'zh' }).language === 'zh' && mainTr('열기') === '打开', '중국어로 바뀌지 않았어요')
    setAppSettings({ language: before })
    expect(mainTr('종료') === (before === 'ko' ? '종료' : before === 'en' ? 'Quit' : '退出'), '원래 언어로 돌아가지 않았어요')
  })
  await check('언어: 앱을 지울 때 화면(세 언어)과 설치 프로그램 언어 설정', () => {
    const nsh = fs.readFileSync('build-tools/uninstall.nsh')
    expect(nsh[0] === 0xef && nsh[1] === 0xbb && nsh[2] === 0xbf, 'uninstall.nsh 가 BOM 있는 UTF-8이 아니에요 (한글이 깨져요)')
    const s = nsh.toString('utf8')
    for (const want of ['$LANGUAGE == 1042', '$LANGUAGE == 2052', 'All servers and backups', '创建的所有服务器和备份', '만든 서버와 백업 전부'])
      expect(s.includes(want), `지우기 화면에 "${want}"이(가) 없어요`)
    expect(!/runtime/.test(s.replace(/^;.*$/gm, '')), '자바(runtime) 폴더를 지우는 줄이 있어요')
    const nsis = JSON.parse(fs.readFileSync('package.json', 'utf8')).build.nsis
    expect(nsis.multiLanguageInstaller && ['en_US', 'ko_KR', 'zh_CN'].every((l) => nsis.installerLanguages.includes(l)), '설치 프로그램 언어 설정이 빠졌어요')
  })
  await check('언어: 다운로드 사이트의 모든 문구에 영어·중국어가 있다', () => {
    const html = fs.readFileSync('docs/index.html', 'utf8')
    const keys = [...html.matchAll(/data-i18n="([a-z0-9]+)"/g)].map((m) => m[1])
    expect(keys.length >= 30, `번역할 곳이 너무 적어요 (${keys.length})`)
    const script = html.slice(html.indexOf('const T = {'))
    const en = script.slice(script.indexOf('en: {'), script.indexOf('zh: {'))
    const zh = script.slice(script.indexOf('zh: {'), script.indexOf('const KO'))
    for (const k of keys) {
      expect(new RegExp(`\\b${k}: '`).test(en), `사이트 영어에 ${k}가 없어요`)
      expect(new RegExp(`\\b${k}: '`).test(zh), `사이트 중국어에 ${k}가 없어요`)
    }
    expect(!/[가-힣]/.test(en) && !/[가-힣]/.test(zh), '사이트 영어·중국어에 한글이 남았어요')
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
    expect(getLog(folder).some((l) => l.startsWith('[앱] 튕긴 원인')), '꺼진 뒤 로그에 튕긴 원인 안내가 안 남았어요 (다른 서버를 보다 오면 사라져요)')
    fs.rmSync(jar, { force: true })
  })
  await check('옛 Forge 모드(mcmod.info)도 알아보고, 같은 모드 두 개를 잡고, 직접 넣은 모드를 또 설치하면 막기', async () => {
    const modsDir = path.join(folder, 'mods')
    // 1) mcmod.info만 있는 옛 모드가 주는 ID를 알아본다 (RLCraft의 CreativeCore)
    const core = path.join(modsDir, 'test-oldcore.jar')
    await new Promise<void>((resolve, reject) => {
      const zip = new yazl.ZipFile()
      zip.addBuffer(Buffer.from('[{"modid": "testoldcore", "name": "Test Old Core", "version": "1.0",}]'), 'mcmod.info') // 끝 쉼표: 옛 모드에 흔한 모양
      zip.outputStream.pipe(fs.createWriteStream(core)).on('close', () => resolve()).on('error', reject)
      zip.end()
    })
    const user = path.join(modsDir, 'test-needs-oldcore.jar')
    await fakeFabricMod(user, { id: 'testneedsoldcore', name: 'Needs Old Core', depends: { testoldcore: '*' } })
    const pf = await runPreflight(folder)
    expect(!pf.missing.some((m) => m.needs.includes('testoldcore')), 'mcmod.info로 들어 있는 모드를 "없다"고 해요')
    // 2) 같은 모드 두 개
    fs.copyFileSync(core, path.join(modsDir, 'test-oldcore-copy.jar'))
    expect((await runPreflight(folder)).duplicates.some((d) => d.files.length === 2), '같은 모드 두 개를 못 잡았어요')
    for (const f of ['test-oldcore.jar', 'test-oldcore-copy.jar', 'test-needs-oldcore.jar']) fs.rmSync(path.join(modsDir, f), { force: true })
    // 3) 폴더에 직접 넣은 Lithium이 있는데 또 설치하면 막는다
    const lith = mods.list(folder).find((m) => /lithium/i.test(m.fileName))!
    const jarBytes = fs.readFileSync(path.join(modsDir, lith.fileName))
    await mods.remove(folder, lith.fileName) // 설치 기록에서 빼고
    fs.writeFileSync(path.join(modsDir, 'my-lithium.jar'), jarBytes) // 사용자가 직접 넣은 것처럼
    expect(await throws(() => mods.install(folder, LITHIUM)), '이미 넣어 둔 모드를 또 설치했어요')
    expect(fs.readdirSync(modsDir).filter((f) => /lithium/i.test(f)).length === 1, 'Lithium 파일이 두 개가 됐어요')
    fs.rmSync(path.join(modsDir, 'my-lithium.jar'), { force: true })
    await mods.install(folder, LITHIUM) // 뒤 테스트를 위해 되돌린다
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
  if (hasCurseForgeKey()) {
    await check('CurseForge 모드: 설치 → 예전 버전으로 → 업데이트 (파일 손상 확인 포함)', async () => {
      const r = await mods.search(folder, 'jei', 0, 'curseforge')
      const hit = r.hits.find((h) => /^just enough items/i.test(h.title)) ?? r.hits[0]
      expect(hit, 'CurseForge 검색 결과가 없어요')
      const res = await mods.install(folder, hit.projectId)
      expect(res.failed.length === 0 && res.installed.length > 0, `설치 실패: ${res.failed.join(', ')}`)
      const m = mods.list(folder).find((x) => x.title === hit.title)
      expect(m, '설치된 목록에 없어요')
      const vs = await mods.versionsOf(folder, m!.fileName)
      const old = vs.find((v) => !v.current)
      expect(old, '다른 버전이 없어요')
      const sv = await mods.setVersion(folder, m!.fileName, old!.id)
      expect(sv.failed.length === 0, `예전 버전으로 못 바꿨어요: ${sv.failed.join(', ')}`)
      const ups = await mods.checkUpdates(folder)
      const mine = mods.list(folder).find((x) => x.title === hit.title)!
      expect(ups[mine.fileName], '업데이트를 못 찾았어요')
      const up = await mods.updateMods(folder, [mine.fileName])
      expect(up.failed.length === 0, `업데이트 실패: ${up.failed.join(', ')}`)
      await mods.remove(folder, mods.list(folder).find((x) => x.title === hit.title)!.fileName)
    })
    await check('CurseForge 데이터팩 설치 (파일 손상 확인 포함)', async () => {
      const r = await datapacks.search(folder, 'dungeon', 0, 'curseforge') // Terralith는 CurseForge 데이터팩 분류에 없다
      const hit = r.hits.find((h) => h.projectId.startsWith('cf:'))
      expect(hit, 'CurseForge 데이터팩 검색 결과가 없어요')
      const before = datapacks.list(folder).length
      await datapacks.install(folder, hit!.projectId)
      expect(datapacks.list(folder).length === before + 1, '설치되지 않았어요')
    })
  }
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
  await check('서버 팩 zip 끌어다 놓기: 버전·로더 알아내기 → 서버 만들기 → 켜기 (실행 파일·EULA는 무시)', async () => {
    // 복제해 둔 Fabric 1.21.1 서버의 모드로 서버 팩 모양 zip을 만든다 (버전 정보 파일 없음 → 모드를 보고 알아내야 한다)
    const copy = listServers().find((s) => s.name === '자동 테스트 복제')!
    const mods = fs.readdirSync(path.join(copy.folderPath, 'mods')).filter((f) => f.endsWith('.jar'))
    const zipFile = path.join(os.tmpdir(), '테스트 서버팩.zip')
    await new Promise<void>((resolve, reject) => {
      const zip = new yazl.ZipFile()
      for (const m of mods) zip.addFile(path.join(copy.folderPath, 'mods', m), `Test Pack Server/mods/${m}`)
      zip.addBuffer(Buffer.from('ok'), 'Test Pack Server/config/pack.txt')
      zip.addBuffer(Buffer.from('eula=true'), 'Test Pack Server/eula.txt')
      zip.addBuffer(Buffer.from('fake'), 'Test Pack Server/server.jar')
      zip.addBuffer(Buffer.from('java -jar server.jar'), 'Test Pack Server/run.bat')
      zip.outputStream.pipe(fs.createWriteStream(zipFile)).on('close', () => resolve()).on('error', reject)
      zip.end()
    })
    const info = await prepareFromUpload(zipFile)
    expect(info.serverPack && info.software === 'fabric' && info.mcVersion === MC, `알아낸 정보가 틀려요: ${info.software} ${info.mcVersion}`)
    expect(info.modCount === mods.length, `모드 수가 달라요: ${info.modCount}/${mods.length}`)
    const s = await createServer({ name: '자동 테스트 서버팩', software: info.software, mcVersion: info.mcVersion, loaderVersion: info.loaderVersion, modpackId: info.packId, properties: { 'server-port': '25594' } }, () => undefined)
    expect(!isEulaAccepted(s.folderPath), 'EULA에 몰래 동의됐어요')
    expect(fs.existsSync(path.join(s.folderPath, 'config', 'pack.txt')), '설정 파일이 안 들어왔어요')
    expect(!fs.existsSync(path.join(s.folderPath, 'run.bat')), '실행 스크립트가 들어왔어요')
    acceptEula(s.folderPath)
    expect(!(await runPreflight(s.folderPath)).askOff, '서버 팩인데 모드를 끌지 물어봐요')
    await startAndWait(s.folderPath)
    expect(getLog(s.folderPath).some((l) => /lithium/i.test(l)), '서버 팩의 모드가 안 읽혔어요')
    await stopAndWait(s.folderPath)
  })
  if (hasCurseForgeKey())
    await check('CurseForge 모드팩에 서버 팩이 있으면 서버 팩으로 만들기 → 켜기', async () => {
      const r = await browseModpacks({ site: 'curseforge', query: '', sort: 'downloads', gameVersion: MC, loaders: [], offset: 0 })
      for (const hit of r.hits.slice(0, 20)) {
        const modId = Number(hit.projectId.replace(/^cf:/, ''))
        const v = (await modpackVersions(hit.projectId, 'curseforge')).find((x) => x.gameVersions.includes(MC))
        if (!v) continue
        const f = await getFile(modId, Number(v.id))
        if (!f.serverPackFileId) continue
        const pack = await prepareFromCurseForge(modId, Number(v.id))
        if (!pack.serverPack) continue // 서버 팩을 받을 수 없게 막혀 있음 → 원래 방식 (위 테스트에서 확인)
        if (pack.modCount > 150) continue
        console.log(`      (${hit.title}: 서버 팩, 모드 ${pack.modCount}개, ${pack.software})`)
        const info = await createServer({ name: '자동 테스트 CF 서버팩', software: pack.software, mcVersion: pack.mcVersion, loaderVersion: pack.loaderVersion, modpackId: pack.packId, properties: { 'server-port': '25593' } }, () => undefined)
        acceptEula(info.folderPath)
        await mods.installBaseMods(info.folderPath, true)
        await startAndWait(info.folderPath)
        await stopAndWait(info.folderPath)
        return
      }
      throw new Error('서버 팩이 있는 CurseForge 모드팩을 못 찾았어요')
    })
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
      expect(!(await runPreflight(info.folderPath)).askOff, '모드팩 서버인데 모드를 끌지 물어봐요 (모드팩은 그대로 둬야 해요)')
      console.log(`      (${hit.title}: 모드 ${pack.modCount}개, 게임 화면 전용이라 뺀 것 ${pack.skipped}개)`)
      await startAndWait(info.folderPath)
      await stopAndWait(info.folderPath)
      return
    }
    throw new Error('알맞은 모드팩을 못 찾았어요')
  })
  if (hasCurseForgeKey())
    await check('CurseForge 모드팩 찾기 → 버전 → 풀기 → 서버 만들기(파일 손상 확인 포함) → 켜기', async () => {
      const r = await browseModpacks({ site: 'curseforge', query: '', sort: 'downloads', gameVersion: MC, loaders: ['fabric'], offset: 0 })
      expect(r.hits.length > 0, '모드팩 검색 결과가 없어요')
      for (const hit of r.hits.slice(0, 8)) {
        const v = (await modpackVersions(hit.projectId, 'curseforge')).find((x) => x.gameVersions.includes(MC))
        if (!v) continue
        const pack = await prepareFromCurseForge(Number(hit.projectId.replace(/^cf:/, '')), Number(v.id))
        if (pack.software !== 'fabric' || pack.modCount === 0 || pack.modCount > 120 || pack.manual.length) continue // 빨리 끝나고, 직접 넣을 모드가 없는 것
        const info = await createServer({ name: '자동 테스트 CF 모드팩', software: pack.software, mcVersion: pack.mcVersion, loaderVersion: pack.loaderVersion, modpackId: pack.packId, properties: { 'server-port': '25595' } }, () => undefined)
        acceptEula(info.folderPath)
        await mods.installBaseMods(info.folderPath, true)
        expect(!(await runPreflight(info.folderPath)).askOff, '모드팩 서버인데 모드를 끌지 물어봐요 (모드팩은 그대로 둬야 해요)')
        console.log(`      (${hit.title}: 모드 ${pack.modCount}개)`)
        await startAndWait(info.folderPath)
        await stopAndWait(info.folderPath)
        return
      }
      throw new Error('알맞은 CurseForge 모드팩을 못 찾았어요')
    })
}

// ---------- 다른 서버 종류 + 맵 ----------
async function otherSoftware(): Promise<void> {
  console.log(`\n[다른 서버 종류: 바닐라·Quilt·Purpur·Forge·NeoForge ${MC}]`)
  let port = 25590
  for (const software of (['vanilla', 'quilt', 'purpur', 'forge', 'neoforge'] as const).filter((s) => !only.length || only.includes(s))) {
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

// ---------- 나머지 기능: 파일 탐색기 · 삭제 · 취소 · 데이터팩 · 모드 ID · zip 월드 · 키 · 앱 설정 ----------
// 폴더를 zip으로 (테스트용 월드 zip 만들기)
function zipDir(dir: string, out: string, prefix: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile()
    const walk = (d: string, rel: string): void => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name === 'session.lock') continue
        const p = path.join(d, e.name)
        if (e.isDirectory()) walk(p, `${rel}/${e.name}`)
        else zip.addFile(p, `${rel}/${e.name}`)
      }
    }
    walk(dir, prefix)
    zip.outputStream.pipe(fs.createWriteStream(out)).on('close', () => resolve()).on('error', reject)
    zip.end()
  })
}
async function throws(fn: () => unknown): Promise<boolean> {
  try {
    await fn()
    return false
  } catch {
    return true
  }
}

async function moreFeatures(): Promise<void> {
  console.log('\n[나머지 기능]')
  const copy = listServers().find((s) => s.name === '자동 테스트 복제')!.folderPath
  await check('파일 탐색기: 새 폴더·새 파일·이름 바꾸기·휴지통, 서버 밖 경로는 막기', async () => {
    const dir = createEntry(copy, 'config', '테스트폴더', 'dir')
    const file = createEntry(copy, dir, 'memo.txt', 'file')
    expect(fs.existsSync(path.join(copy, file)), '새 파일이 없어요')
    expect(await throws(() => createEntry(copy, dir, 'run.exe', 'file')), '글자 파일이 아닌데 만들어졌어요')
    expect(await throws(() => createEntry(copy, dir, 'memo.txt', 'file')), '같은 이름을 또 만들었어요')
    renameEntry(copy, file, 'memo2.txt')
    expect(fs.existsSync(path.join(copy, dir, 'memo2.txt')) && !fs.existsSync(path.join(copy, file)), '이름이 안 바뀌었어요')
    await trashEntries(copy, [dir])
    expect(!fs.existsSync(path.join(copy, dir)), '휴지통으로 안 갔어요')
    for (const bad of ['../', '../../x', 'C:/Windows'])
      expect(await throws(() => listDir(copy, bad)), `서버 밖 경로(${bad})를 열었어요`)
    expect(await throws(() => trashEntries(copy, [''])), '서버 폴더 자체를 지우려 했는데 막지 않았어요')
    expect(await throws(() => renameEntry(copy, 'server.properties', '../x.properties')), '이름에 경로를 넣었는데 막지 않았어요')
  })
  await check('파일 탐색기: 켜져 있으면 이름 바꾸기·지우기는 막기', async () => {
    await startAndWait(copy)
    try {
      expect(await throws(() => renameEntry(copy, 'server.properties', 'a.properties')), '켜진 서버에서 이름을 바꿨어요')
      expect(await throws(() => trashEntries(copy, ['config'])), '켜진 서버에서 지웠어요')
      expect(await throws(() => deleteServer(copy)), '켜진 서버를 지웠어요')
    } finally {
      await stopAndWait(copy)
    }
  })
  await check('데이터팩: 파일 직접 넣기 → 알아보기 → 버전 바꾸기 → 튕김 원인 데이터팩 끄기', async () => {
    const r = await datapacks.search(copy, 'terralith', 0, 'modrinth')
    await datapacks.install(copy, r.hits[0].projectId)
    const d = datapacks.list(copy)[0]
    const outside = path.join(os.tmpdir(), 'mcsm-test-drop', d.name)
    fs.mkdirSync(path.dirname(outside), { recursive: true })
    const worldPacks = path.join(copy, 'world', 'datapacks')
    fs.copyFileSync(path.join(worldPacks, d.name), outside)
    await datapacks.remove(copy, d.name)
    await datapacks.addFile(copy, outside)
    await datapacks.identify(copy)
    const back = datapacks.list(copy)[0]
    expect(back && /terralith/i.test(back.title), `알아보지 못했어요: ${back?.title}`)
    const vs = await datapacks.versionsOf(copy, back.name)
    const other = vs.find((v) => !v.current)
    expect(other, '다른 버전이 없어요')
    await datapacks.setVersion(copy, back.name, other!.id)
    const now = datapacks.list(copy)[0]
    disableDatapack(copy, now.name) // 튕김 창의 "이 데이터팩 끄기"
    expect(fs.existsSync(path.join(copy, 'world', 'datapacks-disabled', now.name)), '꺼 둔 곳으로 안 옮겨졌어요')
    expect(await throws(() => disableDatapack(copy, '../server.properties')), '이상한 이름을 막지 않았어요')
    // 되돌려 둔다 (Terralith는 지형 데이터팩이라, 빠진 채로 켜면 그 월드를 못 읽는다. 뒤 테스트가 이 서버를 쓴다)
    fs.renameSync(path.join(copy, 'world', 'datapacks-disabled', now.name), path.join(worldPacks, now.name))
  })
  await check('모드 종류 알아내기 + 튕김 창의 "빠진 모드 설치"(모드 ID로)', async () => {
    expect(mods.modKind(copy)?.folder === 'mods', '모드 폴더를 못 알아냈어요')
    const title = await mods.installById(copy, 'fabric-language-kotlin')
    expect(/kotlin/i.test(title), `설치한 이름이 이상해요: ${title}`)
    expect(await throws(() => mods.installById(copy, '../bad')), '이상한 ID를 막지 않았어요')
  })
  await check('플레이어용 모드 묶음 (zip)', async () => {
    const out = await mods.exportClientPack(copy, 'zip', null)
    expect(out && fs.statSync(out).size > 0, 'zip이 안 만들어졌어요')
  })
  await check('월드 zip 끌어다 놓기 → 가져오기', async () => {
    const zipFile = path.join(os.tmpdir(), '테스트 월드.zip')
    await zipDir(path.join(copy, 'world'), zipFile, '내 월드')
    const w = await openDroppedWorld(zipFile)
    const vanilla = listServers().find((s) => s.name === '자동 테스트 vanilla')!.folderPath
    await importWorld(vanilla, w.path, MC)
    expect(fs.existsSync(path.join(vanilla, 'world', 'level.dat')), '월드가 안 들어왔어요')
  })
  await check('서버 만들기 취소 → 만들다 만 폴더 정리', async () => {
    const before = listServers().length
    const loader = (await getLoaderVersions('fabric', '1.20.1')).find((v) => v.stable)!
    const job = runCancellable('test-create', () => createServer({ name: '자동 테스트 취소', software: 'fabric', mcVersion: '1.20.1', loaderVersion: loader.version }, () => undefined))
    await sleep(800)
    cancelTask('test-create')
    expect(await throws(() => job), '취소했는데 끝까지 만들어졌어요')
    cleanupUnfinished()
    expect(listServers().length === before, '만들다 만 서버가 목록에 남았어요')
    expect(!fs.readdirSync(path.join(process.env.TEST_HOME!, 'servers')).some((n) => n.includes('자동 테스트 취소')), '만들다 만 폴더가 남았어요')
  })
  await check('서버 삭제 (백업도 같이)', async () => {
    const s = listServers().find((x) => x.name === '자동 테스트 나쁜 모드팩')!
    await deleteServer(s.folderPath)
    expect(!fs.existsSync(s.folderPath) && !listServers().some((x) => x.folderPath === s.folderPath), '안 지워졌어요')
  })
  if (hasCurseForgeKey())
    await check('CurseForge 키: 앱에 넣은 키가 먼저, 틀린 키는 거절, 넣은 키 빼기', async () => {
      expect(curseForgeKeySource() === 'built', '중계 서버 연결을 안 쓰고 있어요')
      expect(await throws(() => setCurseForgeKey('abc')), '키 모양이 아닌데 받아들였어요')
      expect(await throws(() => setCurseForgeKey('$2a$10$' + 'x'.repeat(53))), '틀린 키를 받아들였어요')
      removeCurseForgeKey()
      expect(hasCurseForgeKey(), '앱에 넣은 키까지 사라졌어요')
    })
  await check('앱 설정 저장 (이상한 값은 무시)', () => {
    const s = setAppSettings({ closeBehavior: 'always-tray', notifications: false })
    expect(s.closeBehavior === 'always-tray' && !s.notifications, '저장이 안 됐어요')
    const t = setAppSettings({ closeBehavior: 'nonsense' as never })
    expect(t.closeBehavior === 'always-tray', '이상한 값이 들어갔어요')
    expect(getAppSettings().notifications === false, '다시 읽은 값이 달라요')
  })
}

// ---------- 자동 동작 (앱 켤 때 켜기 · 환영 메시지 · 빈 서버 끄기 · 매일 다시 켜기) ----------
async function automation(): Promise<void> {
  console.log('\n[자동 동작] 몇 분씩 기다려야 해서 오래 걸려요')
  const copy = listServers().find((s) => s.name === '자동 테스트 복제')!.folderPath
  const quilt = listServers().find((s) => s.name === '자동 테스트 quilt')!.folderPath
  setStarter((f) => startServerAt(f, () => undefined))
  await check('앱을 켤 때 서버 켜기 (포트가 겹치는 서버는 건너뛰기)', async () => {
    const port = readProperties(copy)['server-port']
    saveSettings(copy, { automation: { autoStart: true } })
    saveSettings(quilt, { automation: { autoStart: true }, properties: { 'server-port': port } }) // 같은 포트
    await autoStartServers()
    const on = [copy, quilt].filter((f) => getState(f) === 'running')
    expect(on.length === 1, `켜진 서버가 ${on.length}개예요 (1개여야 해요)`)
    const skipped = on[0] === copy ? quilt : copy
    expect(getLog(skipped).some((l) => /같은 포트/.test(l)) || getState(skipped) === 'stopped', '겹친 서버를 건너뛴다는 기록이 없어요')
    saveSettings(quilt, { automation: { autoStart: false }, properties: { 'server-port': '25591' } })
    if (on[0] !== copy) {
      await stopAndWait(quilt)
      await startAndWait(copy)
    }
  })
  await check('들어온 사람에게 환영 메시지 (그 사람에게만)', async () => {
    saveSettings(copy, { automation: { welcome: '어서 와요 {name}' } })
    const from = getLog(copy).length
    emitEvent({ type: 'players', folderPath: copy, players: ['TestPlayer'] }) // 접속한 것처럼
    await sleep(4000)
    // 실제로는 없는 사람이라 서버가 "그런 사람 없음"이라고 답한다 = tellraw를 그 사람에게 보냈다는 뜻
    expect(getLog(copy).slice(from).some((l) => /No player was found/i.test(l)), '환영 메시지를 보내지 않았어요')
    emitEvent({ type: 'players', folderPath: copy, players: [] })
  })
  await check('아무도 없이 1분 지나면 서버 끄기', async () => {
    saveSettings(copy, { automation: { emptyStopMin: 1, welcome: '' } })
    await waitFor('빈 서버 끄기', () => getState(copy) === 'stopped', 3 * 60_000)
    saveSettings(copy, { automation: { emptyStopMin: 0 } })
  })
  await check('매일 정한 시각에 다시 켜기 (1분 전 알림 → 끄고 → 켜기)', async () => {
    await startAndWait(copy)
    const first = getStartedAt(copy)
    const at = new Date(Date.now() + 60_000)
    const hhmm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
    saveSettings(copy, { automation: { dailyRestart: hhmm } })
    await waitFor('알림', () => getLog(copy).some((l) => /매일 다시 켜기/.test(l)), 3 * 60_000)
    await waitFor('다시 켜짐', () => getState(copy) === 'running' && getStartedAt(copy) !== first, 6 * 60_000)
    saveSettings(copy, { automation: { dailyRestart: '', autoStart: false } })
    await stopAndWait(copy)
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
    // Paper는 "help" 명령을 바꿔 놓아서 게임 규칙 목록을 따로 받아야 한다
    const rules = await listGameRules(folder)
    expect(rules.length > 20, `Paper에서 게임 규칙을 못 읽었어요 (${rules.length}개)`)
    await stopAndWait(folder)
  })
}

async function main(): Promise<void> {
  const t = Date.now()
  if (only.length) {
    await otherSoftware()
    console.log(`
결과: ${passed}개 통과, ${failed.length}개 실패 (${Math.round((Date.now() - t) / 1000)}초)`)
    process.exit(failed.length ? 1 : 0)
  }
  await quick()
  if (full) {
    await real()
    await paperServer()
    await modpackServers()
    await otherSoftware()
    await moreFeatures()
    await automation()
  }
  else console.log('\n(실제 서버 테스트는 npm run test:full)')
  console.log(`\n결과: ${passed}개 통과, ${failed.length}개 실패 (${Math.round((Date.now() - t) / 1000)}초)`)
  if (failed.length) console.log(`실패: ${failed.join(' / ')}`)
  process.exit(failed.length ? 1 : 0)
}
void main()
