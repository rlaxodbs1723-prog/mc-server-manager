import { Archive, CloudSun, Gamepad2, Globe, Megaphone, MessageSquare, Play, ShieldCheck, Square, Swords, Terminal, UserCog, Hand, type LucideIcon } from 'lucide-react'
import { createContext, useContext, type ReactNode } from 'react'
import { SHARE_PERMS, type SharePerm } from '../../shared-types'

// 서버 공유 권한: 공유받은 서버(친구 앱)에서 권한이 없는 칸은 꺼 둔다. 내 서버에서는 언제나 된다.
// 실제로 막는 것은 방장 앱이다 (여기는 버튼을 꺼서 헷갈리지 않게 하는 것)

export const PERM_INFO: Record<SharePerm, { icon: LucideIcon; title: string; desc: string }> = {
  start: { icon: Play, title: '서버 켜기', desc: '꺼진 서버를 켤 수 있어요.' },
  stop: { icon: Square, title: '서버 끄기', desc: '켜진 서버를 끌 수 있어요. (저장 없이 강제로 끄기는 방장만)' },
  console: { icon: Terminal, title: '콘솔 명령어', desc: '콘솔에 명령어를 보낼 수 있어요. 명령어로 거의 모든 걸 할 수 있어서 믿는 친구에게만 주세요.' },
  announce: { icon: Megaphone, title: '공지 보내기', desc: '서버에 있는 모두에게 공지를 보낼 수 있어요.' },
  players: { icon: UserCog, title: '플레이어 관리', desc: 'OP 주기, 내보내기, 차단·차단 풀기, 플레이어별 게임 모드, 회복을 할 수 있어요.' },
  whitelist: { icon: ShieldCheck, title: '화이트리스트 관리', desc: '화이트리스트를 켜고 끄고, 사람을 넣고 뺄 수 있어요.' },
  welcome: { icon: Hand, title: '환영 메시지 바꾸기', desc: '들어온 사람에게 보내는 환영 메시지를 바꿀 수 있어요.' },
  difficulty: { icon: Swords, title: '난이도', desc: '난이도를 바꿀 수 있어요.' },
  gamemodeAll: { icon: Gamepad2, title: '모두의 게임 모드 바꾸기', desc: '모든 사람의 게임 모드를 한 번에 바꿀 수 있어요.' },
  timeWeather: { icon: CloudSun, title: '시간·날씨 바꾸기', desc: '아침·낮·밤, 맑음·비·천둥으로 바꿀 수 있어요.' },
  world: { icon: Globe, title: '월드 관리', desc: '월드 설정, 게임 규칙, 하드코어, 실험 기능을 바꿀 수 있어요. (월드 초기화와 월드 바꾸기는 방장만)' },
  chat: { icon: MessageSquare, title: '채팅 관리', desc: '채팅 기록을 얼마나 보관할지 바꿀 수 있어요.' },
  backup: { icon: Archive, title: '백업 관리', desc: '백업을 만들고, 되돌리고, 지우고, 자동 백업을 정할 수 있어요. 되돌리면 지금 월드가 바뀌어서 믿는 친구에게만 주세요.' }
}

// short: 일부만 있으면 '일부 권한' (좁은 곳에 쓴다)
export const permsLabel = (perms: SharePerm[], short = false): string =>
  perms.length === 0 ? '보기만' : perms.length === SHARE_PERMS.length ? '관리자' : short ? '일부 권한' : perms.map((p) => PERM_INFO[p].title).join(', ')

// 지금 보고 있는 서버에서 이 일을 할 수 있는지 (ServerPanel이 정해 준다)
export const PermsContext = createContext<(p: SharePerm) => boolean>(() => true)
export const useCan = (): ((p: SharePerm) => boolean) => useContext(PermsContext)

// 권한이 없으면 안의 버튼·입력을 모두 끈다 (모양은 그대로)
export function Perm({ p, children }: { p: SharePerm; children: ReactNode }) {
  const can = useCan()
  if (can(p)) return <>{children}</>
  return (
    <fieldset disabled className="ro-fieldset">
      {children}
    </fieldset>
  )
}
