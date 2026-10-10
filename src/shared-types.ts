// 화면(renderer)과 메인이 공유하는 타입

export const EULA_URL = 'https://aka.ms/MinecraftEULA'

export interface McVersion {
  id: string
  type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha'
  url: string
  releaseTime: string
}

export type Software = 'vanilla' | 'paper' | 'purpur' | 'fabric' | 'quilt' | 'forge' | 'neoforge'

// 화면에 보여 줄 이름과 설명 (만들기 화면의 순서이기도 하다)
export const SOFTWARE_INFO: Record<Software, { label: string; kind: string; description: string }> = {
  vanilla: { label: 'Vanilla', kind: '기본', description: '모드·플러그인 없는 공식 서버' },
  paper: { label: 'Paper', kind: '플러그인', description: '가장 많이 쓰는 플러그인 서버. Spigot·Bukkit 플러그인도 돌아가요' },
  purpur: { label: 'Purpur', kind: '플러그인', description: 'Paper 기반 + 설정할 수 있는 기능이 더 많아요' },
  fabric: { label: 'Fabric', kind: '모드', description: '가볍고 최신 버전 지원이 빠른 모드 로더' },
  quilt: { label: 'Quilt', kind: '모드', description: 'Fabric 호환 모드 로더' },
  forge: { label: 'Forge', kind: '모드', description: '오래되고 모드가 많은 모드 로더' },
  neoforge: { label: 'NeoForge', kind: '모드', description: 'Forge에서 갈라져 나온 최신 모드 로더' }
}

// 로더/빌드 버전 (Paper·Purpur는 빌드 번호)
export interface LoaderVersion {
  version: string
  stable: boolean
}

export interface CreateServerOptions {
  name: string
  software: Software
  mcVersion: string
  loaderVersion?: string // 바닐라가 아니면 필요
  properties?: Record<string, string> // 초기 설정 창에서 고른 server.properties 값
  importWorldFrom?: string // 싱글플레이 월드 폴더 (고르면 새 월드 대신 이 월드로 시작)
  modpackId?: string // 모드팩으로 만들 때 (prepareModpack으로 미리 풀어 둔 것)
}

export interface ServerInfo {
  name: string
  software: Software
  mcVersion: string
  loaderVersion?: string
  javaComponent?: string // Mojang Java 런타임 이름 (예: java-runtime-epsilon)
  memoryMb?: number // 최대 메모리 (없으면 2048)
  autoRestart?: boolean // 튕기면 자동으로 다시 켜기 (없으면 켬)
  optimizeFlags?: boolean // Aikar's flags (자바 메모리 정리 최적화)
  baseModsFor?: string // 기본 모드(Fabric API 등)를 어느 마인크래프트 버전에 맞춰 두었는지
  modpack?: ModpackOrigin // 모드팩으로 만들었으면 어느 모드팩의 어느 버전인지 (나중에 업데이트할 때 쓴다)
  defaultsApplied?: boolean // (예전 형식) 앱 기본 설정을 적용했는지 = defaultsVersion 1
  defaultsVersion?: number // 앱 기본 설정을 몇 번째까지 적용했는지
  javaArgs?: string // 사용자가 더 넣은 자바 옵션 (예: -XX:+UseZGC)
  automation?: Partial<ServerAutomation>
  folderPath: string
  createdAt: string
}

// 목록에 보여 줄 때 붙는 현재 상태
// Modrinth·CurseForge가 지금 응답하는지
// 자동 업데이트 상태 (설치 파일로 설치한 앱에서만)
export type UpdateState = { state: 'none' } | { state: 'downloading'; version: string; percent: number } | { state: 'ready'; version: string }

export interface SiteStatus {
  modrinth: boolean
  curseforge: boolean
}

export interface PreflightResult {
  missing: { mod: string; needs: string[] }[] // 켜진 모드가 필요로 하는데 없는 모드 ID
  duplicates: { mod: string; files: string[] }[] // 같은 모드가 두 개 이상 켜져 있음 (서버가 켜지지 않는다)
  memory: string | null // 메모리가 모자랄 때 설명
  askOff: boolean // 서버에 맞지 않아 보이는 모드가 새로 있어서 끌지 물어봐야 함
}

export interface ServerListItem extends ServerInfo {
  state: ServerState
  eulaAccepted: boolean
  icon: string | null // 서버 아이콘(server-icon.png) data URL
  startedAt: number | null // 켠 시각 (꺼져 있으면 null)
  playerCount: number
  modCount: number | null // 켜진 모드·플러그인 수 (모드를 못 쓰는 서버면 null)
  lastBackupAt: number | null
}

export type ServerState = 'stopped' | 'starting' | 'running' | 'stopping'

// 플레이어 초대(공유기 포트 자동 열기) 상태. lan은 같은 공유기 안에서 쓰는 주소들
export type InviteStatus =
  | { state: 'off' }
  | { state: 'opening'; lan: string[] }
  | { state: 'open'; address: string; lan: string[]; tunnel?: boolean } // tunnel: playit 터널 주소
  | { state: 'failed'; message: string; lan: string[]; port: number }

export type ServerEvent =
  | { type: 'log'; folderPath: string; line: string }
  | { type: 'status'; folderPath: string; state: ServerState }
  | { type: 'invite'; folderPath: string; invite: InviteStatus }
  | { type: 'players'; folderPath: string; players: string[] }
  | { type: 'backups'; folderPath: string } // 백업이 생기거나 지워짐 (목록을 다시 읽으라는 뜻)
  | { type: 'crashed'; folderPath: string; reason: string; restarting: boolean; analysis: CrashAnalysis }

// ---------- 관리 탭 ----------
export type Difficulty = 'peaceful' | 'easy' | 'normal' | 'hard'
export type GameMode = 'survival' | 'creative' | 'adventure' | 'spectator'

export interface GameRule {
  name: string // 서버가 쓰는 이름 그대로 (keep_inventory / keepInventory)
  value: string
  type: 'bool' | 'int'
}

export interface ManageInfo {
  players: { name: string; op: boolean }[] // 지금 접속 중
  banned: string[]
  difficulty: Difficulty
  gamemode: GameMode // 기본 게임 모드
}

// 화면에서 고르는 관리 동작. 메인이 검사한 뒤 서버 명령어로 바꾼다.
export type ManageAction =
  | { type: 'say'; text: string }
  | { type: 'difficulty'; value: Difficulty }
  | { type: 'gamemodeAll'; value: GameMode } // 지금 있는 모두 + 앞으로 들어올 사람
  | { type: 'time'; value: 'day' | 'noon' | 'midnight' }
  | { type: 'weather'; value: 'clear' | 'rain' | 'thunder' }
  | { type: 'save' }
  | { type: 'op' | 'deop' | 'kick' | 'ban' | 'pardon'; name: string }
  | { type: 'gamemode'; name: string; value: GameMode }
  | { type: 'tp'; name: string; target: string } // name을 target 옆으로
  | { type: 'give'; name: string; item: string; count: number }
  | { type: 'heal'; name: string } // 체력·배고픔 채우기

export interface PlayerRecord {
  name: string
  online: boolean
  firstSeen: number
  lastSeen: number
  joins: number
  playMs: number // 지금 접속 중이면 이번 접속 시간까지 더한 값
}

// ---------- 서버 설정 ----------
// 파일 탐색기의 한 줄 (서버 폴더 안)
export interface DirEntry {
  name: string
  dir: boolean
  size: number
  modified: number
  editable: boolean // 글자로 된 설정 파일이라 편집기로 열 수 있는지
}

// 버그 제보 첨부 파일 (사진·영상)
export interface BugFile {
  path: string
  name: string
  size: number
}

// 앱 전체 설정 (타이틀바 톱니바퀴)
export interface AppSettings {
  launchAtLogin: boolean // 윈도우를 켤 때 앱도 켜기
  startHidden: boolean // 그때 창 없이 트레이로 시작
  closeBehavior: 'tray-if-running' | 'always-tray' // 창을 닫으면: 켜진 서버가 있을 때만 트레이로 / 늘 트레이로
  notifications: boolean // 윈도우 알림
  usageStats: boolean // 익명 사용 통계 보내기 (앱을 켠 횟수 등, 개인 정보 없음)
  language: 'ko' | 'en' | 'zh' // 앱 언어 (처음에는 윈도우 언어를 따른다)
}
export interface AppInfo {
  settings: AppSettings
  version: string
  packaged: boolean // 설치한 앱인지 (윈도우 시작 시 실행은 설치한 앱에서만 된다)
  curseForgeKey: 'built' | 'user' | null // 기본 연결(중계 서버) / 사용자가 넣은 키 / 없음
  tunnelLinked: boolean // playit 터널을 승인해 둠
  dataFolder: string
}

// 서버 자동 동작 (서버 설정 > 자동)
export interface ServerAutomation {
  autoStart: boolean // 앱을 켜면 이 서버도 켜기
  dailyRestart: string // 매일 이 시각(HH:MM)에 다시 켜기. 빈 문자열이면 안 함
  emptyStopMin: number // 아무도 없이 이만큼(분) 지나면 끄기. 0이면 안 함
  welcome: string // 들어온 사람에게 보낼 말. {name}은 닉네임으로 바뀐다. 빈 문자열이면 안 함
}
export const DEFAULT_AUTOMATION: ServerAutomation = { autoStart: false, dailyRestart: '', emptyStopMin: 0, welcome: '' }

// Paper·Purpur 전용 설정 (bukkit.yml · spigot.yml · config/paper-world-defaults.yml). 처음 켠 뒤에 파일이 생긴다
export interface PaperField {
  id: string
  file: string
  path: string[]
  label: string
  desc: string
  type: 'number' | 'bool'
  min?: number
  max?: number
  step?: number
  unit?: string
  scale?: number // 파일 값 ÷ scale = 화면 값 (예: 틱 → 초는 20)
}
export const PAPER_FIELDS: PaperField[] = [
  { id: 'monsters', file: 'bukkit.yml', path: ['spawn-limits', 'monsters'], label: '몬스터 최대 수', desc: '플레이어 한 명 주변에 생길 수 있는 몬스터 수예요. 줄이면 가벼워져요.', type: 'number', min: 0, max: 300, unit: '마리' },
  { id: 'animals', file: 'bukkit.yml', path: ['spawn-limits', 'animals'], label: '동물 최대 수', desc: '플레이어 한 명 주변에 생길 수 있는 동물 수예요.', type: 'number', min: 0, max: 100, unit: '마리' },
  { id: 'water-animals', file: 'bukkit.yml', path: ['spawn-limits', 'water-animals'], label: '물속 동물 최대 수', desc: '오징어·돌고래 같은 물속 동물 수예요.', type: 'number', min: 0, max: 100, unit: '마리' },
  { id: 'autosave', file: 'bukkit.yml', path: ['ticks-per', 'autosave'], label: '자동 저장 간격', desc: '월드를 이 간격마다 저장해요. 짧을수록 갑자기 꺼져도 덜 잃지만 저장할 때 잠깐 렉이 생겨요.', type: 'number', min: 1, max: 3600, unit: '초', scale: 20 },
  { id: 'item-despawn', file: 'spigot.yml', path: ['world-settings', 'default', 'item-despawn-rate'], label: '떨어진 아이템이 사라지는 시간', desc: '바닥에 떨어진 아이템이 이 시간이 지나면 사라져요. 기본 5분이에요.', type: 'number', min: 10, max: 3600, unit: '초', scale: 20 },
  { id: 'mob-spawn-range', file: 'spigot.yml', path: ['world-settings', 'default', 'mob-spawn-range'], label: '몹이 생기는 거리', desc: '플레이어 주변 이 거리(청크) 안에서 몹이 생겨요.', type: 'number', min: 1, max: 16, unit: '청크' },
  { id: 'merge-item', file: 'spigot.yml', path: ['world-settings', 'default', 'merge-radius', 'item'], label: '아이템 합치는 거리', desc: '가까이 떨어진 같은 아이템을 하나로 합쳐요. 크게 하면 가벼워져요.', type: 'number', min: 0, max: 10, step: 0.5, unit: '블록' },
  { id: 'merge-exp', file: 'spigot.yml', path: ['world-settings', 'default', 'merge-radius', 'exp'], label: '경험치 구슬 합치는 거리', desc: '가까운 경험치 구슬을 하나로 합쳐요. -1이면 안 합쳐요.', type: 'number', min: -1, max: 10, step: 0.5, unit: '블록' },
  { id: 'anti-xray', file: 'config/paper-world-defaults.yml', path: ['anticheat', 'anti-xray', 'enabled'], label: '광석 숨기기 (X-ray 방지)', desc: '투시 핵으로 땅속 광석을 못 보게 숨겨요. 서버가 조금 무거워져요.', type: 'bool' },
  { id: 'max-collisions', file: 'config/paper-world-defaults.yml', path: ['collisions', 'max-entity-collisions'], label: '한 몹이 부딪히는 최대 수', desc: '몹이 한곳에 많이 몰렸을 때 계산을 줄여요. 낮추면 가벼워져요.', type: 'number', min: 0, max: 100 },
  { id: 'optimize-explosions', file: 'config/paper-world-defaults.yml', path: ['environment', 'optimize-explosions'], label: '폭발 계산 줄이기', desc: 'TNT가 많이 터질 때 렉을 줄여요.', type: 'bool' }
]

export interface ServerSettings {
  properties: Record<string, string> // server.properties (처음 켜기 전이면 비어 있을 수 있다)
  memoryMb: number
  minMemoryMb: number
  maxMemoryMb: number
  totalMemoryMb: number // 이 컴퓨터의 전체 메모리
  autoRestart: boolean
  optimizeFlags: boolean
  worldExists: boolean // 이미 만들어진 월드가 있는지 (있으면 "새 월드부터 적용" 설정은 월드를 새로 만들어야 적용된다)
  javaArgs: string
  automation: ServerAutomation
  otherAutoStart: { name: string; port: number }[] // "앱을 켜면 켜기"를 켠 다른 서버들의 포트 (겹치는지 알려 주려고)
  paper: Record<string, string> | null // Paper·Purpur의 PAPER_FIELDS 값 (id → 파일에 적힌 값). 다른 서버면 null, 파일이 없는 항목은 빠진다
}

export interface HardcoreInfo {
  worldExists: boolean
  hardcore: boolean // 월드가 있으면 월드 파일(level.dat)의 값, 없으면 설정 파일 값
}

export interface WhitelistPlayer {
  name: string
  uuid: string
}

export interface WhitelistInfo {
  enabled: boolean
  onlineMode: boolean // 정품 인증을 끄면 닉네임만으로 추가된다
  players: WhitelistPlayer[]
}

export interface SaveSettings {
  properties?: Record<string, string> // 바뀐 것만
  memoryMb?: number
  autoRestart?: boolean
  optimizeFlags?: boolean
  javaArgs?: string
  automation?: Partial<ServerAutomation>
  paper?: Record<string, string> // id → 파일에 쓸 값
}

// ---------- 모드 / 플러그인 ----------
export type Side = 'required' | 'optional' | 'unsupported' | 'unknown'

export interface ModKindInfo {
  kind: '모드' | '플러그인'
  folder: 'mods' | 'plugins'
}

export interface ModSearchHit {
  projectId: string
  slug: string
  title: string
  description: string
  author: string
  iconUrl: string | null
  downloads: number
  clientSide: Side // required면 접속하는 사람도 설치해야 한다
  serverSide: Side
  installed?: boolean
  sameNameInstalled?: boolean // 다른 사이트에서 받은 같은 이름의 것이 이미 있음 (같은 것일 수도, 다른 것일 수도)
  source?: ModpackSource // 어느 사이트 것인지
}

export interface InstalledDatapack {
  name: string // datapacks 폴더 안 이름 (zip 파일이나 폴더)
  enabled: boolean
  title: string
  description: string
  versionNumber: string
  iconUrl: string | null
  tracked: boolean // Modrinth에서 받아서 버전을 바꿀 수 있는지
}

// 서버에 맞지 않아 보여서 끌지 물어볼 모드
export interface OffSuggestion {
  fileName: string
  title: string
  reason: 'client' | 'clientMixin'
}

export interface InstalledMod {
  fileName: string
  enabled: boolean
  title: string
  versionNumber: string
  iconUrl: string | null
  clientRequired: boolean // 접속하는 사람도 설치해야 함
  offReason: 'client' | 'clientMixin' | null // 앱이 서버에 안 맞아서 꺼 둔 이유 (클라이언트 전용 / 서버에서 튕기는 버전)
  requiredBy: string[] // 이것을 필요로 해서 같이 설치된 경우, 필요로 하는 것들의 이름
  tracked: boolean // 앱으로 설치해서 버전을 바꿀 수 있는지
}

export interface ModVersionItem {
  id: string
  versionNumber: string
  type: 'release' | 'beta' | 'alpha'
  date: number
  current: boolean
}

export interface InstallResult {
  installed: string[] // 고른 것
  dependencies: string[] // 필수라서 같이 설치된 것
  failed: string[] // 설치하지 못한 필수 항목과 이유
}

// 서버 만들기 단계: 버전 정보 → 바닐라 서버 파일 → Java → 로더 받기 → 로더 설치 → 기본 모드
export type CreatePhase = 'meta' | 'vanilla' | 'java' | 'loader' | 'install' | 'base'

export interface Progress {
  message: string
  done?: number
  total?: number
  unit?: 'bytes' | 'files'
  phase?: CreatePhase // 서버 만들기에서만
  percent?: number // 서버 만들기 전체 진행률
  etaSeconds?: number // 서버 만들기 전체 남은 시간
  folderPath?: string // 서버 켜기 진행 상황이 어느 서버의 것인지
}

export interface Api {
  getVersions: (includeSnapshots: boolean) => Promise<McVersion[]>
  // 바닐라가 아닌 종류의 로더/빌드 버전 목록. 지원하지 않는 마인크래프트 버전이면 빈 배열
  getLoaderVersions: (software: Software, mcVersion: string) => Promise<LoaderVersion[]>
  // taskId: 진행 상황(onCreateProgress)을 어느 만들기 작업의 것인지 구분하는 번호
  createServer: (options: CreateServerOptions, taskId: string) => Promise<ServerInfo>
  onCreateProgress: (fn: (taskId: string, p: Progress) => void) => () => void
  listServers: () => Promise<ServerListItem[]>
  openFolder: (folderPath: string) => Promise<void>
  // 서버 폴더를 휴지통으로 보낸다 (확인은 화면에서 먼저 받는다)
  deleteServer: (folderPath: string) => Promise<void>
  // 만들고 있는 서버 취소 (만들던 폴더는 지운다)
  cancelCreate: (taskId: string) => Promise<void>
  // 모드팩 (Modrinth)
  browseModpacks: (o: ModpackBrowseOptions) => Promise<{ total: number; more: boolean; hits: ModpackBrowseHit[] }>
  gameVersions: () => Promise<string[]>
  modpackVersions: (projectId: string, source: ModpackSource) => Promise<ModpackVersion[]>
  prepareCurseForgeModpack: (modId: string, fileId: string) => Promise<ModpackInfo>
  prepareModpack: (versionId: string) => Promise<ModpackInfo>
  prepareModpackFile: (file: File) => Promise<ModpackInfo>
  pickModpackFile: () => Promise<ModpackInfo | null>
  // 옆 목록에서 끌어서 바꾼 순서를 저장한다
  setServerOrder: (folderPaths: string[]) => Promise<void>
  // 이름만 바꾼다 (폴더는 그대로)
  renameServer: (folderPath: string, name: string) => Promise<void>
  // 월드·모드·설정을 통째로 복사해 새 서버를 만든다
  duplicateServer: (folderPath: string, name: string) => Promise<ServerInfo>
  // 커스텀 타이틀바
  windowControl: (action: 'minimize' | 'maximize' | 'close') => Promise<void>
  isMaximized: () => Promise<boolean>
  onWindowMaximized: (fn: (maximized: boolean) => void) => () => void
  // 켜진 서버가 있을 때 창을 닫으려 하면 메인이 확인을 요청한다
  onConfirmQuit: (fn: (info: { creating: number; jobs: string[] }) => void) => () => void
  getUpdate: () => Promise<UpdateState>
  onUpdate: (fn: (s: UpdateState) => void) => () => void
  installUpdate: () => Promise<void> // 켜진 서버를 끄고 새 버전을 설치한 뒤 다시 켠다
  getSiteStatus: () => Promise<SiteStatus>
  onSiteStatus: (fn: (s: SiteStatus) => void) => () => void
  // 서버를 켜기 전 점검 (빠진 필수 모드, 메모리 부족, 서버에 맞지 않는 모드)
  preflight: (folderPath: string) => Promise<PreflightResult>
  quitApp: () => Promise<void>
  openEulaPage: () => Promise<void>
  acceptEula: (folderPath: string) => Promise<void>
  startServer: (folderPath: string) => Promise<void>
  stopServer: (folderPath: string, force?: boolean) => Promise<void>
  sendCommand: (folderPath: string, command: string) => Promise<void>
  getLog: (folderPath: string) => Promise<string[]>
  getInvite: (folderPath: string) => Promise<InviteStatus>
  // 바깥 인터넷에서 이 서버에 접속되는지 확인한다
  checkReachable: (folderPath: string) => Promise<{ ok: boolean; message: string }>
  // 공유기로 못 열 때 playit 터널로 연다 (처음이면 브라우저에서 승인)
  useTunnel: (folderPath: string) => Promise<void>
  // 켜진 서버의 CPU·메모리·TPS (꺼져 있으면 null)
  getStats: (folderPath: string) => Promise<ServerStats | null>
  getManageInfo: (folderPath: string) => Promise<ManageInfo>
  // 이 서버에 들어왔던 모든 사람의 기록
  getPlayerHistory: (folderPath: string) => Promise<PlayerRecord[]>
  manage: (folderPath: string, action: ManageAction) => Promise<void>
  // 켜진 서버에 물어서 게임 규칙 목록과 현재 값을 가져온다
  listGameRules: (folderPath: string) => Promise<GameRule[]>
  setGameRule: (folderPath: string, name: string, value: string) => Promise<void>
  // 게임과 같은 이름을 쓰기 위한 공식 한국어 번역 (gamerule.* 키만)
  getGameRuleLang: (folderPath: string) => Promise<Record<string, string>>
  getSettings: (folderPath: string) => Promise<ServerSettings>
  // 같은 서버 종류 안에서 마인크래프트·로더 버전을 바꾼다 (서버가 꺼져 있어야 함, 월드가 있으면 먼저 백업)
  changeVersion: (folderPath: string, mcVersion: string, loaderVersion?: string) => Promise<ServerInfo>
  onVersionProgress: (fn: (p: Progress) => void) => () => void
  saveSettings: (folderPath: string, settings: SaveSettings) => Promise<void>
  // 월드 폴더를 휴지통으로 보낸다. 다음에 켜면 지금 설정으로 새 월드가 만들어진다
  resetWorld: (folderPath: string) => Promise<void>
  // 월드 백업: 켜져 있어도 만들 수 있고, 복원은 꺼져 있을 때만
  listBackups: (folderPath: string) => Promise<BackupItem[]>
  createBackup: (folderPath: string) => Promise<BackupItem>
  restoreBackup: (folderPath: string, id: string) => Promise<void>
  deleteBackup: (folderPath: string, id: string) => Promise<void>
  openBackupFolder: (folderPath: string) => Promise<void>
  getBackupSettings: (folderPath: string) => Promise<BackupSettings>
  // 서버 아이콘 (멀티플레이 목록의 그림). data URL을 돌려준다
  getServerIcon: (folderPath: string) => Promise<string | null>
  pickServerIcon: (folderPath: string) => Promise<string | null>
  setServerIconFile: (folderPath: string, file: File) => Promise<string>
  removeServerIcon: (folderPath: string) => Promise<void>
  setBackupSettings: (folderPath: string, s: BackupSettings) => Promise<void>
  // 싱글플레이 월드 가져오기
  listSaves: () => Promise<SaveWorld[]>
  pickWorldZip: () => Promise<SaveWorld | null>
  // 끌어다 놓은 zip 파일이나 월드 폴더
  openDroppedWorld: (file: File) => Promise<SaveWorld>
  // CurseForge 페이지만 브라우저로 연다
  openExternal: (url: string) => Promise<void>
  // 버그 제보: 디스코드로 바로 보낸다 (버전·윈도우·언어는 앱이 붙인다). files는 사진·영상 경로
  sendBugReport: (title: string, details: string, files: string[]) => Promise<void>
  pickBugFiles: () => Promise<BugFile[]>
  bugFileInfo: (file: File) => Promise<BugFile> // 끌어다 놓은 파일
  // 크래시 보고서를 메모장 등으로 연다
  openCrashReport: (folderPath: string, reportPath: string) => Promise<void>
  // 데이터팩을 datapacks-disabled로 옮겨서 끈다
  disableDatapack: (folderPath: string, name: string) => Promise<void>
  // 모드 ID로 Modrinth에서 찾아 설치한다 (튕김 창의 필요한 모드). 설치한 이름을 돌려준다
  installModById: (folderPath: string, modId: string) => Promise<string>
  // CurseForge 맵
  hasCurseForgeKey: () => Promise<boolean>
  removeCurseForgeKey: () => Promise<void>
  getAppInfo: () => Promise<AppInfo>
  // playit 연결 끊기 (저장한 키를 지우고 터널 프로그램을 끈다)
  unlinkTunnel: () => Promise<void>
  setAppSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>
  openDataFolder: () => Promise<void>
  // 파일 탐색기 (rel은 서버 폴더 기준 경로, ""이면 맨 위)
  listDir: (folderPath: string, rel: string) => Promise<DirEntry[]>
  renameEntry: (folderPath: string, rel: string, newName: string) => Promise<void>
  trashEntries: (folderPath: string, rels: string[]) => Promise<void>
  createEntry: (folderPath: string, rel: string, name: string, kind: 'dir' | 'file') => Promise<string>
  revealEntry: (folderPath: string, rel: string) => Promise<void>
  readConfigFile: (folderPath: string, rel: string) => Promise<{ text: string; modified: number }>
  writeConfigFile: (folderPath: string, rel: string, text: string, expectedModified?: number) => Promise<number>
  setCurseForgeKey: (key: string) => Promise<void>
  searchMaps: (query: string, sort: MapSort, offset: number) => Promise<{ total: number; hits: MapHit[] }>
  mapFiles: (modId: number) => Promise<MapFile[]>
  // 받아서 풀어 둔다 (진행은 onMapProgress). 가져오기는 importWorld로
  prepareMap: (modId: number, fileId: number, title: string) => Promise<SaveWorld>
  onMapProgress: (fn: (p: { done: number; total?: number }) => void) => () => void
  cancelMap: () => Promise<void>
  importWorld: (folderPath: string, source: string) => Promise<void>
  // 하드코어는 월드 파일에 저장돼서 월드를 지우지 않고 바로 바꾼다 (서버가 꺼져 있을 때만)
  getHardcore: (folderPath: string) => Promise<HardcoreInfo>
  setHardcore: (folderPath: string, on: boolean) => Promise<void>
  getWhitelist: (folderPath: string) => Promise<WhitelistInfo>
  setWhitelistEnabled: (folderPath: string, enabled: boolean) => Promise<void>
  addWhitelist: (folderPath: string, name: string) => Promise<WhitelistPlayer>
  removeWhitelist: (folderPath: string, name: string) => Promise<void>
  // 모드/플러그인 (바닐라 서버면 modKind가 null)
  modKind: (folderPath: string) => Promise<ModKindInfo | null>
  // Modrinth와 CurseForge를 같이 찾는다. page는 0부터
  searchMods: (folderPath: string, query: string, page?: number, site?: SearchSite) => Promise<{ total: number; more: boolean; hits: ModSearchHit[] }>
  installMod: (folderPath: string, projectId: string) => Promise<InstallResult>
  listMods: (folderPath: string) => Promise<InstalledMod[]>
  // 서버에 맞지 않아 보이는 모드 (끌지 물어본다). 고른 것만 끄고, 나머지는 다시 묻지 않는다
  offSuggestions: (folderPath: string) => Promise<OffSuggestion[]>
  applyOffSuggestions: (folderPath: string, fileNames: string[]) => Promise<void>
  identifyMods: (folderPath: string) => Promise<boolean | null> // null: 인터넷·사이트 오류로 알아보지 못함
  // 플레이어용 모드팩(.mrpack)을 저장하고 경로를 돌려준다 (취소하면 null)
  exportClientPack: (folderPath: string, format: 'mrpack' | 'zip') => Promise<string | null>
  // 데이터팩 (켜진 서버면 바꾼 뒤 reload로 바로 적용)
  listDatapacks: (folderPath: string) => Promise<InstalledDatapack[]>
  identifyDatapacks: (folderPath: string) => Promise<boolean | null>
  searchDatapacks: (folderPath: string, query: string, page: number, site?: SearchSite) => Promise<{ total: number; more: boolean; hits: ModSearchHit[] }>
  installDatapack: (folderPath: string, projectId: string) => Promise<string>
  setDatapackEnabled: (folderPath: string, name: string, enabled: boolean) => Promise<void>
  removeDatapack: (folderPath: string, name: string) => Promise<void>
  addDatapackFile: (folderPath: string, file: File) => Promise<string>
  datapackVersions: (folderPath: string, name: string) => Promise<ModVersionItem[]>
  setDatapackVersion: (folderPath: string, name: string, versionId: string) => Promise<void>
  removeMod: (folderPath: string, fileName: string) => Promise<string[]>
  // 끌어다 놓은 jar를 mods(plugins) 폴더에 넣는다
  addModFile: (folderPath: string, file: File) => Promise<string>
  // 이 서버에 맞는 버전 목록과 버전 바꾸기
  modVersions: (folderPath: string, fileName: string) => Promise<ModVersionItem[]>
  setModVersion: (folderPath: string, fileName: string, versionId: string) => Promise<InstallResult>
  // 앱으로 설치한 것 중 새 버전이 있는 것 (파일 이름 -> 새 버전)
  checkModUpdates: (folderPath: string) => Promise<Record<string, string>>
  // fileNames가 비면 전부 업데이트
  updateMods: (folderPath: string, fileNames: string[]) => Promise<InstallResult>
  setModEnabled: (folderPath: string, fileName: string, enabled: boolean) => Promise<void>
  copyText: (text: string) => Promise<void>
  // 구독 함수들은 해제 함수를 돌려준다
  onProgress: (fn: (p: Progress) => void) => () => void
  onServerEvent: (fn: (e: ServerEvent) => void) => () => void
}

export interface BackupItem {
  id: string
  createdAt: number
  auto: boolean // 서버를 켤 때 자동으로 만든 백업
  sizeBytes: number
  worlds: string[]
  note?: string // 무엇 때문에 만든 백업인지 (예: 버전 바꾸기 전)
}

export interface ServerStats {
  cpu: number | null // 컴퓨터 전체 대비 % (처음 몇 초는 null)
  memMb: number | null // 자바가 실제로 쓰는 메모리
  maxMemMb: number // 설정한 최대 메모리
  tps: number | null // 서버 속도 (20이 정상). 버전에 따라 알 수 없으면 null
  sysFreeMb: number // 컴퓨터 전체에 남은 메모리
  sysTotalMb: number
}

export interface SaveWorld {
  path: string
  name: string // 게임에 보이는 월드 이름
  folder: string
  version?: string // 마지막으로 플레이한 마인크래프트 버전
  lastPlayed: number
  icon: string | null // data: URL
}

export type MapSort = 'popular' | 'newest' | 'updated' | 'downloads' | 'name'

export interface MapHit {
  id: number
  title: string
  summary: string
  author: string
  downloads: number
  iconUrl: string | null
  url: string // CurseForge 페이지
  versions: string[]
}

export interface MapFile {
  id: number
  name: string
  size: number
  date: number
  versions: string[]
  canDownload: boolean // 제작자가 다른 앱에서 받는 것을 막았으면 false
}

export interface CrashDep {
  id: string // 모드 ID (Modrinth 주소 이름과 같은 경우가 많다)
  requiredBy: string
  missing: boolean // false면 있는데 버전이 안 맞음
  range?: string
  breaks: boolean // 같이 쓸 수 없는 모드
  installedFile?: string // 이미 설치된 파일 (버전 문제일 때)
}

export interface CrashSuspect {
  title: string
  fileName: string // mods(plugins) 폴더의 파일
  enabled: boolean
}

// 튕김 분석 결과
export interface CrashAnalysis {
  title: string
  cause: string
  fixes: string[]
  action?: 'memory' | 'settings' | 'mods' | 'backup' | 'folder' // 바로 가기 버튼
  suspects: CrashSuspect[] // 원인일 수 있는 설치된 모드
  deps: CrashDep[] // 빠졌거나 버전이 안 맞는 모드
  datapacks: string[] // 원인인 데이터팩 (월드의 datapacks 폴더 안 이름)
  reportPath: string | null // crash-reports의 보고서
  excerpt: string // 오류 내용 몇 줄
}

export interface BackupSettings {
  everyMin: number // 켜져 있는 동안 몇 분마다 백업할지 (0이면 안 함)
  keep: number // 자동 백업을 몇 개까지 남길지
}

export interface ModpackVersion {
  id: string
  versionNumber: string
  gameVersions: string[]
  loaders: string[]
  type: 'release' | 'beta' | 'alpha'
  date: number
}

// 모드팩을 받아서 읽은 정보 (이걸로 서버를 만든다)
export interface ModpackInfo {
  packId: string // 풀어 둔 모드팩 (서버를 만들 때 넘긴다)
  name: string
  mcVersion: string
  software: Software
  loaderVersion: string
  modCount: number // 서버에 받을 파일 수
  skipped: number // 게임하는 사람 전용이라 뺀 파일 수
  manual: string[] // 제작자가 다른 앱에서 받는 것을 막아서 직접 넣어야 하는 모드
  serverPack?: boolean // 제작자가 만든 서버 팩(서버용 묶음)으로 만든다
}

export type ModpackSort = 'relevance' | 'downloads' | 'follows' | 'newest' | 'updated'

export type ModpackSource = 'modrinth' | 'curseforge'

// 검색할 사이트
export type SearchSite = 'all' | 'modrinth' | 'curseforge'

export interface ModpackBrowseOptions {
  site?: SearchSite
  query: string
  sort: ModpackSort
  gameVersion: string | null
  loaders: string[]
  offset: number // 페이지 번호 (0부터)
}

export interface ModpackBrowseHit {
  projectId: string
  title: string
  description: string
  author: string
  iconUrl: string | null
  downloads: number
  follows: number
  updated: number
  loaders: string[]
  tags: string[]
  clientAndServer: boolean
  source?: ModpackSource
}

export interface ModpackOrigin {
  source: 'modrinth' | 'curseforge' | 'file'
  projectId?: string // Modrinth 프로젝트 / CurseForge 모드 번호 (파일로 올렸으면 없음)
  versionId?: string // Modrinth 버전 / CurseForge 파일 번호
  name: string
  versionName?: string
  installedAt: string
}

// ---------- 오류 문구 ----------
// 네트워크·파일 오류처럼 영어나 기술 용어로 나오는 흔한 오류를 쉬운 말로 바꾼다. 주소(URL)는 지운다.
const SITE_NAMES: [RegExp, string][] = [
  [/modrinth/i, 'Modrinth'],
  [/curseforge|forgecdn/i, 'CurseForge'],
  [/mojang|minecraft\.net|launchermeta|piston/i, '마인크래프트 공식'],
  [/fabricmc/i, 'Fabric'],
  [/quiltmc/i, 'Quilt'],
  [/minecraftforge/i, 'Forge'],
  [/neoforged/i, 'NeoForge'],
  [/papermc/i, 'Paper'],
  [/purpurmc/i, 'Purpur']
]
export function friendlyError(raw: string): string {
  const msg = String(raw)
  const site = SITE_NAMES.find(([re]) => re.test(msg))?.[1]
  const where = site ? `${site} ` : ''
  const korean = /[가-힣]/.test(msg) // 앱이 만든 한국어 문구는 그대로 둔다 (주소만 지운다)
  if (!korean && /fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ENETUNREACH|socket hang up|network/i.test(msg))
    return `${where}서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.`
  if (!korean && /ETIMEDOUT|timed? ?out|aborted/i.test(msg)) return `${where}서버가 응답하지 않아요. 잠시 뒤에 다시 해 주세요.`
  if (/ENOSPC/.test(msg)) return '디스크 공간이 부족해요. 공간을 비운 뒤에 다시 해 주세요.'
  if (/EBUSY|EPERM|EACCES/.test(msg)) return '파일을 다른 프로그램이 쓰고 있어서 바꿀 수 없어요. 탐색기나 다른 프로그램을 닫고 다시 해 주세요.'
  if (!korean && /Unexpected token|JSON/.test(msg)) return `${where}에서 받은 정보를 읽지 못했어요. 잠시 뒤에 다시 해 주세요.`
  const status = /\((\d{3})\)/.exec(msg)?.[1]
  if (status === '404' && /요청 실패|다운로드 실패/.test(msg)) return `${site ? `${site}에서` : '서버에서'} 파일을 찾지 못했어요. 없어졌거나 주소가 바뀌었을 수 있어요.`
  if (status === '429') return `${where}요청이 너무 많아요. 잠시 뒤에 다시 해 주세요.`
  if (status && status >= '500') return `${where}서버에 문제가 있어요. 잠시 뒤에 다시 해 주세요.`
  // 남은 주소는 지운다 (예: "다운로드가 멈췄어요: https://...")
  return msg.replace(/:?\s*https?:\/\/\S+/g, '').trim()
}

// 두 사이트의 같은 모드를 이름으로 알아보기 위한 열쇠.
// "Cloth Config API (Fabric/Forge/NeoForge)", "Jade [Fabric]", "Clumps - Fabric", "Mod for Forge" 처럼 로더 이름을 붙인 것도 같게 본다
const LOADER = 'fabric|forge|neoforge|quilt|paper|spigot|bukkit'
// 같은 모드인지: 이름(로더 이름을 뺀)과 만든 사람이 둘 다 같을 때만. 이름만 같은 다른 모드를 숨기지 않게
// (만든 사람을 모르면 이름이 그대로 같을 때만)
export function sameMod(a: { title: string; author?: string }, b: { title: string; author?: string }): boolean {
  const plain = (s: string): string => s.toLowerCase().replace(/[^a-z0-9가-힣]/g, '')
  if (!a.author || !b.author) return plain(a.title) === plain(b.title)
  return nameKey(a.title) === nameKey(b.title) && plain(a.author) === plain(b.author)
}

export function nameKey(title: string): string {
  const t = title
    .toLowerCase()
    .replace(new RegExp(String.raw`[([][^)\]]*\b(${LOADER})\b[^)\]]*[)\]]`, 'g'), ' ')
    .replace(new RegExp(String.raw`\s*(-|–|:|\bfor)\s*(${LOADER})(\s*[/&,]\s*(${LOADER}))*\s*$`), '')
  const key = t.replace(/[^a-z0-9가-힣]/g, '')
  return key.length >= 3 ? key : title.toLowerCase().replace(/[^a-z0-9가-힣]/g, '')
}
