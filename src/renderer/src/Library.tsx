import { SOFTWARE_INFO, type ServerListItem } from '../../shared-types'
import { SoftwareBadge } from './ui'
import { STATE_LABEL } from './util'

// "내 서버"를 누르면 보이는 서버 모음 화면: 서버를 카드로 한눈에 보고 눌러서 연다
export default function Library({ servers, onOpen, onCreate }: { servers: ServerListItem[]; onOpen: (s: ServerListItem) => void; onCreate: () => void }) {
  const mine = servers.filter((s) => !s.remote)
  const shared = servers.filter((s) => s.remote)
  const card = (s: ServerListItem) => {
    const gone = !!s.remote?.gone
    const off = !!s.remote && !s.remote.hostOnline
    const state = gone || off ? 'stopped' : s.state
    const label = gone ? '사용할 수 없음' : off ? '방장 컴퓨터 꺼짐' : STATE_LABEL[s.state]
    return (
      <button key={s.folderPath} className="lib-card" onClick={() => onOpen(s)}>
        <div className="lib-icon">
          <SoftwareBadge software={s.software ?? 'vanilla'} size={96} name={s.name} icon={s.icon} />
          <span className={`lib-state ${state}`} title={label}>
            <span className={`dot ${state}`} />
            {label}
          </span>
        </div>
        <div className="lib-name" title={s.name}>
          {s.name}
        </div>
        <div className="lib-sub">
          {SOFTWARE_INFO[s.software ?? 'vanilla']?.label ?? String(s.software ?? 'vanilla')} {s.mcVersion}
        </div>
      </button>
    )
  }
  return (
    <div className="library">
      <div className="lib-head">
        <h1 className="page-title">내 서버</h1>
        <button className="btn primary" onClick={onCreate}>
          + 새 서버 만들기
        </button>
      </div>
      {mine.length === 0 && <p className="empty-side">아직 만든 서버가 없어요.</p>}
      <div className="lib-grid">{mine.map(card)}</div>
      {shared.length > 0 && (
        <>
          <h2 className="lib-sec">공유받은 서버</h2>
          <div className="lib-grid">{shared.map(card)}</div>
        </>
      )}
    </div>
  )
}
