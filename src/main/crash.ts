// 튕김 분석: 마지막 로그와 crash-reports의 새 보고서를 읽어서 원인·해결 방법·의심 모드를 알려 준다.
import fs from 'fs'
import path from 'path'
import type { CrashAnalysis, CrashDep, CrashSuspect } from '../shared-types'
import * as mods from './mods'
import { readProperties } from './properties'
import { getState } from './runner'

interface Ctx {
  text: string // 로그 끝부분 + 크래시 보고서
  report: string | null
}

type Rule = (c: Ctx) => Omit<CrashAnalysis, 'suspects' | 'datapacks' | 'deps' | 'reportPath' | 'excerpt'> | null

const has = (c: Ctx, re: RegExp): RegExpMatchArray | null => c.text.match(re)

// fabric-resource-loader-v1 같은 Fabric API 부품은 Fabric API 하나로 묶는다
const toProject = (id: string): string => (/^fabric-(?!api$|language)/.test(id) ? 'fabric-api' : id)

// 빠졌거나 버전이 안 맞는 모드들 (언어와 상관없는 줄만 읽는다)
function depsOf(c: Ctx): Omit<CrashDep, 'installedFile'>[] {
  const out = new Map<string, Omit<CrashDep, 'installedFile'>>()
  const add = (d: Omit<CrashDep, 'installedFile'>): void => {
    if (!out.has(d.id + '|' + d.breaks)) out.set(d.id + '|' + d.breaks, d)
  }
  // Fabric: "HARD_DEP_NO_CANDIDATE xaerominimap 26.5.3 {depends fabric-api @ [>=0.43.1]}" (NO_CANDIDATE = 없음)
  const fixAdd = c.text.match(/Fix: add (.*?), remove/)?.[1] ?? ''
  const addIds = new Set([...fixAdd.matchAll(/add:([\w-]+)/g)].map((m) => m[1]))
  for (const m of c.text.matchAll(/(HARD_DEP\w*|BREAKS?\w*) ([\w-]+) \S+ \{(depends|breaks) ([\w-]+) @ \[([^\]]*)\]\}/g)) {
    const breaks = m[3] === 'breaks'
    add({
      id: breaks ? m[4] : toProject(m[4]),
      requiredBy: titleOf(c, m[2]),
      missing: !breaks && (m[1].endsWith('NO_CANDIDATE') || addIds.has(m[4])),
      range: m[5] && m[5] !== '*' ? m[5] : undefined,
      breaks
    })
  }
  // Forge/NeoForge: "Mod ID: 'terrablender', Requested by: 'biomesoplenty', Expected range: '[26.3.0.0.0,)', Actual version: '[MISSING]'"
  for (const m of c.text.matchAll(/Mod ID: '([\w-]+)', Requested by: '([\w-]+)'(?:, Expected range: '([^']*)')?(?:, Actual version: '([^']*)')?/g))
    add({ id: m[1], requiredBy: titleOf(c, m[2]), missing: !m[4] || m[4] === '[MISSING]', range: m[3] || undefined, breaks: false })
  // 옛 Fabric·Quilt (영어 문장): "Mod 'A' (a) 1.0 requires version 2.0 or later of mod 'B' (b), which is missing!"
  //   "requires any version of fabric-api, which is missing!" / "…but only the wrong version is present"
  for (const m of c.text.matchAll(/Mod '([^\n]+?)' \(([\w-]+)\)[^\n]*? requires [^\n]*?(?:of mod '[^\n]+?' \(([\w-]+)\)|of ([\w-]+))[^\n]*?(missing|wrong version)/g))
    add({ id: toProject(m[3] ?? m[4]), requiredBy: m[1], missing: m[5] === 'missing', breaks: false })
  // Quilt: "- Install 'qsl', version 1.0 or later." 같은 줄은 요구하는 쪽을 몰라서 위 문장에서만 읽는다
  // Paper·Purpur 플러그인: "Could not load plugin 'Shop.jar' ... Unknown/missing dependency plugins: [Vault, LuckPerms]"
  //   옛 버전: "Could not load 'plugins/Shop.jar' in folder 'plugins'" + "UnknownDependencyException: Vault"
  for (const m of c.text.matchAll(/Could not load (?:plugin )?'(?:plugins[\\/])?([^'\n]+?)(?:\.jar)?'[\s\S]{0,600}?(?:Unknown\/missing dependency plugins: \[([^\]]+)\]|UnknownDependencyException:? (?!Unknown\/)(?:Unknown dependency )?([\w -]+))/g))
    for (const dep of (m[2] ?? m[3] ?? '').split(/,\s*/).map((x) => x.trim()).filter(Boolean))
      add({ id: dep, requiredBy: m[1], missing: true, breaks: false })
  return [...out.values()].filter((d) => !/^(minecraft|java|fabricloader|forge|neoforge|quilt_loader)$/.test(d.id)).slice(0, 8)
}

// 모드 ID로 로그에 적힌 이름을 찾는다: "Mod 'Xaero's Minimap' (xaerominimap)" / "모드 'Xaero's Minimap' (xaerominimap)"
const titleOf = (c: Ctx, id: string): string =>
  c.text.match(new RegExp(`(?:Mod|모드) '([^\\n]+?)' \\(${id.replace(/[-]/g, '\\-')}\\)`))?.[1] ?? id

// 위에서부터 먼저 맞는 것을 쓴다. 구체적인 원인일수록 위에 둔다.
const RULES: Rule[] = [
  // 월드 생성 설정이 없어도 서버가 "Failed to load datapacks"라고 찍어서, 데이터팩 규칙보다 먼저 본다
  (c) =>
    has(c, /Overworld settings missing|Unable to read or access the world gen settings file/i) && {
      title: '월드 설정 파일을 읽지 못했어요',
      cause: '월드의 생성 설정 파일(world_gen_settings)이 없거나 망가졌어요. 처음 켤 때 월드를 만들다가 멈췄거나, 다른 버전에서 만든 월드일 때 생겨요.',
      fixes: ['설정 → 월드에서 월드를 리셋하거나, 백업 탭에서 이전 월드로 되돌려 보세요.'],
      action: 'folder'
    },
  // "Failed to load datapacks"만으로는 데이터팩 탓인지 알 수 없다. 데이터팩 파일을 읽다 실패한 흔적이 있어야 한다
  (c) =>
    has(c, /Failed to parse [^\n]* from pack file\/|Errors in currently selected data ?packs/i) && {
      title: '데이터팩이 이 버전과 맞지 않아요',
      cause: `월드에 들어 있는 데이터팩이 다른 마인크래프트 버전용이라 읽지 못했어요. 맵을 가져왔다면 그 맵이 만들어진 버전과 서버 버전이 다를 때 자주 생겨요.`,
      fixes: ['아래 데이터팩을 끄고 다시 켜 보세요. (맵의 일부 기능이 빠질 수 있어요)', '맵이 만들어진 버전으로 서버를 새로 만들어 맵을 가져오면 제대로 돌아가요.'],
      action: 'folder'
    },
  (c) =>
    has(c, /OutOfMemoryError|GC overhead limit exceeded|Could not reserve enough space/i) && {
      title: '메모리가 부족해요',
      cause: '서버가 쓸 수 있는 메모리를 다 써서 멈췄어요. 모드가 많거나 여러 사람이 넓은 곳을 돌아다니면 생겨요.',
      fixes: ['설정 → 성능에서 메모리를 1~2GB 늘려 주세요.', '설정 → 월드에서 "보이는 거리"를 8~10으로 줄여 보세요.', '무거운 모드를 몇 개 빼 보세요.'],
      action: 'memory'
    },
  (c) =>
    has(c, /FAILED TO BIND TO PORT|Address already in use|BindException/i) && {
      title: '포트를 다른 프로그램이 쓰고 있어요',
      cause: '같은 포트(보통 25565)를 쓰는 다른 서버나 프로그램이 이미 켜져 있어요.',
      fixes: ['다른 마인크래프트 서버를 끄고 다시 켜 보세요.', '설정 → 접속에서 포트 번호를 바꿔 보세요 (예: 25566).'],
      action: 'settings'
    },
  (c) => {
    const m = has(c, /has been compiled by a more recent version of the Java Runtime \(class file version ([\d.]+)\)/)
    if (!m && !has(c, /UnsupportedClassVersionError/)) return null
    return {
      title: '자바 버전이 맞지 않는 모드가 있어요',
      cause: '어떤 모드(또는 플러그인)가 이 서버 버전보다 새 자바로 만들어졌어요. 보통 다른 마인크래프트 버전용 파일이에요.',
      fixes: ['아래 의심 파일이 이 서버 버전용인지 확인하고, 맞는 버전으로 바꿔 주세요.', '최근에 넣은 모드·플러그인을 꺼 보세요.']
    }
  },
  (c) => {
    const deps = depsOf(c)
    if (!deps.length && !has(c, /Incompatible mods? (?:found|set)|Missing or unsupported mandatory dependencies|ModResolutionException|Mod resolution failed/i)) return null
    // 모드 이름은 말하지 않는다. 거의 모든 모드가 쓰는 기본 라이브러리(Fabric API 등)가 빠진 경우만 알려 준다
    const BASE: Record<string, string> = { 'fabric-api': 'Fabric API', qsl: 'QSL', 'quilted-fabric-api': 'Quilted Fabric API' }
    const lines = deps
      .filter((d) => BASE[d.id] && !d.breaks)
      .map((d) => `${BASE[d.id]}${d.missing ? '가 설치돼 있지 않아요' : ' 버전이 맞지 않아요'}. 대부분의 모드가 필요로 하는 기본 모드예요.`)
    return {
      title: /Could not load (?:plugin )?'/.test(c.text) ? '필요한 플러그인이 없거나 버전이 맞지 않아요' : '모드끼리 맞지 않거나 필요한 모드가 없어요',
      cause: lines.length ? [...new Set(lines)].slice(0, 6).join('\n') : '어떤 모드가 필요로 하는 다른 모드가 없거나, 버전이 맞지 않아요.',
      fixes: deps.length
        ? ['아래 "필요한 모드"에서 설치·업데이트를 눌러 주세요.', '그래도 안 되면 아래 의심 모드를 꺼 주세요.']
        : ['모드 탭에서 빠진 모드를 검색해서 설치해 주세요.', '모드 탭 → 업데이트 확인으로 모두 최신으로 맞춰 보세요.'],
      action: 'mods'
    }
  },
  (c) =>
    has(c, /Found duplicate mods|Duplicate mods? found|DuplicateModsFoundException/i) && {
      title: '같은 모드가 두 번 들어 있어요',
      cause: '같은 모드의 파일이 mods 폴더에 두 개 있어요 (보통 버전만 다른 파일).',
      fixes: ['서버 폴더의 mods 폴더를 열어 같은 이름의 파일 중 오래된 것을 지워 주세요.'],
      action: 'folder'
    },
  (c) =>
    // 서버에서도 쓰는 모드인데 게임 화면 코드를 고치려다 실패 (클라이언트 전용 모드가 아니라 모드 쪽 버그)
    has(c, /@Mixin target net[./]minecraft[./]client[^\n]* was not found/i) && {
      title: '모드 하나가 서버에서 화면 코드를 건드려요',
      cause: '서버에서도 쓰는 모드인데, 이 버전은 서버에 없는 게임 화면 코드를 고치려다 튕겨요. 모드 쪽 버그라서 고쳐질 때까지는 그 모드를 빼야 해요.',
      fixes: ['아래 의심 모드를 꺼 주세요.', '모드 탭 → 업데이트 확인으로 고쳐진 버전이 나왔는지 보세요.'],
      action: 'mods'
    },
  (c) =>
    // 로그에는 net.minecraft.client 와 net/minecraft/client 두 가지로 적힌다
    has(c, /Environment type CLIENT|invalid dist DEDICATED_SERVER|Attempted to load class net[./]minecraft[./]client|NoClassDefFoundError: net[./]minecraft[./]client|ClassNotFoundException: net[./]minecraft[./]client/i) && {
      title: '게임하는 사람 컴퓨터용 모드가 서버에 있어요',
      cause: '미니맵·셰이더처럼 화면에 관련된 "클라이언트 전용" 모드는 서버에서 켜지면 튕겨요.',
      fixes: ['아래 의심 모드를 꺼 주세요.', '모르겠으면 최근에 넣은 모드부터 하나씩 꺼 보세요.'],
      action: 'mods'
    },
  (c) =>
    has(c, /Mixin apply failed|MixinApplyError|InvalidMixinException|MixinTransformerError|Critical injection failure/i) && {
      title: '모드 하나가 이 버전과 맞지 않아요',
      cause: '모드가 마인크래프트 코드를 고치려다 실패했어요. 보통 다른 버전용 모드이거나, 다른 모드와 부딪혀요.',
      fixes: ['아래 의심 모드를 이 서버 버전용으로 바꾸거나 꺼 주세요.', '모드 탭 → 업데이트 확인을 해 보세요.'],
      action: 'mods'
    },
  (c) =>
    has(c, /Ticking (?:block )?entity|Ticking player|Exception ticking world/i) && {
      title: '월드 안의 무언가가 계속 오류를 내요',
      cause: (() => {
        const type = c.text.match(/(?:Entity Type|Block type|Name): ([^\n]+)/)?.[1]?.trim()
        const where = c.text.match(/(?:Entity's Exact location|Block location): ([^\n]+)/)?.[1]?.trim()
        return `특정 몹이나 블록이 움직일 때마다 오류가 나서 서버가 멈췄어요.${type ? `\n원인: ${type}` : ''}${where ? `\n위치: ${where}` : ''}`
      })(),
      fixes: ['그 몹·블록을 추가한 모드가 있으면 업데이트하거나 꺼 보세요.', '백업 탭에서 문제가 생기기 전 월드로 되돌릴 수 있어요.'],
      action: 'backup'
    },
  (c) =>
    has(c, /A single server tick took [\d.]+ seconds|Watchdog|ServerHangWatchdog|server has stopped responding/i) && {
      title: '서버가 너무 오래 멈춰 있어서 꺼졌어요',
      cause: '한 번의 처리(틱)가 60초 넘게 걸려서 서버가 스스로 멈췄어요. 무거운 모드나 큰 기계, 월드를 처음 만들 때 생길 수 있어요.',
      fixes: ['설정 → 성능에서 "멈춤 감지 시간"을 늘리거나 끄세요 (-1).', '메모리를 늘려 보세요.', '보이는 거리를 줄여 보세요.'],
      action: 'settings'
    },
  (c) =>
    // "RegionFile"·"corrupt"만으로는 정상 경고에도 걸려서, 월드 파일과 같이 나올 때만 본다
    has(c, /Failed to load level|Exception reading [^\n]*level\.dat|Couldn't load chunk|Chunk file at [^\n]* is in the wrong location|(?:chunk|region|level\.dat)[^\n]*corrupt|corrupt[^\n]*(?:chunk|region|level\.dat)/i) && {
      title: '월드 파일이 손상됐을 수 있어요',
      cause: '월드 파일을 읽다가 오류가 났어요. 컴퓨터가 갑자기 꺼졌거나, 월드가 저장되는 중에 서버가 강제로 꺼지면 생겨요.',
      fixes: ['백업 탭에서 최근 백업으로 되돌려 보세요.', '백업이 없으면 설정 → 월드 리셋으로 새로 시작할 수 있어요.'],
      action: 'backup'
    },
  (c) =>
    // "DataFixer"는 정상 로그(Datafixer Bootstrap, datafixerupper.jar)에도 있어서 넣지 않는다
    has(c, /newer version of Minecraft|was last played in a newer|Invalid world version/i) && {
      title: '더 새 버전에서 쓰던 월드예요',
      cause: '이 월드는 서버보다 새 버전의 마인크래프트에서 저장됐어요. 새 버전의 월드는 옛 버전에서 열 수 없어요.',
      fixes: ['같은 버전(또는 더 새 버전)으로 서버를 새로 만들어 이 월드를 가져오세요.', '백업 탭에서 원래 월드로 되돌릴 수 있어요.'],
      action: 'backup'
    },
  (c) =>
    has(c, /StackOverflowError/) && {
      title: '모드끼리 무한 반복에 빠졌어요',
      cause: '어떤 처리가 끝없이 자기 자신을 불러서 멈췄어요. 모드끼리 부딪힐 때 자주 생겨요.',
      fixes: ['최근에 넣은 모드를 꺼 보세요.', '아래 의심 모드가 있으면 그것부터 꺼 주세요.'],
      action: 'mods'
    },
  (c) =>
    has(c, /Could not load (?:'|")?plugins[\\/][^\n]*|Error occurred while enabling|Plugin [^\n]* is not compatible|UnknownDependencyException/i) && {
      title: '플러그인 오류예요',
      cause: '플러그인 하나가 켜지다 오류를 냈어요. 다른 버전용이거나 필요한 플러그인이 없어요.',
      fixes: ['아래 의심 플러그인을 이 버전용으로 바꾸거나 꺼 주세요.', '플러그인 탭에서 업데이트 확인을 해 보세요.'],
      action: 'mods'
    },
  // 위에서 원인을 못 찾았는데 월드를 불러오다 멈춘 경우 (서버는 이때도 "Failed to load datapacks"라고 찍는다)
  (c) =>
    has(c, /Failed to load datapacks|can't proceed with server load/i) && {
      title: '월드를 불러오지 못했어요',
      cause: '월드나 데이터팩을 읽다가 오류가 나서 서버를 켜지 못했어요. 정확한 원인은 아래 오류 내용에 있어요.',
      fixes: ['백업 탭에서 이전 월드로 되돌려 보세요.'],
      action: 'backup'
    }
]

// 모드 이름·ID를 로그에서 찾는다: Forge/Fabric 크래시 보고서의 "Suspected Mod(s)", Mixin 설정 이름, 패키지 이름
function suspectIds(c: Ctx): string[] {
  const ids = new Set<string>()
  const block = c.text.match(/Suspected Mods?:\s*([\s\S]{0,400}?)\n\s*\n/)
  if (block) for (const m of block[1].matchAll(/([\w .'-]+?) \(([\w-]+)\)/g)) ids.add(m[2].toLowerCase()), ids.add(m[1].trim().toLowerCase())
  for (const m of c.text.matchAll(/([\w-]+)\.mixins?\.json/gi)) ids.add(m[1].toLowerCase().replace(/[-_]?mixins?$/, ''))
  for (const m of c.text.matchAll(/Mod '([^']+)' \(([\w-]+)\)/g)) ids.add(m[2].toLowerCase())
  for (const m of c.text.matchAll(/(?:HARD_DEP|BREAKS?)\w* ([\w-]+) \S+ \{/g)) ids.add(m[1].toLowerCase())
  for (const m of c.text.matchAll(/(?:Could not load|enabling) (?:'|")?(?:plugins[\\/])?([\w .-]+?)(?:\.jar)?(?:'|")?(?:\s|$)/gi)) ids.add(m[1].toLowerCase())
  // 스택의 패키지 이름 (net.minecraft·java 등 기본 패키지는 뺀다)
  for (const m of c.text.matchAll(/\bat (?:[\w$]+\.)*?([a-z][\w]{2,})\.[\w$.]+\(/g)) {
    const pkg = m[1].toLowerCase()
    if (!/^(net|java|javax|jdk|sun|com|org|io|it|cpw|mixin|fabricmc|minecraft|mojang|spongepowered|neoforged|minecraftforge|google|apache|lwjgl)$/.test(pkg)) ids.add(pkg)
  }
  ids.delete('')
  return [...ids]
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')

function matchInstalled(folderPath: string, ids: string[]): CrashSuspect[] {
  let installed: ReturnType<typeof mods.list> = []
  try {
    installed = mods.list(folderPath)
  } catch {
    return []
  }
  const out: CrashSuspect[] = []
  for (const m of installed) {
    const keys = [norm(m.title), norm(m.fileName.replace(/[-_+]?\d[\w.+-]*\.jar$/i, '').replace(/\.jar$/i, ''))]
    if (ids.some((id) => norm(id).length >= 3 && keys.some((k) => k === norm(id) || (norm(id).length >= 5 && k.includes(norm(id))))))
      out.push({ title: m.title, fileName: m.fileName, enabled: m.enabled })
  }
  return out.slice(0, 5)
}

function newestReport(folderPath: string, since: number): string | null {
  const dir = path.join(folderPath, 'crash-reports')
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.txt'))
      .map((f) => ({ f: path.join(dir, f), t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .filter((x) => x.t >= since - 1000)
      .sort((a, b) => b.t - a.t)
    return files[0]?.f ?? null
  } catch {
    return null
  }
}

// 사람이 읽을 만한 오류 줄 몇 개
function excerptOf(c: Ctx): string {
  const lines = c.text.split(/\r?\n/)
  const i = lines.findIndex((l) => /Description:|Exception|Error:|ERROR\]|FATAL/.test(l))
  return (i === -1 ? lines.slice(-8) : lines.slice(i, i + 8)).map((l) => l.slice(0, 220)).join('\n').trim()
}

// "from pack file/이름" → 월드의 datapacks 폴더 안 이름
const dataPacksOf = (c: Ctx): string[] => [...new Set([...c.text.matchAll(/from pack file\/([^\s:,)]+)/g)].map((m) => m[1]))].slice(0, 5)

export function disableDatapack(folderPath: string, name: string): void {
  if (getState(folderPath) !== 'stopped') throw new Error('서버를 끈 다음에 할 수 있어요.')
  if (!name || /[\\/]|\.\./.test(name)) throw new Error('잘못된 데이터팩 이름이에요.')
  const world = path.join(folderPath, readProperties(folderPath)['level-name'] || 'world')
  const from = path.join(world, 'datapacks', name)
  if (!fs.existsSync(from)) throw new Error('데이터팩을 찾을 수 없어요.')
  const toDir = path.join(world, 'datapacks-disabled') // 지우지 않고 옮겨 둬서 되살릴 수 있다
  fs.mkdirSync(toDir, { recursive: true })
  fs.renameSync(from, path.join(toDir, name))
}

export function analyzeCrash(folderPath: string, log: string[], startedAt: number): CrashAnalysis {
  const reportPath = newestReport(folderPath, startedAt)
  let report: string | null = null
  try {
    report = reportPath ? fs.readFileSync(reportPath, 'utf8').slice(0, 200_000) : null
  } catch {
    report = null
  }
  const c: Ctx = { text: [...log.slice(-300), report ?? ''].join('\n'), report }
  const base = RULES.map((r) => r(c)).find(Boolean) ?? {
    title: '서버가 갑자기 꺼졌어요',
    cause: report ? '서버가 오류로 멈췄어요. 정확한 원인은 아래 오류 내용과 크래시 보고서에 있어요.' : '서버가 오류 코드와 함께 꺼졌어요.',
    fixes: ['최근에 넣은 모드·플러그인이나 바꾼 설정이 있으면 되돌려 보세요.', '다시 켜도 같으면 백업 탭에서 이전 월드로 되돌려 보세요.']
  }
  const suspects = matchInstalled(folderPath, suspectIds(c))
  // 필요한 모드가 이미 설치돼 있으면(버전 문제) 그 파일을 적어 둔다 → 창에서 업데이트 버튼
  const deps = depsOf(c).map((d) => ({ ...d, installedFile: matchInstalled(folderPath, [d.id])[0]?.fileName }))
  return { ...base, suspects, deps, datapacks: dataPacksOf(c), reportPath, excerpt: excerptOf(c) }
}
