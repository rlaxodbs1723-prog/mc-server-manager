import { ChevronRight, Cpu, Layers, Globe2, MessageSquare, Package, RotateCcw, Save, Swords, Timer, Users, Wrench, X, Zap } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLeaveAnimation } from './leave'
import { PAPER_FIELDS, type PaperField, type ServerAutomation, type ServerSettings, type Software, type WhitelistInfo } from '../../shared-types'
import Select from './Select'
import { Confirm, Loading, Modal, useToast } from './ui'
import WorldResetDialog from './WorldResetDialog'
import WhitelistDialog from './WhitelistDialog'
import VersionSection, { versionLabel, type PickedVersion } from './VersionSection'
import { useTasks } from './tasks'
import { cleanError } from './util'

type Field =
  | { key: string; label: string; desc?: string; type: 'bool'; def: boolean; legacy?: boolean }
  | { key: string; label: string; desc?: string; type: 'number'; def: number; min: number; max: number; unit?: string; legacy?: boolean }
  | { key: string; label: string; desc?: string; type: 'text'; def: string; placeholder?: string; legacy?: boolean }
  | { key: string; label: string; desc?: string; type: 'select'; def: string; options: { value: string; label: string }[]; legacy?: boolean }
  // 숫자 값이지만 켜기/끄기만 고르는 설정 (끄면 0)
  | { key: string; label: string; desc?: string; type: 'toggle'; def: string; onValue: string; legacy?: boolean }
  // 누르면 따로 관리 창이 뜨는 설정
  | { key: string; label: string; desc?: string; type: 'whitelist'; def: string; legacy?: boolean }
  // 비밀번호처럼 가려서 보여 주는 글자
  | { key: string; label: string; desc?: string; type: 'password'; def: string; legacy?: boolean }

interface Section {
  title: string
  icon: ReactNode
  fields: Field[]
}

// 설정 항목은 그 서버의 server.properties에 실제로 있을 때만 보여 준다 (버전마다 있는 항목이 다르다).
// legacy: 예전 버전에만 있는 설정 (최신 버전은 게임 규칙으로 옮겨졌다). 처음 켜기 전(파일이 없을 때)에는 숨긴다.
const SECTIONS: Section[] = [
  { title: '버전', icon: <Layers size={18} />, fields: [] },
  {
    title: '게임',
    icon: <Swords size={18} />,
    fields: [
      { key: 'motd', label: '서버 설명', desc: '마인크래프트 서버 목록에서 서버 이름 아래에 보이는 문구예요. §a 같은 색 코드도 쓸 수 있어요.', type: 'text', def: 'A Minecraft Server', placeholder: '우리들의 서버' },
      { key: 'pvp', label: '플레이어끼리 공격(PvP)', type: 'bool', def: true, legacy: true },
      { key: 'allow-flight', label: '비행 허용', desc: '비행 기능이 있는 모드·플러그인을 쓸 때 켜 주세요. 끄면 날아다니는 사람을 서버가 내보내요.', type: 'bool', def: false },
      { key: 'enable-command-block', label: '명령 블록 사용', desc: '명령 블록을 설치하고 작동시킬 수 있어요.', type: 'bool', def: false, legacy: true },
      { key: 'spawn-animals', label: '동물 생성', type: 'bool', def: true, legacy: true },
      { key: 'spawn-npcs', label: '주민 생성', type: 'bool', def: true, legacy: true },
      { key: 'announce-player-achievements', label: '업적 알림', desc: '업적을 달성하면 채팅에 알려 줘요.', type: 'bool', def: true, legacy: true },
      {
        key: 'op-permission-level', label: '관리자 권한 단계', desc: '관리자(OP)가 쓸 수 있는 명령어 범위예요. 보통 4(전부)로 두면 돼요.', type: 'select', def: '4',
        options: [
          { value: '1', label: '1 · 스폰 보호 무시' },
          { value: '2', label: '2 · 치트 명령어' },
          { value: '3', label: '3 · 플레이어 관리' },
          { value: '4', label: '4 · 전부 (서버 끄기 포함)' }
        ]
      }
    ]
  },
  {
    title: '월드',
    icon: <Globe2 size={18} />,
    fields: [
      { key: 'allow-nether', label: '네더 허용', type: 'bool', def: true, legacy: true },
      { key: 'spawn-monsters', label: '몬스터 생성', type: 'bool', def: true, legacy: true },
      { key: 'view-distance', label: '보이는 거리', desc: '클수록 멀리 보이지만 컴퓨터가 힘들어해요. 보통 8~12가 적당해요.', type: 'number', def: 10, min: 3, max: 32, unit: '청크' },
      { key: 'simulation-distance', label: '움직이는 거리', desc: '플레이어 주변에서 동물·작물이 움직이는 범위예요.', type: 'number', def: 10, min: 3, max: 32, unit: '청크' },
      { key: 'spawn-protection', label: '스폰 보호 범위', desc: '처음 태어나는 곳 주변을 관리자만 부술 수 있어요. 0이면 꺼져요.', type: 'number', def: 16, min: 0, max: 256, unit: '블록' },
      { key: 'max-world-size', label: '월드 크기 제한', desc: '월드 경계까지의 거리(반지름)예요. 작게 하면 지도가 좁아져서 용량이 덜 늘어요.', type: 'number', def: 29999984, min: 1, max: 29999984, unit: '블록' },
      { key: 'max-build-height', label: '건축 높이 제한', type: 'number', def: 256, min: 64, max: 256, unit: '블록', legacy: true }
    ]
  },
  {
    title: '접속',
    icon: <Users size={18} />,
    fields: [
      { key: 'max-players', label: '최대 인원', type: 'number', def: 20, min: 1, max: 500, unit: '명' },
      { key: 'white-list', label: '화이트리스트', desc: '허락한 사람만 들어올 수 있게 해요. 눌러서 목록을 관리할 수 있어요.', type: 'whitelist', def: 'false' },
      { key: 'enforce-whitelist', label: '화이트리스트 바로 적용', desc: '켜면 목록에서 뺀 사람이 접속해 있어도 바로 내보내요.', type: 'bool', def: false },
      { key: 'online-mode', label: '정품 인증', desc: '끄면 정품이 아닌 계정도 들어올 수 있지만, 다른 사람 닉네임으로 들어올 수 있어서 위험해요.', type: 'bool', def: true },
      { key: 'prevent-proxy-connections', label: 'VPN·프록시 접속 막기', desc: '정품 인증 서버와 접속 주소가 다르면 들어오지 못하게 해요.', type: 'bool', def: false },
      { key: 'pause-when-empty-seconds', label: '아무도 없을 때 멈추기', desc: '모두 나가고 1분이 지나면 월드 시간이 멈춰서 컴퓨터가 덜 힘들어요.', type: 'toggle', def: '60', onValue: '60' },
      { key: 'enable-status', label: '서버 목록에 정보 보이기', desc: '끄면 서버 목록에서 인원·설명이 안 보이고 "연결할 수 없음"처럼 보여요. 들어오는 건 돼요.', type: 'bool', def: true },
      { key: 'accepts-transfers', label: '다른 서버에서 넘어오기 허용', desc: '다른 서버가 플레이어를 이 서버로 보내는 것(/transfer)을 받아들여요.', type: 'bool', def: false },
      { key: 'log-ips', label: '접속 IP 기록', desc: '로그에 접속한 사람의 IP 주소를 남겨요.', type: 'bool', def: true },
      { key: 'server-port', label: '서버 포트 (접속 주소)', desc: '플레이어가 들어오는 포트예요. 서버를 여러 개 동시에 켤 때만 바꾸세요.', type: 'number', def: 25565, min: 1024, max: 65535 },
      { key: 'server-ip', label: '서버 IP 고정', desc: '이 컴퓨터에 네트워크가 여러 개일 때 한 곳에서만 받아요. 모르면 비워 두세요.', type: 'text', def: '', placeholder: '비우면 전부' }
    ]
  },
  { title: '자동', icon: <Timer size={18} />, fields: [] },
  { title: 'Paper', icon: <Zap size={18} />, fields: [] },
  {
    title: '채팅',
    icon: <MessageSquare size={18} />,
    fields: [
      { key: 'enforce-secure-profile', label: '채팅 서명 요구', desc: '정품 계정의 서명이 있는 채팅만 받아요. 끄면 서명 없는 모드 클라이언트도 채팅할 수 있어요.', type: 'bool', def: true },
      { key: 'broadcast-console-to-ops', label: '앱 명령 결과를 관리자 채팅에 보이기', desc: '콘솔·관리 탭에서 보낸 명령의 결과를 관리자(OP) 채팅에도 보여 줘요.', type: 'bool', def: false },
      { key: 'chat-spam-threshold-seconds', label: '채팅 도배 기준', desc: '이 시간 안에 채팅을 너무 많이 치면 내보내요.', type: 'number', def: 10, min: 1, max: 600, unit: '초' },
      { key: 'command-spam-threshold-seconds', label: '명령어 도배 기준', desc: '이 시간 안에 명령어를 너무 많이 치면 내보내요.', type: 'number', def: 10, min: 1, max: 600, unit: '초' }
    ]
  },
  {
    title: '리소스 팩',
    icon: <Package size={18} />,
    fields: [
      { key: 'resource-pack', label: '리소스 팩 주소', desc: '접속하는 사람에게 보낼 리소스 팩(.zip)의 다운로드 주소예요. 비우면 안 보내요.', type: 'text', def: '', placeholder: 'https://…/pack.zip' },
      { key: 'require-resource-pack', label: '리소스 팩 필수', desc: '켜면 리소스 팩을 거절한 사람은 들어올 수 없어요.', type: 'bool', def: false },
      { key: 'resource-pack-prompt', label: '안내 문구', desc: '리소스 팩을 받을지 물어볼 때 보여 줄 말이에요.', type: 'text', def: '', placeholder: '서버 전용 텍스처를 받아 주세요' },
      { key: 'resource-pack-sha1', label: '파일 확인 값 (SHA-1)', desc: '적으면 받은 파일이 맞는지 확인해요. 모르면 비워 두세요.', type: 'text', def: '' }
    ]
  },
  {
    title: '성능',
    icon: <Cpu size={18} />,
    fields: [
      { key: 'entity-broadcast-range-percentage', label: '몹이 보이는 거리', desc: '멀리 있는 몹·아이템을 얼마나 멀리서 보여 줄지예요. 낮추면 가벼워져요.', type: 'number', def: 100, min: 10, max: 1000, unit: '%' },
      { key: 'network-compression-threshold', label: '네트워크 압축 기준', desc: '이 크기(바이트)보다 큰 데이터를 압축해요. 256이면 충분해요.', type: 'number', def: 256, min: -1, max: 65535, unit: '바이트' },
      { key: 'max-tick-time', label: '멈춤 감지 시간', desc: '서버가 이 시간(밀리초) 동안 멈추면 강제로 꺼요. 무거운 모드 서버에서 자꾸 꺼지면 늘리세요. -1이면 끄기.', type: 'number', def: 60000, min: -1, max: 600000, unit: 'ms' },
      { key: 'sync-chunk-writes', label: '월드 안전 저장', desc: '켜면 조금 느려도 갑자기 꺼졌을 때 월드가 덜 망가져요.', type: 'bool', def: true },
      {
        key: 'region-file-compression', label: '월드 파일 압축 방식', desc: '보통은 deflate를 쓰세요. lz4는 빠르지만 용량이 커요.', type: 'select', def: 'deflate',
        options: [
          { value: 'deflate', label: 'deflate (기본)' },
          { value: 'lz4', label: 'lz4 (빠름)' },
          { value: 'none', label: '압축 안 함' }
        ]
      },
      { key: 'use-native-transport', label: '빠른 네트워크 사용', desc: '가능하면 운영체제의 빠른 네트워크 기능을 써요.', type: 'bool', def: true }
    ]
  },
  {
    title: '고급',
    icon: <Wrench size={18} />,
    fields: [
      { key: 'enable-rcon', label: '원격 콘솔(RCON)', desc: '다른 프로그램이 이 서버에 명령을 보낼 수 있게 해요. 필요할 때만 켜세요.', type: 'bool', def: false },
      { key: 'rcon.port', label: 'RCON 포트 (원격 콘솔용)', type: 'number', def: 25575, min: 1024, max: 65535 },
      { key: 'rcon.password', label: 'RCON 비밀번호', desc: 'RCON을 켰다면 꼭 어려운 비밀번호를 정해 주세요.', type: 'password', def: '' },
      { key: 'enable-query', label: '서버 정보 조회(Query)', desc: '서버 목록 사이트 등이 접속자 수를 조회할 수 있게 해요.', type: 'bool', def: false },
      { key: 'query.port', label: 'Query 포트 (서버 정보 조회용)', desc: '서버 포트와는 따로예요. 서버 정보 조회를 켰을 때만 써요.', type: 'number', def: 25565, min: 1024, max: 65535 },
      { key: 'function-permission-level', label: '함수 권한 단계', desc: '데이터 팩 함수가 쓸 수 있는 명령어 범위예요.', type: 'number', def: 2, min: 1, max: 4 },
      { key: 'max-chained-neighbor-updates', label: '연쇄 블록 갱신 한도', desc: '레드스톤 등이 한 번에 일으킬 수 있는 블록 변화 수예요.', type: 'number', def: 1000000, min: -1, max: 100000000 },
      { key: 'rate-limit', label: '패킷 제한', desc: '한 사람이 1초에 보낼 수 있는 데이터 수예요. 0이면 제한 없음.', type: 'number', def: 0, min: 0, max: 100000 },
      { key: 'broadcast-rcon-to-ops', label: 'RCON 명령 결과를 관리자 채팅에 보이기', desc: '원격 콘솔로 보낸 명령의 결과를 관리자(OP) 채팅에도 보여 줘요.', type: 'bool', def: true },
      { key: 'enable-code-of-conduct', label: '행동 규칙 보여 주기', desc: '서버 폴더의 codeofconduct 폴더에 쓴 규칙을 들어오는 사람에게 보여 주고 동의를 받아요.', type: 'bool', def: false },
      { key: 'bug-report-link', label: '문제 신고 주소', desc: '플레이어가 게임 메뉴에서 서버 문제를 신고할 때 열리는 주소예요.', type: 'text', def: '', placeholder: 'https://…' },
      { key: 'management-server-enabled', label: '관리 API', desc: '다른 프로그램이 이 서버를 관리할 수 있는 통로를 열어요. 필요할 때만 켜세요.', type: 'bool', def: false },
      { key: 'management-server-port', label: '관리 API 포트', type: 'number', def: 0, min: 0, max: 65535 },
      { key: 'enable-jmx-monitoring', label: 'JMX 모니터링', desc: '자바 모니터링 도구로 서버 상태를 볼 수 있게 해요.', type: 'bool', def: false }
    ]
  }
]

// 파일에 없으면 기본값을 보여 준다
function valueOf(f: Field, props: Record<string, string>): string {
  return props[f.key] ?? String(f.def)
}

const PERF_TAB = '성능' // 메모리 슬라이더가 맨 위에 붙는 탭
const ALWAYS_TABS = ['버전', '게임', '월드', '자동', PERF_TAB]

interface Props {
  folderPath: string
  serverOn: boolean
  mcVersion: string
  software: Software
  loaderVersion?: string
  onVersionChanged: () => void
  onClose: () => void
}

// 서버 설정 창. 왼쪽에서 카테고리를 고르고 오른쪽에서 바꾼 뒤 한 번에 저장한다.
export default function SettingsDialog({ folderPath, serverOn, mcVersion, software, loaderVersion, onVersionChanged, onClose }: Props) {
  const leaveRef = useRef<HTMLDivElement>(null)
  useLeaveAnimation(leaveRef) // 닫힐 때도 부드럽게 사라지게
  const toast = useToast()
  const { runJob } = useTasks()
  const [picked, setPicked] = useState<PickedVersion | null>(null) // 고른 새 버전 (저장하기를 누르면 바뀐다)
  const [askDowngrade, setAskDowngrade] = useState(false)
  const [hardcore, setHardcore] = useState<boolean | null>(null) // 파일에 적힌 하드코어 값
  const [hardcoreEdit, setHardcoreEdit] = useState<boolean | null>(null) // 바꾼 값 (저장 전)
  const [settings, setSettings] = useState<ServerSettings | null>(null)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [memory, setMemory] = useState<number | null>(null)
  const [autoRestart, setAutoRestart] = useState<boolean | null>(null)
  const [optimize, setOptimize] = useState<boolean | null>(null)
  const [javaArgs, setJavaArgs] = useState<string | null>(null) // 바꾼 자바 옵션 (저장 전)
  const [autoEdit, setAutoEdit] = useState<Partial<ServerAutomation>>({}) // 바꾼 자동 동작
  const [paperEdit, setPaperEdit] = useState<Record<string, string>>({}) // 바꾼 Paper 설정 (파일에 쓸 값)
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState(SECTIONS[1].title) // 처음에는 게임 탭
  const [showWhitelist, setShowWhitelist] = useState(false)
  const [askReset, setAskReset] = useState(false)
  const [askDiscard, setAskDiscard] = useState(false)
  const [focusKey, setFocusKey] = useState<string | null>(null) // 이 설정 칸으로 데려가서 반짝 표시
  const [wl, setWl] = useState<WhitelistInfo | null>(null)

  const load = () => {
    window.api.getWhitelist(folderPath).then(setWl)
    window.api.getHardcore(folderPath).then((h) => setHardcore(h.hardcore))
    setHardcoreEdit(null)
    return window.api.getSettings(folderPath).then((s) => {
      setSettings(s)
      setEdits({})
      setMemory(null)
      setAutoRestart(null)
      setOptimize(null)
      setJavaArgs(null)
      setAutoEdit({})
      setPaperEdit({})
      setPicked(null)
    })
  }

  // 화이트리스트·월드 리셋 창은 바로 저장하므로, 닫을 때 파일 값만 다시 읽고 아직 저장 안 한 다른 변경은 그대로 둔다
  async function reloadKeepingEdits() {
    const [s, w] = await Promise.all([window.api.getSettings(folderPath), window.api.getWhitelist(folderPath)])
    setSettings((cur) => (cur ? { ...cur, properties: s.properties, worldExists: s.worldExists } : s))
    setWl(w)
  }

  useEffect(() => {
    load()
  }, [folderPath]) // eslint-disable-line react-hooks/exhaustive-deps

  const props = useMemo(() => ({ ...(settings?.properties ?? {}), ...edits }), [settings, edits])
  const fileExists = settings ? Object.keys(settings.properties).length > 0 : false
  const propsDirty = Object.keys(edits).length > 0 || memory != null || autoRestart != null || optimize != null || javaArgs != null || Object.keys(autoEdit).length > 0 || Object.keys(paperEdit).length > 0
  const hardcoreDirty = hardcoreEdit != null && hardcoreEdit !== hardcore
  const dirty = propsDirty || hardcoreDirty || picked != null

  // Esc나 바깥을 눌러 닫을 때 저장 안 한 변경이 있으면 한 번 묻는다
  const requestClose = () => (dirty ? setAskDiscard(true) : onClose())

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 드롭다운이 Esc를 먼저 처리했으면(defaultPrevented) 창은 닫지 않는다
      if (e.key !== 'Escape' || e.defaultPrevented || showWhitelist || askReset || askDiscard || askDowngrade) return
      requestClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const set = (key: string, value: string) =>
    setEdits((e) => {
      const next = { ...e, [key]: value }
      if (settings?.properties[key] === value) delete next[key] // 원래 값으로 돌아오면 바뀐 것에서 뺀다
      return next
    })

  // 저장하면 창을 닫는다. 버전을 바꿨으면 오른쪽 위 작업 목록에서 이어서 진행한다
  async function save(confirmed = false) {
    if (picked && !picked.ready) return toast('버전 정보를 아직 불러오고 있어요', 'error')
    if (picked?.downgrade && !confirmed) return setAskDowngrade(true)
    // 포트를 바꿔서 "앱을 켜면 켜기" 서버끼리 포트가 겹치게 되면 저장하지 않는다
    if (settings && (autoEdit.autoStart ?? settings.automation.autoStart)) {
      const port = Number(props['server-port'] || 25565)
      const clash = settings.otherAutoStart.filter((o) => o.port === port).map((o) => o.name)
      if (clash.length) {
        setTab('접속')
        setFocusKey('server-port')
        setTimeout(() => setFocusKey(null), 2000)
        return toast(`${clash.join(', ')} 서버와 서버 포트(${port})가 겹쳐요. 서버 포트를 바꾸거나 "앱을 켜면 이 서버도 켜기"를 꺼 주세요.`, 'error')
      }
    }
    setSaving(true)
    try {
      if (propsDirty) {
        await window.api.saveSettings(folderPath, {
          properties: edits,
          memoryMb: memory ?? undefined,
          autoRestart: autoRestart ?? undefined,
          optimizeFlags: optimize ?? undefined,
          javaArgs: javaArgs ?? undefined,
          automation: Object.keys(autoEdit).length ? autoEdit : undefined,
          paper: Object.keys(paperEdit).length ? paperEdit : undefined
        })
      }
      if (hardcoreDirty) await window.api.setHardcore(folderPath, !!hardcoreEdit)
      if ((propsDirty || hardcoreDirty) && !picked) toast(serverOn ? '저장했어요. 서버를 다시 켜면 적용돼요' : '저장했어요')
      if (picked) {
        const target = `${picked.mcVersion}${software === 'vanilla' ? '' : ` · ${versionLabel(software, picked.loaderVersion)}`}`
        runJob(folderPath, '버전 바꾸기', `${target}(으)로 바꿨어요`, async (report) => {
          const off = window.api.onVersionProgress((p) => p.folderPath === folderPath && report(p))
          try {
            return await window.api.changeVersion(folderPath, picked.mcVersion, software === 'vanilla' ? undefined : picked.loaderVersion)
          } finally {
            off()
          }
        })
          .then(() => {
            toast(`${target}(으)로 바꿨어요`)
            onVersionChanged()
          })
          .catch((e) => toast(cleanError(e), 'error'))
      }
      onClose()
    } catch (e) {
      toast(cleanError(e), 'error')
      setSaving(false)
    }
  }

  // 카테고리마다 이 서버 버전에 실제로 있는 설정만 보여 준다
  const fieldsOf = (title: string) =>
    SECTIONS.find((s) => s.title === title)?.fields.filter((f) => (fileExists ? f.key in (settings?.properties ?? {}) : !f.legacy)) ?? []
  const changedIn = (title: string) =>
    (title === '버전' && picked != null) ||
    (title === '게임' && hardcoreDirty) ||
    (title === PERF_TAB && (memory != null || autoRestart != null || optimize != null || javaArgs != null)) ||
    (title === '자동' && Object.keys(autoEdit).length > 0) ||
    (title === 'Paper' && Object.keys(paperEdit).length > 0) ||
    fieldsOf(title).some((f) => f.key in edits)

  // 이 버전에 항목이 하나도 없는 탭은 숨긴다 (게임 탭은 하드코어, 월드 탭은 월드 리셋, 성능 탭은 메모리가 늘 있다)
  const tabs = SECTIONS.filter((s) => (s.title === 'Paper' ? settings?.paper != null : ALWAYS_TABS.includes(s.title) || fieldsOf(s.title).length > 0)).map((s) => ({
    title: s.title,
    icon: s.icon
  }))
  const gb = (mb: number) => `${(mb / 1024).toFixed(mb % 1024 ? 1 : 0)}GB`

  let content: ReactNode = <Loading text="설정을 불러오고 있어요" />
  let memoryBlock: ReactNode = null
  if (settings) {
    const mem = memory ?? settings.memoryMb
    memoryBlock = (
      <div className="setting-row col">
        <div className="setting-text">
          <div className="setting-label">
            서버가 쓸 메모리 <b className="mem-value">{gb(mem)}</b>
          </div>
          <div className="setting-desc">이 컴퓨터는 {gb(settings.totalMemoryMb)}예요. 모드가 많으면 4~6GB, Vanilla는 2GB면 충분해요.</div>
        </div>
        <input
          type="range"
          className="range"
          min={settings.minMemoryMb}
          max={settings.maxMemoryMb}
          step={512}
          value={mem}
          onChange={(e) => setMemory(Number(e.target.value) === settings.memoryMb ? null : Number(e.target.value))}
          style={{ ['--p' as string]: `${((mem - settings.minMemoryMb) / Math.max(1, settings.maxMemoryMb - settings.minMemoryMb)) * 100}%` }}
        />
        <div className="range-labels">
          <span>{gb(settings.minMemoryMb)}</span>
          <span>{gb(settings.maxMemoryMb)}</span>
        </div>
        {(() => {
          // 윈도우와 다른 프로그램(마인크래프트 게임 등)이 쓸 몫이 4GB보다 적게 남으면 경고한다
          const left = settings.totalMemoryMb - mem
          if (left >= 4096) return null
          const optimizing = optimize ?? settings.optimizeFlags
          return (
            <p className="warn-text mem-warn">
              ⚠ 컴퓨터에 {gb(Math.max(0, left))}만 남아요.{' '}
              {optimizing ? '자바 최적화가 켜져 있어서 서버를 켜자마자 이만큼을 다 잡아요. ' : ''}
              같은 컴퓨터에서 게임도 하면 버벅일 수 있어요.
            </p>
          )
        })()}
      </div>
    )
  }
  if (settings) {
    const fields = fieldsOf(tab)
    content = (
      <>
        {tab === PERF_TAB && memoryBlock}
        {tab === PERF_TAB && (
          <div className="setting-row">
            <div className="setting-text">
              <div className="setting-label">자바 최적화 (Aikar&apos;s flags)</div>
              <div className="setting-desc">
                서버용으로 다듬은 자바 설정이에요. 메모리 정리 때문에 생기는 렉이 줄어요. 켜면 정한 메모리를 처음부터 다 잡아서 컴퓨터에 여유 메모리가 있어야 해요. 다음에 켤 때 적용돼요.
              </div>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={optimize ?? settings.optimizeFlags}
                onChange={(e) => setOptimize(e.target.checked === settings.optimizeFlags ? null : e.target.checked)}
              />
              <span />
            </label>
          </div>
        )}
        {tab === PERF_TAB && (
          <div className={`setting-row col ${javaArgs != null ? 'changed' : ''}`}>
            <div className="setting-text">
              <div className="setting-label">추가 자바 옵션</div>
              <div className="setting-desc">자바에 더 넘길 옵션이에요. 모르면 비워 두세요. 예: -XX:+UseZGC -Dfile.encoding=UTF-8</div>
            </div>
            <input
              className="input mono"
              value={javaArgs ?? settings.javaArgs}
              placeholder="-XX:+UseZGC"
              maxLength={1000}
              onChange={(e) => setJavaArgs(e.target.value === settings.javaArgs ? null : e.target.value)}
            />
            {/-XX:\+Use\w*GC/i.test(javaArgs ?? settings.javaArgs) && (optimize ?? settings.optimizeFlags) && (
              <p className="hint">다른 메모리 정리 방식(GC)을 골라서, 자바 최적화는 G1 전용 옵션을 빼고 적용해요.</p>
            )}
          </div>
        )}
        {tab === PERF_TAB && (
          <div className="setting-row">
            <div className="setting-text">
              <div className="setting-label">튕기면 자동으로 다시 켜기</div>
              <div className="setting-desc">서버가 갑자기 꺼지면 5초 뒤에 다시 켜요. 10분 안에 3번 넘게 튕기면 멈춰요.</div>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={autoRestart ?? settings.autoRestart}
                onChange={(e) => setAutoRestart(e.target.checked === settings.autoRestart ? null : e.target.checked)}
              />
              <span />
            </label>
          </div>
        )}
        {tab === '버전' && (
          <VersionSection serverOn={serverOn} software={software} mcVersion={mcVersion} loaderVersion={loaderVersion} picked={picked} onPick={setPicked} />
        )}
        {tab === '자동' && (
          <AutomationRows
            port={Number(props['server-port'] || 25565)}
            onGoPort={() => {
              setTab('접속')
              setFocusKey('server-port')
              setTimeout(() => setFocusKey(null), 2000)
            }}
            portClash={settings.otherAutoStart.filter((o) => o.port === Number(props['server-port'] || 25565)).map((o) => o.name)}
            value={{ ...settings.automation, ...autoEdit }}
            changed={autoEdit}
            onChange={(patch) =>
              setAutoEdit((cur) => {
                const next = { ...cur, ...patch }
                // 원래 값으로 돌아오면 바뀐 것에서 뺀다
                for (const k of Object.keys(next) as (keyof ServerAutomation)[]) if (next[k] === settings.automation[k]) delete next[k]
                return next
              })
            }
          />
        )}
        {tab === 'Paper' && settings.paper && (
          <PaperRows
            values={settings.paper}
            edits={paperEdit}
            onChange={(id, v) =>
              setPaperEdit((cur) => {
                const next = { ...cur, [id]: v }
                if (settings.paper?.[id] === v) delete next[id]
                return next
              })
            }
          />
        )}
        {tab === '게임' && <IconRow folderPath={folderPath} />}
        {tab === '게임' && <HardcoreRow serverOn={serverOn} value={hardcoreEdit ?? hardcore} changed={hardcoreDirty} onChange={setHardcoreEdit} />}
        {tab === '월드' && (
          <div className="setting-row">
            <div className="setting-text">
              <div className="setting-label">{settings.worldExists ? '월드 리셋' : '새 월드 설정'}</div>
              <div className="setting-desc">하드코어, 시드, 월드 종류를 정하고 월드를 새로 만들어요.</div>
            </div>
            <button
              className={`btn ${settings.worldExists ? 'danger' : ''}`}
              onClick={() => setAskReset(true)}
              disabled={serverOn}
              title={serverOn ? '서버를 끈 다음에 할 수 있어요' : undefined}
            >
              <RotateCcw size={16} />
              {settings.worldExists ? '월드 리셋' : '설정하기'}
            </button>
          </div>
        )}
        {fields.map((f) =>
          f.type === 'whitelist' ? (
            <div key={f.key} className="setting-row clickable" onClick={() => setShowWhitelist(true)}>
              <div className="setting-text">
                <div className="setting-label">{f.label}</div>
                <div className="setting-desc">{f.desc}</div>
              </div>
              <span className="link-value">
                {wl ? `${wl.enabled ? '켜짐' : '꺼짐'} · ${wl.players.length}명` : ''}
                <ChevronRight size={18} />
              </span>
            </div>
          ) : (
            <FieldRow key={f.key} field={f} value={valueOf(f, props)} changed={f.key in edits} focus={focusKey === f.key} onChange={(v) => set(f.key, v)} />
          )
        )}
        {!fileExists && <p className="hint" style={{ padding: '14px 0' }}>서버를 한 번 켜면 설정 항목이 더 생겨요.</p>}
      </>
    )
  }

  return (
    <div className="backdrop" ref={leaveRef} onMouseDown={(e) => e.target === e.currentTarget && requestClose()}>
      <div className="settings-modal" role="dialog" aria-modal="true">
        <nav className="settings-nav">
          <h2>서버 설정</h2>
          {tabs.map((t) => (
            <button key={t.title} className={tab === t.title ? 'active' : ''} onClick={() => setTab(t.title)}>
              {t.icon}
              {t.title}
              {changedIn(t.title) && <span className="nav-dot" />}
            </button>
          ))}
        </nav>

        <section className="settings-body">
          <header>
            <h3>{tab}</h3>
            <button className="btn icon sm ghost" onClick={requestClose} aria-label="닫기">
              <X size={18} />
            </button>
          </header>
          <div className="settings-content">{content}</div>
          <footer>
            <span className="hint">{dirty ? (serverOn ? '바뀐 설정은 서버를 다시 켜면 적용돼요' : '바뀐 설정이 있어요') : ''}</span>
            <button className="btn ghost" onClick={load} disabled={saving || !dirty}>
              되돌리기
            </button>
            <button className="btn primary" onClick={() => save()} disabled={saving || !dirty}>
              {saving ? <span className="spinner" /> : <Save size={16} />}
              저장하기
            </button>
          </footer>
        </section>
      </div>

      {askReset && settings && (
        <WorldResetDialog
          mcVersion={mcVersion}
          folderPath={folderPath}
          properties={settings.properties}
          worldExists={settings.worldExists}
          onClose={() => setAskReset(false)}
          onDone={() => {
            setAskReset(false)
            reloadKeepingEdits()
          }}
        />
      )}
      {showWhitelist && (
        <WhitelistDialog
          folderPath={folderPath}
          onClose={() => {
            setShowWhitelist(false)
            reloadKeepingEdits()
          }}
        />
      )}
      {askDowngrade && picked && (
        <Confirm
          title="낮은 버전으로 바꿀까요?"
          body={`${mcVersion} → ${picked.mcVersion}. 월드가 망가질 수 있어요. 바꾸기 전에 월드를 자동으로 백업해요.`}
          confirmText="바꾸기"
          danger
          onCancel={() => setAskDowngrade(false)}
          onConfirm={() => {
            setAskDowngrade(false)
            save(true)
          }}
        />
      )}
      {askDiscard && (
        <Confirm
          title="저장하지 않은 설정이 있어요"
          body="저장하고 닫을까요?"
          confirmText="저장하고 닫기"
          cancelText="그냥 닫기"
          onCancel={onClose}
          onDismiss={() => setAskDiscard(false)}
          onConfirm={() => {
            setAskDiscard(false)
            save()
          }}
        />
      )}
    </div>
  )
}

function FieldRow({ field: f, value, changed, focus, onChange }: { field: Field; value: string; changed: boolean; focus?: boolean; onChange: (v: string) => void }) {
  const rowRef = useRef<HTMLDivElement>(null)
  // 다른 곳에서 "이 칸을 바꿔 주세요"로 데려왔으면 보이게 굴리고 입력칸에 커서를 둔다
  useEffect(() => {
    if (!focus) return
    rowRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    rowRef.current?.querySelector('input')?.focus()
  }, [focus])
  let control: ReactNode
  if (f.type === 'bool' || f.type === 'toggle') {
    const on = f.type === 'bool' ? value === 'true' : Number(value) > 0
    const toValue = (checked: boolean) => (f.type === 'bool' ? String(checked) : checked ? f.onValue : '0')
    control = (
      <label className="switch">
        <input type="checkbox" checked={on} onChange={(e) => onChange(toValue(e.target.checked))} />
        <span />
      </label>
    )
  } else if (f.type === 'select') {
    // 파일에 목록에 없는 값이 들어 있으면(예전 버전 형식) 그대로 보여 준다
    const options = f.options.some((o) => o.value === value) ? f.options : [...f.options, { value, label: value }]
    control = (
      <div style={{ width: 200 }}>
        <Select value={value} onChange={onChange} options={options} />
      </div>
    )
  } else if (f.type === 'number') {
    control = (
      <div className="num-input">
        <input
          type="number"
          className="input"
          value={value}
          min={f.min}
          max={f.max}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => {
            const n = Math.min(f.max, Math.max(f.min, Math.round(Number(e.target.value) || 0)))
            onChange(String(n))
          }}
        />
        {f.unit && <span>{f.unit}</span>}
      </div>
    )
  } else if (f.type === 'text') {
    control = (
      <input className="input" style={{ width: 260 }} value={value} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} maxLength={200} />
    )
  } else if (f.type === 'password') {
    control = (
      <input
        className="input"
        style={{ width: 260 }}
        type="password"
        autoComplete="new-password"
        value={value}
        placeholder="비밀번호"
        onChange={(e) => onChange(e.target.value)}
        maxLength={100}
      />
    )
  }
  return (
    <div ref={rowRef} className={`setting-row ${changed ? 'changed' : ''} ${focus ? 'focus-flash' : ''}`}>
      <div className="setting-text">
        <div className="setting-label">
          {f.label}
        </div>
        {f.desc && <div className="setting-desc">{f.desc}</div>}
      </div>
      {control}
    </div>
  )
}

// 서버 아이콘: 바로 저장된다(저장하기 버튼과 따로). 그림을 끌어다 놓거나 눌러서 고른다
function IconRow({ folderPath }: { folderPath: string }) {
  const toast = useToast()
  const [icon, setIcon] = useState<string | null>(null)
  const [over, setOver] = useState(false)

  useEffect(() => {
    window.api.getServerIcon(folderPath).then(setIcon)
  }, [folderPath])

  async function run(job: () => Promise<string | null>) {
    try {
      const url = await job()
      if (url) {
        setIcon(url)
        window.dispatchEvent(new Event('servers-changed'))
        toast('서버 아이콘을 바꿨어요. 서버를 다시 켜면 보여요')
      }
    } catch (e) {
      toast(cleanError(e), 'error')
    }
  }

  return (
    <div className="setting-row">
      <div
        className={`icon-drop ${over ? 'over' : ''}`}
        onClick={() => run(() => window.api.pickServerIcon(folderPath))}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          const f = e.dataTransfer.files[0]
          if (f) run(() => window.api.setServerIconFile(folderPath, f))
        }}
        title="눌러서 고르거나 그림을 끌어다 놓으세요"
      >
        {icon ? <img src={icon} alt="" /> : <span>+</span>}
      </div>
      <div className="setting-text">
        <div className="setting-label">서버 아이콘</div>
        <div className="setting-desc">플레이어의 멀티플레이 목록에 보이는 그림이에요. 그림을 끌어다 놓거나 눌러서 골라요. 알아서 64×64로 맞춰요.</div>
      </div>
      {icon && (
        <button
          className="btn sm ghost"
          onClick={async () => {
            await window.api.removeServerIcon(folderPath)
            setIcon(null)
            window.dispatchEvent(new Event('servers-changed'))
          }}
        >
          지우기
        </button>
      )}
    </div>
  )
}

// 하드코어: 다른 설정처럼 저장하기를 눌러야 바뀐다. 월드 파일을 고치므로 서버가 꺼져 있을 때만 바꿀 수 있다.
function HardcoreRow({ serverOn, value, changed, onChange }: { serverOn: boolean; value: boolean | null; changed: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className={`setting-row ${changed ? 'changed' : ''}`}>
      <div className="setting-text">
        <div className="setting-label">하드코어</div>
        <div className="setting-desc">{serverOn ? '서버를 끈 다음에 바꿀 수 있어요.' : '죽으면 다시 살아날 수 없고 관전 모드가 돼요. 난이도는 어려움으로 고정돼요.'}</div>
      </div>
      <label className="switch">
        <input type="checkbox" checked={!!value} disabled={value == null || serverOn} onChange={(e) => onChange(e.target.checked)} />
        <span />
      </label>
    </div>
  )
}

// ---------- 자동 탭 ----------
const EMPTY_STOP = [
  { value: '0', label: '안 함' },
  { value: '10', label: '10분' },
  { value: '30', label: '30분' },
  { value: '60', label: '1시간' },
  { value: '180', label: '3시간' }
]

// portClash: "앱을 켜면 켜기"를 켠 다른 서버 중 이 서버와 포트가 같은 것 (있으면 켜지 않고 알려 준다)
function AutomationRows({ value: a, changed, port, portClash, onGoPort, onChange }: { value: ServerAutomation; changed: Partial<ServerAutomation>; port: number; portClash: string[]; onGoPort: () => void; onChange: (p: Partial<ServerAutomation>) => void }) {
  const [clash, setClash] = useState(false)
  return (
    <>
      {clash && (
        <Modal onClose={() => setClash(false)}>
          <h2>포트가 겹쳐서 켤 수 없어요</h2>
          <p className="body">
            앱을 켤 때 같이 켜지는 {portClash.join(', ')} 서버가 이 서버와 같은 서버 포트({port})를 써요. 같은 포트로는 한 서버만 켜질 수 있어요. 이 서버의 서버 포트를 바꾼 뒤 다시 켜 주세요 (예: {port + 1}).
          </p>
          <div className="actions">
            <button className="btn" onClick={() => setClash(false)}>
              닫기
            </button>
            <button
              className="btn primary"
              autoFocus
              onClick={() => {
                setClash(false)
                onGoPort()
              }}
            >
              서버 포트 바꾸러 가기
            </button>
          </div>
        </Modal>
      )}
      <div className={`setting-row ${'autoStart' in changed ? 'changed' : ''}`}>
        <div className="setting-text">
          <div className="setting-label">앱을 켜면 이 서버도 켜기</div>
          <div className="setting-desc">앱 설정의 "윈도우를 켤 때 앱도 켜기"와 같이 쓰면 컴퓨터만 켜도 서버가 열려요. 여러 서버를 켜 두면 서버 목록 순서대로 하나씩 켜고, 포트가 겹치거나 메모리가 모자란 서버는 건너뛰어요.</div>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={a.autoStart}
            onChange={(e) => (e.target.checked && portClash.length ? setClash(true) : onChange({ autoStart: e.target.checked }))}
          />
          <span />
        </label>
      </div>
      <div className={`setting-row ${'dailyRestart' in changed ? 'changed' : ''}`}>
        <div className="setting-text">
          <div className="setting-label">매일 다시 켜기</div>
          <div className="setting-desc">오래 켜 두면 느려지는 것을 막아요. 1분 전에 게임 안에 알리고, 저장한 뒤 다시 켜요.</div>
        </div>
        <div className="inline-controls">
          {a.dailyRestart && <input type="time" className="input time-input" value={a.dailyRestart} onChange={(e) => e.target.value && onChange({ dailyRestart: e.target.value })} />}
          <label className="switch">
            <input type="checkbox" checked={!!a.dailyRestart} onChange={(e) => onChange({ dailyRestart: e.target.checked ? '05:00' : '' })} />
            <span />
          </label>
        </div>
      </div>
      <div className={`setting-row ${'emptyStopMin' in changed ? 'changed' : ''}`}>
        <div className="setting-text">
          <div className="setting-label">아무도 없으면 끄기</div>
          <div className="setting-desc">모두 나가고 이 시간이 지나면 서버를 꺼서 컴퓨터를 쉬게 해요.</div>
        </div>
        <div style={{ width: 160 }}>
          <Select
            value={String(a.emptyStopMin)}
            onChange={(v) => onChange({ emptyStopMin: Number(v) })}
            options={EMPTY_STOP.some((o) => o.value === String(a.emptyStopMin)) ? EMPTY_STOP : [...EMPTY_STOP, { value: String(a.emptyStopMin), label: `${a.emptyStopMin}분` }]}
          />
        </div>
      </div>
      <div className={`setting-row col ${'welcome' in changed ? 'changed' : ''}`}>
        <div className="setting-text">
          <div className="setting-label">환영 메시지</div>
          <div className="setting-desc">들어온 사람에게만 보여요. {'{name}'}은 그 사람 닉네임으로 바뀌어요. 비우면 보내지 않아요.</div>
        </div>
        <input className="input" value={a.welcome} maxLength={200} placeholder="{name}님 어서 오세요!" onChange={(e) => onChange({ welcome: e.target.value })} />
      </div>
    </>
  )
}

// ---------- Paper 탭 ----------
function PaperRows({ values, edits, onChange }: { values: Record<string, string>; edits: Record<string, string>; onChange: (id: string, v: string) => void }) {
  const missing = PAPER_FIELDS.filter((f) => values[f.id] == null)
  return (
    <>
      <p className="hint" style={{ padding: '4px 0 8px' }}>Paper·Purpur 서버에만 있는 설정이에요. 서버를 다시 켜면 적용돼요.</p>
      {PAPER_FIELDS.filter((f) => values[f.id] != null).map((f) => (
        <PaperRow key={f.id} field={f} fileValue={values[f.id]} value={edits[f.id] ?? values[f.id]} changed={f.id in edits} onChange={(v) => onChange(f.id, v)} />
      ))}
      {missing.length > 0 && <p className="hint" style={{ padding: '14px 0' }}>서버를 한 번 켜면 {missing.length}개 항목이 더 생겨요.</p>}
    </>
  )
}

function PaperRow({ field: f, value, changed, onChange }: { field: PaperField; fileValue: string; value: string; changed: boolean; onChange: (v: string) => void }) {
  const scale = f.scale ?? 1
  const shown = f.type === 'number' ? String(Math.round((Number(value) / scale) * 100) / 100) : value
  return (
    <div className={`setting-row ${changed ? 'changed' : ''}`}>
      <div className="setting-text">
        <div className="setting-label">{f.label}</div>
        <div className="setting-desc">{f.desc}</div>
      </div>
      {f.type === 'bool' ? (
        <label className="switch">
          <input type="checkbox" checked={value === 'true'} onChange={(e) => onChange(String(e.target.checked))} />
          <span />
        </label>
      ) : (
        <div className="num-input">
          <input
            type="number"
            className="input"
            value={shown}
            min={f.min}
            max={f.max}
            step={f.step ?? 1}
            onChange={(e) => e.target.value !== '' && onChange(String(Number(e.target.value) * scale))}
            onBlur={(e) => {
              const n = Math.min(f.max ?? Infinity, Math.max(f.min ?? -Infinity, Number(e.target.value) || 0))
              onChange(String(Math.round(n * scale * 100) / 100))
            }}
          />
          {f.unit && <span>{f.unit}</span>}
        </div>
      )}
    </div>
  )
}
