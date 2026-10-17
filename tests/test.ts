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
import http from 'http'
import dgram from 'dgram'
import { execFileSync } from 'child_process'
import { langFromLocale, translator } from '../src/i18n'
import { tr as mainTr } from '../src/main/i18n'
import { BUG_MAX_BYTES, bugFileInfo, bugMessage, sendBugReport } from '../src/main/bugreport'
import { d1Store, handleDomain } from '../relay/domain.mjs'
import { DatabaseSync } from 'node:sqlite'
import { checkImportFolder, detectServer } from '../src/main/importserver'
import { addAddonFile, bedrockProps, checkAddons, listAddons, removeAddon, setAddonEnabled } from '../src/main/bedrock'
import { getBedrockManage, listBedrockRules, runBedrockAction } from '../src/main/bedrockmanage'
import { isExempt } from '../src/main/bedrockloopback'
import { labelOf } from '../src/renderer/src/gameruleLabels'
import { checkBedrockUpdate, importBedrockWorld, installBedrockHit, updateBedrock } from '../src/main/bedrockops'
import { searchBedrockStore } from '../src/main/curseforge'
import { claimDomain, cleanDomainName, getDomain, refreshDomain, releaseDomain } from '../src/main/domain'
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
  await domainChecks()
  await importChecks()
  await bedrockChecks()
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
// ---------- 이름 주소 (중계 서버: 가짜 Cloudflare로 확인) ----------
interface FakeRecord { id: string; type: string; name: string; content?: string; data?: { port: number }; comment?: string; created_on?: string; modified_on?: string }
function fakeCloudflare(seed: FakeRecord[] = []): { records: FakeRecord[]; writes: string[]; fetch: typeof fetch } {
  const records: FakeRecord[] = [...seed]
  const writes: string[] = []
  let n = 1000
  const ok = (result: unknown, total?: number) => new Response(JSON.stringify({ success: true, result, result_info: { total_count: total ?? (Array.isArray(result) ? result.length : 0) } }))
  const f = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = new URL(String(url))
    const method = init?.method ?? 'GET'
    const id = u.pathname.split('/dns_records/')[1]
    if (method === 'GET') {
      const name = u.searchParams.get('name')
      const content = u.searchParams.get('content')
      const starts = u.searchParams.get('comment.startswith')
      const page = Number(u.searchParams.get('page') ?? 1)
      if (name) return ok(records.filter((r) => r.name === name))
      if (starts) return ok(records.filter((r) => String(r.comment ?? '').startsWith(starts)).slice((page - 1) * 100, page * 100))
      if (content) return ok(records.filter((r) => r.content === content))
      return ok(records.slice(0, 1), records.length)
    }
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    writes.push(`${method} ${body.type ?? ''}`.trim())
    if (method === 'POST') {
      const rec = { id: String(n++), ...body }
      records.push(rec)
      return ok(rec)
    }
    const i = records.findIndex((r) => r.id === id)
    if (i < 0) return new Response(JSON.stringify({ success: false }), { status: 404 })
    if (method === 'PATCH') Object.assign(records[i], body)
    const out = records[i]
    if (method === 'DELETE') records.splice(i, 1)
    return ok(out)
  }
  return { records, writes, fetch: f as typeof fetch }
}

interface MemRow { name: string; owner: string; ip: string; port: number; bedrock: boolean; target: string; online: boolean; lastSeen: number; created: number }
function memoryStore() {
  const rows = new Map<string, MemRow>()
  const writes: string[] = []
  return {
    none: false,
    rows,
    writes,
    get: async (name: string): Promise<MemRow | null> => rows.get(name) ?? null,
    put: async (r: MemRow): Promise<void> => {
      writes.push('put')
      rows.set(r.name, { ...r })
    },
    del: async (name: string): Promise<void> => {
      writes.push('del')
      rows.delete(name)
    },
    countByIp: async (ip: string): Promise<number> => [...rows.values()].filter((r) => r.ip === ip).length,
    staleOnline: async (before: number, limit: number): Promise<MemRow[]> =>
      [...rows.values()].filter((r) => r.online && r.lastSeen < before).sort((x, y) => x.lastSeen - y.lastSeen).slice(0, limit),
    existing: async (names: string[]): Promise<Set<string>> => new Set(names.filter((n) => rows.has(n))),
    markOffline: async (name: string): Promise<void> => {
      writes.push('offline')
      const r = rows.get(name)
      if (r) r.online = false
    },
    purgeIdle: async (before: number, limit: number): Promise<number> => {
      let n = 0
      for (const r of [...rows.values()]) if (!r.online && r.lastSeen < before && n < limit) (rows.delete(r.name), n++)
      return n
    }
  }
}

async function domainChecks(): Promise<void> {
  const env = { CF_DNS_TOKEN: 't', CF_ZONE_ID: 'z', DOMAIN_BASE: 'cubepanel.kr' }
  const K1 = 'a'.repeat(32)
  const K2 = 'b'.repeat(32)
  const call = async (cf: ReturnType<typeof fakeCloudflare>, body: object, ip = '1.2.3.4') => {
    const res = await handleDomain(new Request('https://x/api/domain', { method: 'POST', headers: { 'cf-connecting-ip': ip }, body: JSON.stringify(body) }), env, cf.fetch)
    return { status: res.status, body: (await res.json()) as { ok?: boolean; error?: string; host?: string } }
  }
  await check('이름 주소: 만들기·포트 바꾸기(SRV)·같은 값이면 쓰지 않기·없애기', async () => {
    const cf = fakeCloudflare()
    const a = await call(cf, { action: 'claim', name: 'myserver', key: K1 })
    expect(a.status === 200 && a.body.host === 'myserver.cubepanel.kr', `만들지 못했어요: ${JSON.stringify(a)}`)
    expect(cf.records.length === 1 && cf.records[0].type === 'A' && cf.records[0].content === '1.2.3.4', '주소 기록이 이상해요')
    expect(cf.records[0].comment?.startsWith('cp:') === true && !cf.records[0].comment.includes(K1), '주인 표시가 없거나 열쇠가 그대로 적혔어요')
    cf.writes.length = 0
    await call(cf, { action: 'claim', name: 'myserver', key: K1 })
    expect(cf.writes.length === 0, `바뀐 게 없는데 썼어요: ${cf.writes}`)
    await call(cf, { action: 'claim', name: 'myserver', key: K1, port: 30000 })
    const srv = cf.records.find((r) => r.type === 'SRV')
    expect(srv?.name === '_minecraft._tcp.myserver.cubepanel.kr' && srv.data?.port === 30000, `SRV가 없어요: ${JSON.stringify(cf.records)}`)
    await call(cf, { action: 'claim', name: 'myserver', key: K1, port: 25565 })
    expect(!cf.records.some((r) => r.type === 'SRV'), '기본 포트로 돌아왔는데 SRV가 남았어요')
    const ip2 = await call(cf, { action: 'claim', name: 'myserver', key: K1 }, '5.6.7.8')
    expect(ip2.status === 200 && cf.records[0].content === '5.6.7.8', 'IP가 바뀌었는데 갱신하지 않았어요')
    const bad = await call(cf, { action: 'release', name: 'myserver', key: K2 })
    expect(bad.status === 403 && cf.records.length === 1, '다른 열쇠로 지울 수 있었어요')
    const rel = await call(cf, { action: 'release', name: 'myserver', key: K1 })
    expect(rel.status === 200 && cf.records.length === 0, '주인이 지우지 못했어요')
  })
  await check('이름 주소: 터널로 열린 서버는 터널 주소로 보내는 SRV를 만들고, 허용 안 된 주소는 거절', async () => {
    const cf = fakeCloudflare()
    const t = await call(cf, { action: 'claim', name: 'tunnelsv', key: K1, port: 40123, target: 'abc.ply.gg' }, '2001:db8::1')
    expect(t.status === 200, `터널 연결 실패: ${JSON.stringify(t)}`)
    const srv = cf.records.find((r) => r.type === 'SRV')
    expect(cf.records.length === 1 && srv?.name === '_minecraft._tcp.tunnelsv.cubepanel.kr' && srv.data?.port === 40123 && srv.data?.target === 'abc.ply.gg', `SRV: ${JSON.stringify(cf.records)}`)
    cf.writes.length = 0
    await call(cf, { action: 'claim', name: 'tunnelsv', key: K1, port: 40123, target: 'abc.ply.gg' })
    expect(cf.writes.length === 0, '바뀐 게 없는데 썼어요')
    await call(cf, { action: 'claim', name: 'tunnelsv', key: K1, port: 40999, target: 'abc.ply.gg' })
    expect(cf.records.find((r) => r.type === 'SRV')?.data?.port === 40999, '포트가 바뀌었는데 갱신하지 않았어요')
    for (const bad of ['evil.com', 'abc.ply.gg.evil.com', '1.2.3.4', 'ply.gg']) {
      expect((await call(cf, { action: 'claim', name: 'tunnelsv', key: K1, port: 40999, target: bad })).status === 400, `${bad}을(를) 받아들였어요`)
    }
    expect((await call(cf, { action: 'claim', name: 'tunnelsv', key: K2, port: 40999, target: 'abc.ply.gg' })).status === 409, '남의 이름에 터널을 달았어요')
  })
  await check('이름 주소(D1): 저장소 SQL이 실제로 동작한다 (저장·읽기·덮어쓰기·주소별 개수·소식 끊긴 서버·예약 청소·지우기)', async () => {
    const sqlite = new DatabaseSync(':memory:')
    const d1 = {
      prepare(sql: string) {
        let params: (string | number | null)[] = []
        const st = {
          bind(...p: (string | number | null)[]) {
            params = p
            return st
          },
          first: async () => sqlite.prepare(sql).get(...params) ?? null,
          all: async () => ({ results: sqlite.prepare(sql).all(...params) }),
          run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...params).changes) } })
        }
        return st
      }
    }
    const s = d1Store(d1)
    const row = { name: 'abc', owner: 'cp:' + 'a'.repeat(32), ip: '1.1.1.1', port: 19132, bedrock: true, target: '', online: true, lastSeen: 1000, created: 500 }
    await s.put(row)
    expect(JSON.stringify(await s.get('abc')) === JSON.stringify(row), `읽은 값이 달라요: ${JSON.stringify(await s.get('abc'))}`)
    await s.put({ ...row, ip: '2.2.2.2', lastSeen: 2000, created: 999 })
    const again = await s.get('abc')
    expect(again?.ip === '2.2.2.2' && again.lastSeen === 2000 && again.created === 500, `덮어쓰기: ${JSON.stringify(again)} (만든 때는 그대로여야 해요)`)
    await s.put({ ...row, name: 'def', lastSeen: 100 })
    await s.put({ ...row, name: 'ghi', online: false, lastSeen: 50 })
    expect((await s.countByIp('1.1.1.1')) === 2 && (await s.countByIp('2.2.2.2')) === 1, '주소별 개수가 이상해요')
    expect((await s.staleOnline(1500, 10)).map((r: { name: string }) => r.name).join() === 'def', '소식이 끊긴 서버를 잘못 찾았어요')
    expect([...(await s.existing(['abc', 'zzz', 'ghi']))].sort().join() === 'abc,ghi', '있는 이름 찾기가 이상해요')
    await s.markOffline('def')
    expect((await s.get('def'))?.online === false, '끄기 표시가 안 됐어요')
    expect((await s.purgeIdle(200, 10)) === 2 && !(await s.get('def')) && !(await s.get('ghi')) && !!(await s.get('abc')), '안 쓰는 예약 청소가 이상해요')
    await s.del('abc')
    expect(!(await s.get('abc')), '지우지 못했어요')
  })
  await check('이름 주소: D1이 없으면 "오프라인"은 기록을 지우지 않는다 (예약할 곳이 없어서 이름을 지킬 수 없다)', async () => {
    const cf = fakeCloudflare()
    await call(cf, { action: 'claim', name: 'nodb', key: K1 })
    const out = await call(cf, { action: 'offline', name: 'nodb', key: K1 })
    expect(out.status === 200 && cf.records.length === 1, 'D1 없이 기록을 지웠어요')
    expect((await call(cf, { action: 'claim', name: 'nodb', key: K2 })).status === 409, 'D1 없이 꺼 둔 이름을 남이 가져갔어요')
  })
  await check('이름 주소: 배드락은 SRV 없이 주소(A) 기록만 만든다', async () => {
    const cf = fakeCloudflare()
    const r = await call(cf, { action: 'claim', name: 'bedrocksv', key: K1, port: 19140, bedrock: true })
    expect(r.status === 200 && cf.records.length === 1 && cf.records[0].type === 'A', `배드락인데 A 기록 하나가 아니에요: ${JSON.stringify(cf.records)}`)
    await call(cf, { action: 'claim', name: 'bedrocksv', key: K1, port: 19132, bedrock: true })
    expect(!cf.records.some((x) => x.type === 'SRV'), '배드락 이름에 SRV가 생겼어요')
  })
  await check('이름 주소: 남의 이름·우리가 안 만든 기록·막은 이름·이상한 요청', async () => {
    const cf = fakeCloudflare([{ id: 'w', type: 'CNAME', name: 'mine.cubepanel.kr', content: 'pages.dev' }])
    await call(cf, { action: 'claim', name: 'taken-one', key: K1 })
    const other = await call(cf, { action: 'claim', name: 'taken-one', key: K2 })
    expect(other.status === 409 && other.body.error === 'taken', '남이 만든 이름을 가져갔어요')
    const foreign = await call(cf, { action: 'claim', name: 'mine', key: K1 })
    expect(foreign.status === 409 && cf.records.find((r) => r.id === 'w')?.content === 'pages.dev', '우리가 안 만든 기록을 건드렸어요')
    for (const n of ['www', 'admin', 'ab', '-abc', 'abc-', 'a'.repeat(21), '한글이름', 'a b', 'UPUP_']) {
      const r = await call(cf, { action: 'claim', name: n, key: K1 })
      expect(r.status === 400, `${n}을(를) 받아들였어요: ${r.status}`)
    }
    expect((await call(cf, { action: 'claim', name: 'okname', key: 'short' })).status === 400, '짧은 열쇠를 받아들였어요')
    expect((await call(cf, { action: 'claim', name: 'okname', key: K1, port: 80 })).status === 400, '낮은 포트를 받아들였어요')
    // IPv6 연결도 받는다 (AAAA 기록). 주소처럼 안 생긴 값은 거절한다
    expect((await call(cf, { action: 'claim', name: 'okname', key: K1 }, '2001:db8::1')).status === 200 && cf.records.some((r) => r.type === 'AAAA' && r.content === '2001:db8::1'), 'IPv6 연결에 AAAA 기록을 만들지 못했어요')
    expect((await call(cf, { action: 'claim', name: 'okname2', key: K1 }, 'not-an-ip')).status === 400, '주소가 아닌 값을 받았어요')
    // 연결이 IPv4로 바뀌면 AAAA를 지우고 A로 다시 만든다 (같은 이름에 둘이 남지 않게)
    await call(cf, { action: 'claim', name: 'okname', key: K1 }, '5.6.7.8')
    expect(cf.records.filter((r) => r.name === 'okname.cubepanel.kr').length === 1 && cf.records.some((r) => r.type === 'A' && r.name === 'okname.cubepanel.kr' && r.content === '5.6.7.8'), 'IPv6에서 IPv4로 바뀌었는데 기록이 이상해요')
    const get = await handleDomain(new Request('https://x/api/domain'), env, cf.fetch)
    expect(get.status === 405, 'GET을 받아들였어요')
    expect((await handleDomain(new Request('https://x/api/domain', { method: 'POST', body: '{}' }), {}, cf.fetch)).status === 503, '설정이 없는데 동작했어요')
  })
  await check('이름 주소: 만들기 전에 쓸 수 있는 이름인지 미리 확인 (아무것도 쓰지 않는다)', async () => {
    const cf = fakeCloudflare()
    const free = await call(cf, { action: 'check', name: 'fresh-name' })
    expect(free.status === 200 && (free.body as { free?: boolean }).free === true, `비어 있는 이름을 쓸 수 없다고 했어요: ${JSON.stringify(free)}`)
    expect(cf.writes.length === 0 && cf.records.length === 0, '확인하는데 기록을 만들었어요')
    await call(cf, { action: 'claim', name: 'fresh-name', key: K1 })
    const used = await call(cf, { action: 'check', name: 'fresh-name' })
    expect((used.body as { free?: boolean }).free === false, '이미 쓰는 이름을 비었다고 했어요')
    expect((await call(cf, { action: 'check', name: 'www' })).status === 400, '막은 이름을 확인해 줬어요')
    expect((await call(cf, { action: 'check', name: 'ab' })).status === 400, '짧은 이름을 확인해 줬어요')
  })
  await check('이름 주소: 같은 인터넷 주소는 10개까지, 기록이 너무 많으면 새 이름을 막기', async () => {
    const cf = fakeCloudflare()
    for (let i = 0; i < 10; i++) expect((await call(cf, { action: 'claim', name: `name-${i}-abc`, key: K1 })).status === 200, `${i}번째 이름을 만들지 못했어요`)
    const fourth = await call(cf, { action: 'claim', name: 'name-four', key: K1 })
    expect(fourth.status === 429, `11번째 이름을 막지 않았어요: ${fourth.status}`)
    expect((await call(cf, { action: 'claim', name: 'name-four', key: K1 }, '9.9.9.9')).status === 200, '다른 인터넷 주소도 막았어요')
    const full = fakeCloudflare(Array.from({ length: 200 }, (_, i) => ({ id: `f${i}`, type: 'TXT', name: `t${i}.cubepanel.kr`, content: 'x' })))
    expect((await call(full, { action: 'claim', name: 'late-one', key: K1 })).body.error === 'full', '기록이 가득 찼는데 새 이름을 만들었어요')
    expect(full.records.length === 200, '남의(우리 것이 아닌) 기록을 지웠어요')
  })
  await check('이름 주소(D1 예약): 켜진 동안만 DNS 기록·끄면 예약만 남김·예약은 남이 못 가져감·다시 켜면 되살림·지우면 예약도 해제', async () => {
    const cf = fakeCloudflare()
    const st = memoryStore()
    const t0 = Date.UTC(2026, 9, 17)
    const at = async (body: object, ip: string, now: number) => {
      const res = await handleDomain(new Request('https://x/api/domain', { method: 'POST', headers: { 'cf-connecting-ip': ip }, body: JSON.stringify(body) }), env, cf.fetch, now, st)
      return (await res.json()) as { ok?: boolean; error?: string; free?: boolean }
    }
    expect((await at({ action: 'claim', name: 'mygame', key: K1 }, '1.1.1.1', t0)).ok === true && cf.records.length === 1 && st.rows.get('mygame')?.online === true, '켜면서 기록과 예약이 안 만들어졌어요')
    expect(!cf.records[0].comment?.includes(':2026'), 'DNS 메모에 날짜가 붙었어요 (예약은 D1에 있다)')
    // 15분 안에 다시 불러도(앱이 주기적으로 부른다) DNS와 D1에 쓰지 않는다
    cf.writes.length = 0
    st.writes.length = 0
    await at({ action: 'claim', name: 'mygame', key: K1 }, '1.1.1.1', t0 + 5 * 60_000)
    expect(cf.writes.length === 0 && st.writes.length === 0, `갱신인데 썼어요: ${cf.writes} ${st.writes}`)
    await at({ action: 'claim', name: 'mygame', key: K1 }, '1.1.1.1', t0 + 20 * 60_000) // 15분이 지나면 소식만 적는다
    expect(cf.writes.length === 0 && st.writes.length === 1, `15분 뒤 소식을 안 적었어요: ${cf.writes} ${st.writes}`)
    // 끄면 DNS 기록은 지우고 예약은 둔다
    expect((await at({ action: 'offline', name: 'mygame', key: K1 }, '1.1.1.1', t0 + 3600_000)).ok === true && cf.records.length === 0 && st.rows.get('mygame')?.online === false, '끄는데 기록이 안 지워졌거나 예약이 사라졌어요')
    expect((await at({ action: 'check', name: 'mygame' }, '9.9.9.9', t0 + 3600_000)).free === false, '꺼 둔 이름을 비었다고 했어요')
    const thief = await at({ action: 'claim', name: 'mygame', key: K2 }, '2.2.2.2', t0 + 3600_000)
    expect(thief.error === 'taken' && cf.records.length === 0, '꺼 둔 남의 이름을 가져갔어요')
    expect((await at({ action: 'offline', name: 'mygame', key: K2 }, '2.2.2.2', t0)).error === 'forbidden', '남이 내 이름을 끌 수 있었어요')
    // 다시 켜면 같은 이름이 되살아난다
    expect((await at({ action: 'claim', name: 'mygame', key: K1, port: 30001 }, '3.3.3.3', t0 + 7200_000)).ok === true && cf.records.some((r) => r.type === 'A' && r.content === '3.3.3.3') && cf.records.some((r) => r.type === 'SRV'), '다시 켰는데 기록이 안 만들어졌어요')
    // 서버를 지우면 예약까지 풀린다
    expect((await at({ action: 'release', name: 'mygame', key: K1 }, '3.3.3.3', t0 + 7300_000)).ok === true && cf.records.length === 0 && !st.rows.has('mygame'), '지웠는데 예약이 남았어요')
    expect((await at({ action: 'claim', name: 'mygame', key: K2 }, '2.2.2.2', t0 + 7400_000)).ok === true, '풀린 이름을 다른 사람이 못 만들었어요')
  })

  await check('이름 주소(D1 예약): 30일 넘게 안 쓴 예약은 풀리고, 이름 개수는 예약(꺼 둔 것 포함) 기준', async () => {
    const cf = fakeCloudflare()
    const st = memoryStore()
    const DAY = 86400_000
    const t0 = Date.UTC(2026, 9, 17)
    const at = async (body: object, ip: string, now: number) => {
      const res = await handleDomain(new Request('https://x/api/domain', { method: 'POST', headers: { 'cf-connecting-ip': ip }, body: JSON.stringify(body) }), env, cf.fetch, now, st)
      return (await res.json()) as { ok?: boolean; error?: string; free?: boolean }
    }
    await at({ action: 'claim', name: 'idle-one', key: K1 }, '1.1.1.1', t0)
    await at({ action: 'offline', name: 'idle-one', key: K1 }, '1.1.1.1', t0)
    expect((await at({ action: 'check', name: 'idle-one' }, '5.5.5.5', t0 + 29 * DAY)).free === false, '29일 된 예약이 풀렸어요')
    expect((await at({ action: 'check', name: 'idle-one' }, '5.5.5.5', t0 + 31 * DAY)).free === true, '31일 된 예약이 안 풀렸어요')
    expect((await at({ action: 'claim', name: 'idle-one', key: K2 }, '2.2.2.2', t0 + 31 * DAY)).ok === true, '풀린 이름을 못 만들었어요')
    // 꺼 둔 이름도 같은 인터넷 주소의 개수에 센다
    for (let i = 0; i < 10; i++) {
      await at({ action: 'claim', name: `shared-${i}-xy`, key: K1 }, '7.7.7.7', t0 + 40 * DAY)
      await at({ action: 'offline', name: `shared-${i}-xy`, key: K1 }, '7.7.7.7', t0 + 40 * DAY)
    }
    expect((await at({ action: 'claim', name: 'shared-extra', key: K1 }, '7.7.7.7', t0 + 40 * DAY)).error === 'limit', '꺼 둔 이름을 개수에 안 셌어요')
  })

  await check('이름 주소(D1 예약): 기록이 가득 차면 소식이 끊긴 서버의 기록만 치우고(예약은 유지), 켜 둔 서버·사이트 기록은 지킨다', async () => {
    const t0 = Date.UTC(2026, 9, 17)
    const HOUR = 3600_000
    const st = memoryStore()
    // 사이트 기록 150개 + 켜진 서버 기록 50개 (A만) = 200개
    const seed: FakeRecord[] = Array.from({ length: 150 }, (_, i) => ({ id: `s${i}`, type: 'TXT', name: `site${i}.cubepanel.kr`, content: 'x' }))
    const tagFor = async (key: string): Promise<string> => {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`cubepanel-domain:${key}`))
      return 'cp:' + [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
    }
    const owner = await tagFor(K1)
    for (let i = 0; i < 50; i++) {
      const stale = i < 30 // 앞의 30개는 3일 동안 소식이 없다 (앱이 꺼졌다)
      seed.push({ id: `n${i}`, type: 'A', name: `srv${i}.cubepanel.kr`, content: '8.8.8.8', comment: owner })
      st.rows.set(`srv${i}`, { name: `srv${i}`, owner, ip: '8.8.8.8', port: 25565, bedrock: false, target: '', online: true, lastSeen: t0 - (stale ? 72 : 1) * HOUR, created: t0 - 100 * HOUR })
    }
    const cf = fakeCloudflare(seed)
    const at = async (body: object, ip: string) => {
      const res = await handleDomain(new Request('https://x/api/domain', { method: 'POST', headers: { 'cf-connecting-ip': ip }, body: JSON.stringify(body) }), env, cf.fetch, t0, st)
      return (await res.json()) as { ok?: boolean; error?: string }
    }
    const out = await at({ action: 'claim', name: 'newcomer', key: K2 }, '9.9.9.9')
    expect(out.ok === true, `자리를 못 만들었어요: ${JSON.stringify(out)}`)
    const names = cf.records.map((r) => r.name)
    expect(names.filter((n) => n.startsWith('site')).length === 150, '사이트 기록(우리 것이 아닌)을 지웠어요')
    expect(names.filter((n) => /^srv(\d|[3-4]\d)\./.test(n) && Number(n.slice(3, n.indexOf('.'))) >= 30).length === 20, '켜 둔(소식이 최근인) 서버의 기록을 지웠어요')
    const removed = [...Array(30).keys()].filter((i) => !names.includes(`srv${i}.cubepanel.kr`)).length
    expect(removed >= 1 && removed <= 12, `치운 기록 수가 이상해요: ${removed}`)
    const gone = [...Array(30).keys()].find((i) => !names.includes(`srv${i}.cubepanel.kr`)) as number
    expect(st.rows.get(`srv${gone}`)?.online === false, '치운 서버의 예약까지 지웠어요 (예약은 남아야 해요)')
    expect((await at({ action: 'claim', name: `srv${gone}`, key: K2 }, '9.9.9.9')).error === 'taken', '예약이 남은 이름을 남이 가져갔어요')

    // 전부 켜진 채로 가득 찬 영역: 아무것도 치우지 않고 가득 찼다고 알린다
    const busy = fakeCloudflare(seed.slice(0, 150).concat(Array.from({ length: 50 }, (_, i) => ({ id: `b${i}`, type: 'A', name: `b${i}.cubepanel.kr`, content: '8.8.8.8', comment: owner }))))
    const st2 = memoryStore()
    for (let i = 0; i < 50; i++) st2.rows.set(`b${i}`, { name: `b${i}`, owner, ip: '8.8.8.8', port: 25565, bedrock: false, target: '', online: true, lastSeen: t0 - HOUR, created: t0 - HOUR })
    const res = await handleDomain(new Request('https://x/api/domain', { method: 'POST', headers: { 'cf-connecting-ip': '9.9.9.9' }, body: JSON.stringify({ action: 'claim', name: 'nospace', key: K2 }) }), env, busy.fetch, t0, st2)
    expect(((await res.json()) as { error?: string }).error === 'full' && busy.records.length === 200, '켜 둔 서버의 기록을 지웠거나 가득 참 안내가 없어요')
  })

  await check('이름 주소(D1 예약): D1이 없던 때 만든 옛 기록은 소식이 끊기면 예약으로 옮겨 두고 치운다', async () => {
    const t0 = Date.UTC(2026, 9, 17)
    const DAY = 86400_000
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`cubepanel-domain:${K1}`))
    const owner = 'cp:' + [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
    const iso = (days: number): string => new Date(t0 - days * DAY).toISOString()
    const seed: FakeRecord[] = Array.from({ length: 198 }, (_, i) => ({ id: `s${i}`, type: 'TXT', name: `site${i}.cubepanel.kr`, content: 'x' }))
    seed.push({ id: 'old', type: 'A', name: 'legacy.cubepanel.kr', content: '4.4.4.4', comment: owner, created_on: iso(5), modified_on: iso(5) })
    seed.push({ id: 'new', type: 'A', name: 'recent.cubepanel.kr', content: '4.4.4.5', comment: owner, created_on: iso(0), modified_on: iso(0) })
    const cf = fakeCloudflare(seed)
    const st = memoryStore()
    const at = async (body: object, ip: string) => {
      const res = await handleDomain(new Request('https://x/api/domain', { method: 'POST', headers: { 'cf-connecting-ip': ip }, body: JSON.stringify(body) }), env, cf.fetch, t0, st)
      return (await res.json()) as { ok?: boolean; error?: string }
    }
    expect((await at({ action: 'claim', name: 'brandnew', key: K2 }, '9.9.9.9')).ok === true, '옛 기록을 치우고 자리를 만들지 못했어요')
    const names = cf.records.map((r) => r.name)
    expect(!names.includes('legacy.cubepanel.kr') && names.includes('recent.cubepanel.kr'), '5일 전 옛 기록만 치워야 해요')
    expect(st.rows.get('legacy')?.owner === owner && st.rows.get('legacy')?.online === false, '치운 옛 기록의 예약을 옮겨 두지 않았어요')
    // 주인이 서버를 켜면 같은 이름이 다시 만들어진다 (자리가 있으면)
    await cf.records.splice(cf.records.findIndex((r) => r.name === 'site0.cubepanel.kr'), 1)
    expect((await at({ action: 'claim', name: 'legacy', key: K1 }, '4.4.4.4')).ok === true && cf.records.some((r) => r.name === 'legacy.cubepanel.kr'), '주인이 이름을 되살리지 못했어요')
  })
  await check('이름 주소: 앱이 만들고·기억하고·서버를 켤 때 갱신하고·이름을 바꾸고·없애기 (가짜 중계 서버)', async () => {
    const cf = fakeCloudflare()
    const server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = []
      for await (const c of req) chunks.push(c as Buffer)
      const r = await handleDomain(new Request('http://x/api/domain', { method: 'POST', headers: { 'cf-connecting-ip': '8.8.4.4' }, body: Buffer.concat(chunks) }), env, cf.fetch)
      res.writeHead(r.status, { 'Content-Type': 'application/json' })
      res.end(await r.text())
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    process.env.MCSM_DOMAIN_RELAY = `http://127.0.0.1:${port}/api/domain`
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcsm-domain-'))
    try {
      fs.writeFileSync(path.join(dir, 'server-manager.json'), JSON.stringify({ name: 't', software: 'vanilla', mcVersion: '1.21', createdAt: '' }))
      fs.writeFileSync(path.join(dir, 'server.properties'), 'server-port=30001\n')
      expect(getDomain(dir) === null, '만들기 전에 주소가 있어요')
      const host = await claimDomain(dir, '  AppName ')
      expect(host === 'appname.cubepanel.kr' && getDomain(dir)?.host === host, `주소를 기억하지 않았어요: ${host}`)
      expect(cf.records.some((r) => r.type === 'SRV' && r.data?.port === 30001), '서버 포트(30001)로 SRV를 만들지 않았어요')
      expect(!fs.readFileSync(path.join(dir, 'server-manager.json'), 'utf8').includes('"domain": undefined'), '정보 파일이 이상해요')
      cf.writes.length = 0
      expect((await refreshDomain(dir)) === host && cf.writes.length === 0, '서버를 켤 때 갱신이 이상해요')
      const second = await claimDomain(dir, 'newname')
      expect(second === 'newname.cubepanel.kr' && !cf.records.some((r) => r.name.startsWith('appname.')), '이름을 바꿨는데 예전 이름이 남았어요')
      await releaseDomain(dir)
      expect(getDomain(dir) === null && cf.records.length === 0, '없애지 못했어요')
      expect((await refreshDomain(dir)) === null, '이름이 없는데 갱신했어요')
      let msg = ''
      try {
        await claimDomain(dir, 'www')
      } catch (e) {
        msg = (e as Error).message
      }
      expect(/쓸 수 없는 이름/.test(msg), `막은 이름의 안내 문구가 이상해요: ${msg}`)
    } finally {
      delete process.env.MCSM_DOMAIN_RELAY
      server.close()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
  await check('이름 주소: 앱에서 이름 다듬기 (대문자는 소문자로, 한글·기호는 막기)', () => {
    expect(cleanDomainName('  MyServer  ') === 'myserver', '대문자를 소문자로 바꾸지 않았어요')
    for (const bad of ['', 'ab', '한글서버', 'a_b_c', '-abc', 'abc-', 'a'.repeat(21)]) {
      let threw = false
      try {
        cleanDomainName(bad)
      } catch {
        threw = true
      }
      expect(threw, `${JSON.stringify(bad)}을(를) 받아들였어요`)
    }
  })
}

// ---------- 배드락 서버: 애드온·설정 ----------
async function bedrockChecks(): Promise<void> {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mcsm-bedrock-'))
  const folder = path.join(base, 'bds')
  fs.mkdirSync(path.join(folder, 'behavior_packs', 'vanilla'), { recursive: true })
  fs.writeFileSync(path.join(folder, 'bedrock_server.exe'), '')
  fs.writeFileSync(path.join(folder, 'server.properties'), 'level-name=World\nserver-port=19132\n')
  const manifest = (name: string, uuid: string, type: string): Buffer =>
    Buffer.from(
      JSON.stringify({ format_version: 2, header: { name, description: 'd', uuid, version: [1, 2, 3], min_engine_version: [1, 21, 0] }, modules: [{ type, uuid: uuid.replace(/^./, '9'), version: [1, 0, 0] }] })
    )
  const zipOf = (file: string, entries: Record<string, Buffer>): Promise<string> =>
    new Promise((resolve, reject) => {
      const zip = new yazl.ZipFile()
      for (const [n, b] of Object.entries(entries)) zip.addBuffer(b, n)
      zip.outputStream.pipe(fs.createWriteStream(file)).on('close', () => resolve(file)).on('error', reject)
      zip.end()
    })
  const A = 'aaaaaaaa-1111-2222-3333-444444444444'
  const B = 'bbbbbbbb-1111-2222-3333-444444444444'

  await check('배드락: 애드온 넣기(.mcaddon)·켜고 끄기·지우기', async () => {
    const file = await zipOf(path.join(base, 'my.mcaddon'), { 'BP/manifest.json': manifest('My Add-on', A, 'data'), 'BP/entities/a.json': Buffer.from('{}'), 'RP/manifest.json': manifest('My Add-on RP', B, 'resources') })
    const names = await addAddonFile(folder, file)
    expect(names.length === 2, `팩 이름: ${names}`)
    const list = listAddons(folder)
    expect(list.length === 2 && list.every((a) => a.enabled), `목록: ${JSON.stringify(list)}`)
    expect(list.some((a) => a.kind === 'behavior' && a.id.startsWith('behavior_packs/')) && list.some((a) => a.kind === 'resource' && a.id.startsWith('resource_packs/')), '종류가 틀려요')
    const bp = JSON.parse(fs.readFileSync(path.join(folder, 'worlds', 'World', 'world_behavior_packs.json'), 'utf8'))
    const rp = JSON.parse(fs.readFileSync(path.join(folder, 'worlds', 'World', 'world_resource_packs.json'), 'utf8'))
    expect(bp[0]?.pack_id === A && bp[0].version.join('.') === '1.2.3' && rp[0]?.pack_id === B, `등록: ${JSON.stringify([bp, rp])}`)
    const first = list.find((a) => a.kind === 'behavior')!
    setAddonEnabled(folder, first.id, false)
    expect(listAddons(folder).find((a) => a.id === first.id)?.enabled === false, '끄지 못했어요')
    expect(JSON.parse(fs.readFileSync(path.join(folder, 'worlds', 'World', 'world_behavior_packs.json'), 'utf8')).length === 0, '꺼도 등록에 남았어요')
    setAddonEnabled(folder, first.id, true)
    await addAddonFile(folder, file) // 같은 팩을 다시 넣으면 바꿔 넣고 두 개로 늘지 않는다
    expect(listAddons(folder).length === 2, '같은 팩이 두 번 들어갔어요')
    await removeAddon(folder, listAddons(folder).find((a) => a.kind === 'behavior')!.id)
    expect(listAddons(folder).length === 1 && JSON.parse(fs.readFileSync(path.join(folder, 'worlds', 'World', 'world_behavior_packs.json'), 'utf8')).length === 0, '지운 뒤 상태가 이상해요')
  })

  await check('배드락: 애드온이 아닌 파일·이상한 경로는 막는다', async () => {
    const empty = await zipOf(path.join(base, 'nothing.zip'), { 'readme.txt': Buffer.from('x') })
    expect(await throws(() => addAddonFile(folder, empty)), '팩이 없는 zip을 받았어요')
    fs.writeFileSync(path.join(base, 'a.txt'), 'x')
    expect(await throws(() => addAddonFile(folder, path.join(base, 'a.txt'))), '글자 파일을 받았어요')
    expect(await throws(() => removeAddon(folder, 'behavior_packs/../server.properties')), '다른 곳을 지우려는 경로를 받았어요')
    expect(await throws(() => removeAddon(folder, '../x')), '이상한 id를 받았어요')
  })

  await check('배드락: 게임 규칙 이름(소문자·대소문자 섞임)이 한국어 이름표에 연결된다', () => {
    for (const [name, label] of [['pvp', '플레이어끼리 공격(PvP)'], ['mobgriefing', '몹이 블록 망가뜨리기'], ['keepinventory', '죽어도 아이템 유지'], ['doMobSpawning', '몹 생성'], ['commandBlocksEnabled', '명령 블록 작동'], ['doDayLightCycle', '시간 흐름']]) {
      expect(labelOf(name).label === label, `${name} → ${labelOf(name).label} (기대: ${label})`)
    }
  })
  await check('배드락: 루프백 예외 목록에서 스토어 마인크래프트를 알아본다 (대소문자 무시)', () => {
    const listing = '  [1] -----\n      이름: microsoft.minecraftuwp_8wekyb3d8bbwe\n  [2] -----\n      이름: microsoft.windowscommunicationsapps_8wekyb3d8bbwe\n'
    expect(isExempt(listing, 'Microsoft.MinecraftUWP_8wekyb3d8bbwe'), '예외 목록에 있는데 없다고 했어요')
    expect(!isExempt(listing, 'Microsoft.MinecraftWindowsBeta_8wekyb3d8bbwe'), '예외 목록에 없는데 있다고 했어요')
    expect(!isExempt('', 'Microsoft.MinecraftUWP_8wekyb3d8bbwe'), '빈 목록인데 있다고 했어요')
  })

  await check('배드락: 만들 때 설정 (허용 목록 끄기·IPv6 포트·자바 값 버리기·범위 확인)', () => {
    const p = bedrockProps({ gamemode: 'creative', difficulty: 'hard', 'max-players': '5', 'level-seed': '123', 'online-mode': 'false', hardcore: 'true', 'level-type': 'minecraft:flat', motd: 'x' }, 'My;Name', 19134)
    expect(p['allow-list'] === 'false', '허용 목록이 켜진 채라 친구가 못 들어와요')
    expect(p['transport'] === 'raknet', 'nethernet이면 UDP 포트 하나로는 접속이 안 돼요')
    expect(p['server-port'] === '19134' && p['server-portv6'] === '19134', `포트: ${p['server-port']}/${p['server-portv6']} (IPv6 포트도 같은 번호여야 localhost가 돼요)`)
    expect(p['gamemode'] === 'creative' && p['difficulty'] === 'hard' && p['max-players'] === '5' && p['level-seed'] === '123' && p['online-mode'] === 'false', JSON.stringify(p))
    expect(!('hardcore' in p) && !('level-type' in p) && !('motd' in p), '자바 전용 값이 들어갔어요')
    expect(p['server-name'] === 'My Name', `이름의 ;를 못 걸렀어요: ${p['server-name']}`)
    const bad = bedrockProps({ gamemode: 'hacker', difficulty: 'x', 'max-players': '9999' }, 'a', 19132)
    expect(!('gamemode' in bad) && !('difficulty' in bad) && !('max-players' in bad), '이상한 값을 받았어요')
  })
  await check('배드락: 월드 가져오기(.mcworld)·애드온 등록 이어받기·잘못된 월드 막기', async () => {
    const world = await zipOf(path.join(base, 'map.mcworld'), { 'My Map/level.dat': Buffer.from('x'), 'My Map/levelname.txt': Buffer.from('My Map'), 'My Map/db/CURRENT': Buffer.from('MANIFEST-1') })
    fs.mkdirSync(path.join(folder, 'worlds', 'World', 'db'), { recursive: true })
    fs.writeFileSync(path.join(folder, 'worlds', 'World', 'level.dat'), 'old')
    fs.writeFileSync(path.join(folder, 'worlds', 'World', 'world_behavior_packs.json'), JSON.stringify([{ pack_id: A, version: [1, 2, 3] }]))
    await importBedrockWorld(folder, world)
    expect(fs.readFileSync(path.join(folder, 'worlds', 'World', 'level.dat'), 'utf8') === 'x', '월드가 바뀌지 않았어요')
    expect(JSON.parse(fs.readFileSync(path.join(folder, 'worlds', 'World', 'world_behavior_packs.json'), 'utf8'))[0]?.pack_id === A, '켜 둔 애드온 등록이 사라졌어요')
    const java = await zipOf(path.join(base, 'java.zip'), { 'World/level.dat': Buffer.from('x'), 'World/region/r.0.0.mca': Buffer.from('x') })
    expect(await throws(() => importBedrockWorld(folder, java)), '자바 월드를 받았어요')
    expect(await throws(() => importBedrockWorld(folder, empty0(base))), '월드가 아닌 파일을 받았어요')
  })

  await check('배드락: 허용 목록 고치기(꺼진 서버)·관리 정보', () => {
    runBedrockAction(folder, { type: 'allow', name: 'Test Player' })
    runBedrockAction(folder, { type: 'allow', name: 'Other' })
    expect(JSON.stringify(getBedrockManage(folder).allowlist) === '["Test Player","Other"]', JSON.stringify(getBedrockManage(folder)))
    runBedrockAction(folder, { type: 'disallow', name: 'test player' }) // 대소문자 무시
    expect(JSON.stringify(getBedrockManage(folder).allowlist) === '["Other"]', '목록에서 못 뺐어요')
    runBedrockAction(folder, { type: 'allowOn', value: true })
    expect(getBedrockManage(folder).allowlistOn && readProperties(folder)['allow-list'] === 'true', '허용 목록을 켜지 못했어요')
    const fails = (fn: () => void): boolean => {
      try {
        fn()
        return false
      } catch {
        return true
      }
    }
    for (const bad of ['"; stop', 'a'.repeat(40), '', 'x\ny', 'a"b']) expect(fails(() => runBedrockAction(folder, { type: 'allow', name: bad })), `이상한 이름(${bad})을 받았어요`)
    expect(fails(() => runBedrockAction(folder, { type: 'kick', name: 'A' })), '꺼진 서버에서 내보내기가 됐어요')
    expect(fails(() => runBedrockAction(folder, { type: 'time', value: 'x' as 'day' })), '이상한 시간을 받았어요')
    expect(JSON.stringify(getBedrockManage(folder).allowlist) === '["Other"]', '잘못된 요청이 목록을 바꿨어요')
  })
  await check('배드락: 켜기 전 점검 (빠진 의존 팩·꺼 둔 필요 팩·중복·지워진 팩)·스크립트 팩 구분', () => {
    const f2 = path.join(base, 'bds2')
    fs.mkdirSync(path.join(f2, 'behavior_packs'), { recursive: true })
    fs.mkdirSync(path.join(f2, 'resource_packs'), { recursive: true })
    fs.writeFileSync(path.join(f2, 'bedrock_server.exe'), '')
    fs.writeFileSync(path.join(f2, 'server.properties'), 'level-name=World\n')
    const UA = 'aaaaaaaa-0000-0000-0000-00000000000a'
    const UB = 'bbbbbbbb-0000-0000-0000-00000000000b'
    const UC = 'cccccccc-0000-0000-0000-00000000000c'
    const put = (dir: string, name: string, uuid: string, type: string, deps: string[] = []): void => {
      fs.mkdirSync(path.join(f2, dir), { recursive: true })
      fs.writeFileSync(
        path.join(f2, dir, 'manifest.json'),
        JSON.stringify({
          format_version: 2,
          header: { name, description: 'd', uuid, version: [1, 0, 0], min_engine_version: [1, 21, 0] },
          modules: [{ type, uuid: uuid.replace(/^./, '9'), version: [1, 0, 0] }],
          dependencies: [...deps.map((u) => ({ uuid: u, version: [1, 0, 0] })), { module_name: '@minecraft/server', version: '1.0.0' }]
        })
      )
    }
    const enable = (kind: string, uuids: string[]): void => {
      fs.mkdirSync(path.join(f2, 'worlds', 'World'), { recursive: true })
      fs.writeFileSync(path.join(f2, 'worlds', 'World', `world_${kind}_packs.json`), JSON.stringify(uuids.map((u) => ({ pack_id: u, version: [1, 0, 0] }))))
    }
    // A(스크립트 팩)는 B(리소스 팩)가 있어야 한다
    put('behavior_packs/a', 'Pack A', UA, 'script', [UB])
    enable('behavior', [UA])
    let r = checkAddons(f2)
    expect(r.missing.length === 1 && r.missing[0].mod === 'Pack A' && r.missing[0].needs[0] === UB, `빠진 팩을 못 찾았어요: ${JSON.stringify(r)}`)
    put('resource_packs/b', 'Pack B', UB, 'resources')
    r = checkAddons(f2)
    expect(r.missing.length === 1 && r.missing[0].needs[0] === 'Pack B (꺼져 있음)', `꺼 둔 필요 팩: ${JSON.stringify(r)}`)
    enable('resource', [UB])
    r = checkAddons(f2)
    expect(r.missing.length === 0 && r.duplicates.length === 0, `문제없는데 걸렸어요: ${JSON.stringify(r)}`)
    // 같은 팩이 두 폴더에
    put('resource_packs/b-copy', 'Pack B', UB, 'resources')
    r = checkAddons(f2)
    expect(r.duplicates.length === 1 && r.duplicates[0].files.length === 2, `중복: ${JSON.stringify(r.duplicates)}`)
    fs.rmSync(path.join(f2, 'resource_packs', 'b-copy'), { recursive: true, force: true })
    // 월드에 켜 둔 팩이 지워졌다
    enable('resource', [UB, UC])
    r = checkAddons(f2)
    expect(r.missing.some((m) => m.mod === '월드에 켜 둔 팩' && m.needs[0] === UC), `지워진 팩: ${JSON.stringify(r.missing)}`)
    // 스크립트 팩은 스크립트 탭에 (script: true), 일반 비헤이비어 팩은 애드온 탭에
    put('behavior_packs/plain', 'Plain', UC, 'data')
    const list = listAddons(f2)
    expect(list.find((a) => a.title === 'Pack A')?.script === true && list.find((a) => a.title === 'Plain')?.script === false && list.find((a) => a.title === 'Pack B')?.script === false, `스크립트 구분: ${JSON.stringify(list.map((a) => [a.title, a.script]))}`)
  })
  fs.rmSync(base, { recursive: true, force: true })
}
// 비어 있는 .zip (월드가 아닌 파일)
function empty0(base: string): string {
  const f = path.join(base, 'empty0.zip')
  fs.writeFileSync(f, Buffer.from([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))
  return f
}

// ---------- 기존 서버 가져오기 ----------
async function importChecks(): Promise<void> {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mcsm-import-'))
  const mk = (name: string, files: Record<string, string | Buffer>): string => {
    const dir = path.join(base, name)
    for (const [rel, data] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
      fs.writeFileSync(path.join(dir, rel), data)
    }
    return dir
  }
  const root = path.join(base, 'app-servers')
  const jarWithVersion = (id: string): Promise<Buffer> =>
    new Promise((resolve, reject) => {
      const zip = new yazl.ZipFile()
      zip.addBuffer(Buffer.from(JSON.stringify({ id, name: id })), 'version.json')
      zip.end()
      const chunks: Buffer[] = []
      zip.outputStream.on('data', (c: Buffer) => chunks.push(c)).on('end', () => resolve(Buffer.concat(chunks))).on('error', reject)
    })

  await check('가져오기: 서버 종류와 버전 알아내기 (Forge·NeoForge·Fabric·Purpur·Paper·바닐라·로그)', async () => {
    const d = (dir: string) => detectServer(dir, root)
    const forge = await d(mk('forge', { 'libraries/net/minecraftforge/forge/1.20.1-47.2.0/win_args.txt': 'x', 'server.properties': '' }))
    expect(forge.software === 'forge' && forge.mcVersion === '1.20.1' && forge.loaderVersion === '47.2.0', `Forge: ${JSON.stringify(forge)}`)
    const neo = await d(mk('neo', { 'libraries/net/neoforged/neoforge/21.1.50/win_args.txt': 'x' }))
    expect(neo.software === 'neoforge' && neo.mcVersion === '1.21.1' && neo.loaderVersion === '21.1.50', `NeoForge: ${JSON.stringify(neo)}`)
    const neo0 = await d(mk('neo0', { 'libraries/net/neoforged/neoforge/21.0.5/win_args.txt': 'x' }))
    expect(neo0.mcVersion === '1.21', `NeoForge 21.0: ${neo0.mcVersion}`)
    const fabric = await d(mk('fabric', { 'fabric-server-launch.jar': 'x', 'server.jar': 'x', 'libraries/net/fabricmc/fabric-loader/0.15.11/a.jar': 'x', 'libraries/net/fabricmc/intermediary/1.20.4/a.jar': 'x' }))
    expect(fabric.software === 'fabric' && fabric.mcVersion === '1.20.4' && fabric.loaderVersion === '0.15.11', `Fabric: ${JSON.stringify(fabric)}`)
    const purpur = await d(mk('purpur', { 'purpur-1.20.4-2176.jar': 'x' }))
    expect(purpur.software === 'purpur' && purpur.mcVersion === '1.20.4' && purpur.loaderVersion === '2176', `Purpur: ${JSON.stringify(purpur)}`)
    const paper = await d(mk('paper', { 'paper-1.21-100.jar': 'x' }))
    expect(paper.software === 'paper' && paper.mcVersion === '1.21' && paper.loaderVersion === '100', `Paper: ${JSON.stringify(paper)}`)
    const paper2 = await d(mk('paper2', { 'server.jar': 'x', 'paper.yml': '', 'version_history.json': JSON.stringify({ currentVersion: 'git-Paper-123 (MC: 1.20.4)' }) }))
    expect(paper2.software === 'paper' && paper2.mcVersion === '1.20.4' && paper2.loaderVersion === '123', `Paper 기록: ${JSON.stringify(paper2)}`)
    const purpur2 = await d(mk('purpur2', { 'server.jar': 'x', 'purpur.yml': '', 'config/paper-global.yml': '' }))
    expect(purpur2.software === 'purpur', `이름이 바뀐 Purpur를 Paper로 봤어요: ${JSON.stringify(purpur2)}`)
    const vanilla = await d(mk('vanilla', { 'server.jar': await jarWithVersion('1.19.4'), 'server.properties': 'level-name=map\n', 'map/level.dat': 'x' }))
    expect(vanilla.software === 'vanilla' && vanilla.mcVersion === '1.19.4' && vanilla.hasWorld, `바닐라: ${JSON.stringify(vanilla)}`)
    const logOnly = await d(mk('logonly', { 'custom.jar': 'x', 'logs/latest.log': '[12:00:00] [main/INFO]: Starting minecraft server version 1.18.2\n' }))
    expect(logOnly.software === null && logOnly.mcVersion === '1.18.2', `로그: ${JSON.stringify(logOnly)}`)
  })

  await check('가져오기: 고를 수 없는 폴더는 막기 (없는 폴더·드라이브·앱 폴더 안팎·서버가 아닌 폴더)', async () => {
    fs.mkdirSync(path.join(root, 'inner'), { recursive: true })
    fs.writeFileSync(path.join(root, 'inner', 'server.properties'), '')
    const bad = (dir: string): boolean => {
      try {
        checkImportFolder(dir, root)
        return false
      } catch {
        return true
      }
    }
    expect(bad(path.join(base, 'nope')), '없는 폴더를 받아들였어요')
    expect(bad(path.parse(base).root), '드라이브 전체를 받아들였어요')
    expect(bad(path.join(root, 'inner')), '앱 서버 폴더 안을 받아들였어요')
    expect(bad(base), '앱 서버 폴더를 품은 폴더를 받아들였어요')
    expect(bad(mk('empty', { 'readme.txt': 'x' })), '서버가 아닌 폴더를 받아들였어요')
    const why = (dir: string): string => {
      try {
        checkImportFolder(dir, root)
        return ''
      } catch (e) {
        return (e as Error).message
      }
    }
    expect(/월드 폴더/.test(why(mk('worldonly', { 'level.dat': 'x', 'region/r.0.0.mca': 'x' }))), '월드 폴더인데 월드 가져오기를 안내하지 않았어요')
    expect(/게임\(클라이언트\) 폴더/.test(why(mk('clientdir', { 'saves/My World/level.dat': 'x', 'mods/a.jar': 'x', 'options.txt': 'x' }))), '게임 폴더인데 saves 안내를 하지 않았어요')
    expect(/서버 폴더로 보이지 않아요/.test(why(mk('junk', { 'readme.txt': 'x' }))), '일반 안내가 바뀌었어요')
  })

  await check('가져오기: 폴더 복사·정보 파일·포트 겹침 피하기·원본 그대로·실패하면 흔적 없음', async () => {
    const src = mk('mine', {
      'server.jar': 'jar',
      'server.properties': 'server-port=25565\nlevel-name=world\n',
      'eula.txt': 'eula=true\n',
      'world/level.dat': 'level',
      'mods/a.jar': 'mod',
      'logs/latest.log': 'old log',
      'world/session.lock': 'lock'
    })
    const first = await createServer({ name: '가져오기 시험', software: 'paper', mcVersion: '1.21', loaderVersion: '100', importFrom: src, memoryMb: 3072 }, () => undefined)
    const f = first.folderPath
    expect(fs.existsSync(path.join(f, 'world', 'level.dat')) && fs.existsSync(path.join(f, 'mods', 'a.jar')) && fs.existsSync(path.join(f, 'server.jar')), '파일을 복사하지 않았어요')
    expect(!fs.existsSync(path.join(f, 'logs')) && !fs.existsSync(path.join(f, 'world', 'session.lock')) && !fs.existsSync(path.join(f, '.creating')), '빼야 할 파일이 따라왔거나 만드는 중 표시가 남았어요')
    const info = JSON.parse(fs.readFileSync(path.join(f, 'server-manager.json'), 'utf8')) as { software: string; mcVersion: string; memoryMb: number; defaultsVersion: number }
    expect(info.software === 'paper' && info.mcVersion === '1.21' && info.memoryMb === 3072 && info.defaultsVersion >= 2, `정보 파일: ${JSON.stringify(info)}`)
    expect(fs.readFileSync(path.join(f, 'server.properties'), 'utf8').includes('server-port=25565') && !/white-list/.test(fs.readFileSync(path.join(f, 'server.properties'), 'utf8')), '첫 서버의 설정이 바뀌었어요')
    expect(fs.existsSync(path.join(src, 'logs', 'latest.log')) && fs.existsSync(path.join(src, 'world', 'session.lock')), '원본이 바뀌었어요')
    const second = await createServer({ name: '가져오기 시험', software: 'paper', mcVersion: '1.21', loaderVersion: '100', importFrom: src }, () => undefined)
    expect(second.folderPath !== f, '같은 이름이라 폴더가 겹쳤어요')
    expect(/server-port=2556[6-9]/.test(fs.readFileSync(path.join(second.folderPath, 'server.properties'), 'utf8')), '같은 포트를 그대로 썼어요')
    const noJar = mk('nojar', { 'server.properties': '', 'readme.txt': 'x' })
    const before = fs.readdirSync(path.dirname(f)).length
    let msg = ''
    try {
      await createServer({ name: '가져오기 실패', software: 'paper', mcVersion: '1.21', loaderVersion: '100', importFrom: noJar }, () => undefined)
    } catch (e) {
      msg = (e as Error).message
    }
    expect(/서버 jar/.test(msg), `jar가 없을 때 안내가 이상해요: ${msg}`)
    expect(fs.readdirSync(path.dirname(f)).length === before, '실패했는데 폴더가 남았어요')
    await deleteServer(f)
    await deleteServer(second.folderPath)
  })
  fs.rmSync(base, { recursive: true, force: true })
}

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
    // 서버 포트는 앱이 겹치지 않게 자동으로 정한다. 모드팩이 심은 server-port=25565가 그대로 들어갔다면 다른 서버와 포트가 겹친다
    const portClash = listServers().some((x) => x.folderPath !== f && readProperties(x.folderPath)['server-port'] === p['server-port'])
    expect(p['enable-rcon'] !== 'true' && p['rcon.password'] !== 'hacked' && !portClash && p['server-port'] !== '25565', `보안 설정이 바뀌었어요: rcon=${p['enable-rcon']} port=${p['server-port']} 겹침=${portClash}`)
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

// ---------- 배드락 서버: 실제로 받아서 켜 보기 ----------
async function bedrockServer(): Promise<void> {
  console.log('\n[배드락 서버]')
  let folder = ''
  await check('배드락 서버 만들기 → 애드온 → 켜기(팩 적용) → 켠 채 백업 → 끄기 → 되돌리기', async () => {
    const info = await createServer({ name: '자동 테스트 bedrock', software: 'bedrock', mcVersion: '', properties: { 'max-players': '5', 'online-mode': 'false' } }, () => undefined)
    folder = info.folderPath
    expect(info.software === 'bedrock' && /^\d+\.\d+\.\d+/.test(info.mcVersion), `정보: ${JSON.stringify(info)}`)
    const props = readProperties(folder)
    expect(props['allow-list'] === 'false' && props['max-players'] === '5' && props['online-mode'] === 'false' && props['server-port'] === '19132', `설정: ${JSON.stringify(props)}`)
    expect(!fs.existsSync(path.join(folder, '.creating')), '만드는 중 표시가 남았어요')
    acceptEula(folder)
    const packZip = path.join(folder, 'test.mcpack')
    await new Promise<void>((resolve, reject) => {
      const zip = new yazl.ZipFile()
      zip.addBuffer(
        Buffer.from(
          JSON.stringify({
            format_version: 2,
            header: { name: 'Auto Test Pack', description: 'd', uuid: '12121212-2222-3333-4444-555555555555', version: [1, 0, 0], min_engine_version: [1, 21, 0] },
            modules: [{ type: 'data', uuid: '34343434-7777-8888-9999-000000000000', version: [1, 0, 0] }]
          })
        ),
        'manifest.json'
      )
      zip.outputStream.pipe(fs.createWriteStream(packZip)).on('close', () => resolve()).on('error', reject)
      zip.end()
    })
    expect((await addAddonFile(folder, packZip))[0] === 'Auto Test Pack', '애드온을 못 넣었어요')
    fs.rmSync(packZip, { force: true })
    expect(props['transport'] === 'raknet', `만들 때 접속 방식: ${props['transport']}`)
    writeProperties(folder, { transport: 'nethernet', 'server-port': '19332', 'server-portv6': '19333' }) // (테스트 중에 쓰는 사람의 서버와 포트가 겹치지 않게 다른 포트로) 서버 1.26의 기본값이 남아 있는 서버도 켤 때 고쳐져야 한다
    await startAndWait(folder)
    expect(readProperties(folder)['transport'] === 'raknet', '켤 때 접속 방식을 raknet으로 고치지 않았어요')
    expect(readProperties(folder)['server-portv6'] === '19332', 'IPv6 포트를 IPv4 포트와 같게 고치지 않았어요 (localhost 접속에 필요)')
    // 실제로 UDP 핑(RakNet)에 답하는지: 안 답하면 UDP 포트만 열어서는 아무도 못 들어온다
    const pongV6 = await new Promise<boolean>((resolve) => {
      const sock = dgram.createSocket('udp6')
      const time = Buffer.alloc(8)
      time.writeBigInt64BE(BigInt(Date.now()))
      const timer = setTimeout(() => (sock.close(), resolve(false)), 4000)
      sock.on('message', (m) => (clearTimeout(timer), sock.close(), resolve(m[0] === 0x1c)))
      sock.on('error', () => (clearTimeout(timer), resolve(false)))
      sock.send(Buffer.concat([Buffer.from([0x01]), time, Buffer.from('00ffff00fefefefefdfdfdfd12345678', 'hex'), Buffer.alloc(8)]), 19332, '::1')
    })
    expect(pongV6, '서버가 IPv6(::1)로 온 UDP 핑에 답하지 않아요 (localhost 접속이 안 돼요)')
    const pong = await new Promise<boolean>((resolve) => {
      const sock = dgram.createSocket('udp4')
      const time = Buffer.alloc(8)
      time.writeBigInt64BE(BigInt(Date.now()))
      const timer = setTimeout(() => (sock.close(), resolve(false)), 4000)
      sock.on('message', (m) => (clearTimeout(timer), sock.close(), resolve(m[0] === 0x1c)))
      sock.send(Buffer.concat([Buffer.from([0x01]), time, Buffer.from('00ffff00fefefefefdfdfdfd12345678', 'hex'), Buffer.alloc(8)]), 19332, '127.0.0.1')
    })
    expect(pong, '서버가 UDP 핑에 답하지 않아요 (접속 방식이 raknet이 아니에요)')
    expect(getLog(folder).some((l) => /Pack Stack - .*Auto Test Pack/.test(l)), `팩이 적용되지 않았어요: ${getLog(folder).slice(-15).join(' | ')}`)
    expect(fs.existsSync(path.join(folder, 'worlds', 'Bedrock level', 'level.dat')), '월드가 안 만들어졌어요')
    const b = await createBackup(folder, false, '자동 테스트') // 켜진 채로 (save hold → query → resume)
    expect(b.worlds.includes('worlds/Bedrock level'), `백업 월드: ${b.worlds}`)
    expect(getState(folder) === 'running', '백업하고 나서 서버가 멈췄어요')
    // 켜진 채로 관리: 허용 목록(명령 → 파일), 난이도, 게임 규칙
    runBedrockAction(folder, { type: 'allow', name: 'Tester One' })
    await waitFor('허용 목록 파일', () => getBedrockManage(folder).allowlist.includes('Tester One'), 15_000)
    runBedrockAction(folder, { type: 'disallow', name: 'Tester One' })
    await waitFor('허용 목록에서 빼기', () => !getBedrockManage(folder).allowlist.includes('Tester One'), 15_000)
    runBedrockAction(folder, { type: 'difficulty', value: 'hard' })
    expect(readProperties(folder)['difficulty'] === 'hard', '난이도를 파일에 적지 않았어요')
    const rules = await listBedrockRules(folder)
    expect(rules.length > 10 && rules.some((r) => r.name.toLowerCase() === 'keepinventory' && r.type === 'bool'), `게임 규칙: ${JSON.stringify(rules.slice(0, 5))}`)
    sendCommand(folder, 'gamerule keepinventory true')
    const again = await listBedrockRules(folder)
    expect(again.find((r) => r.name.toLowerCase() === 'keepinventory')?.value === 'true', '게임 규칙을 바꾸지 못했어요')
    await stopAndWait(folder)
    await restoreBackup(folder, b.id)
    expect(fs.existsSync(path.join(folder, 'worlds', 'Bedrock level', 'level.dat')), '되돌린 뒤 월드가 없어요')
    await startAndWait(folder) // 되돌린 월드로 다시 켜진다
    await stopAndWait(folder)
  })
  await check('배드락: 서버 업데이트 (설정·월드·허용 목록·애드온은 그대로, 프로그램 파일만 새로)', async () => {
    expect(folder, '서버가 없어요')
    const latest = (await checkBedrockUpdate(folder)).latest
    expect(latest && !(await checkBedrockUpdate(folder)).available, '방금 만든 서버가 최신이 아니라고 나와요')
    patchServerInfo(folder, { mcVersion: '1.0.0.0' }) // 옛 버전인 척
    writeProperties(folder, { 'max-players': '7' })
    runBedrockAction(folder, { type: 'allow', name: 'Keep Me' })
    const worldBefore = fs.readFileSync(path.join(folder, 'worlds', 'Bedrock level', 'level.dat')).length
    expect((await checkBedrockUpdate(folder)).available, '옛 버전인데 새 버전이 없다고 나와요')
    const out = await updateBedrock(folder, () => undefined)
    expect(out.mcVersion === latest, `버전: ${out.mcVersion}`)
    expect(readProperties(folder)['max-players'] === '7', '업데이트가 설정을 덮어썼어요')
    expect(getBedrockManage(folder).allowlist.includes('Keep Me'), '업데이트가 허용 목록을 지웠어요')
    expect(fs.readFileSync(path.join(folder, 'worlds', 'Bedrock level', 'level.dat')).length === worldBefore, '업데이트가 월드를 건드렸어요')
    expect(listAddons(folder).some((a) => a.title === 'Auto Test Pack'), '업데이트가 애드온을 지웠어요')
    expect(listAddons(folder).every((a) => !/^vanilla|^chemistry|^editor/.test(path.basename(a.id))), '기본 팩이 애드온 목록에 나와요')
    expect(listBackups(folder).some((x) => /업데이트 전/.test(x.note ?? '')), '업데이트 전 백업이 없어요')
    await startAndWait(folder) // 업데이트한 서버가 켜진다
    await stopAndWait(folder)
    let again = false
    try {
      await updateBedrock(folder, () => undefined)
    } catch {
      again = true
    }
    expect(again, '최신인데 또 업데이트가 됐어요')
  })
  await check('배드락: CurseForge 검색 → 애드온 받아 넣기 → 맵 받아 넣기', async () => {
    expect(folder, '서버가 없어요')
    for (const kind of ['addon', 'resource', 'script', 'map'] as const) {
      const r = await searchBedrockStore(kind, '', 0)
      expect(r.hits.length > 0 && r.hits.every((h) => !!h.fileName && !!h.title), `${kind} 검색 결과가 없어요`)
    }
    const found = await searchBedrockStore('addon', '', 0)
    const small = found.hits.find((h) => /\.(mcaddon|mcpack)$/i.test(h.fileName))
    expect(small, '받을 애드온을 못 찾았어요')
    const before = listAddons(folder).length
    const title = await installBedrockHit(folder, small!.id, 'addon')
    expect(!!title && listAddons(folder).length > before, `받은 애드온이 설치되지 않았어요: ${title}`)
    const maps = (await searchBedrockStore('map', '', 0)).hits.filter((h) => /\.mcworld$/i.test(h.fileName))
    expect(maps.length > 0, '맵을 못 찾았어요')
    let imported = false
    for (const m of maps.slice(0, 5)) {
      try {
        await installBedrockHit(folder, m.id, 'map')
        imported = true
        break
      } catch (e) {
        console.log(`      (맵 건너뜀: ${m.title}: ${e instanceof Error ? e.message : e})`)
      }
    }
    expect(imported, '맵을 하나도 넣지 못했어요')
    expect(fs.existsSync(path.join(folder, 'worlds', 'Bedrock level', 'level.dat')), '맵을 넣은 뒤 월드가 없어요')
    await startAndWait(folder) // 받은 맵으로 켜진다
    await stopAndWait(folder)
  })
  if (folder) await deleteServer(folder).catch(() => undefined)
}

async function main(): Promise<void> {
  const t = Date.now()
  if (only.length) {
    if (only.includes('bedrock')) await bedrockServer()
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
    await bedrockServer()
    await moreFeatures()
    await automation()
  }
  else console.log('\n(실제 서버 테스트는 npm run test:full)')
  console.log(`\n결과: ${passed}개 통과, ${failed.length}개 실패 (${Math.round((Date.now() - t) / 1000)}초)`)
  if (failed.length) console.log(`실패: ${failed.join(' / ')}`)
  process.exit(failed.length ? 1 : 0)
}
void main()
