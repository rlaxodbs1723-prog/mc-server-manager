import { useState } from 'react'
import { SOFTWARE_INFO, type Software } from '../../shared-types'
import ModpackDialog from './ModpackDialog'
import SetupWizard from './SetupWizard'
import { Package } from 'lucide-react'
import { SoftwareBadge } from './ui'

// 만들기 화면에서 묶어 보여 줄 순서
const GROUPS: { label: string; items: Software[] }[] = [
  { label: '기본', items: ['vanilla'] },
  { label: '플러그인 서버', items: ['paper', 'purpur'] },
  { label: '모드 서버', items: ['fabric', 'quilt', 'forge', 'neoforge'] }
]

interface Props {
  existingNames: string[]
}

// 서버 종류를 고르면 설정 창(SetupWizard)이 떠서 나머지를 정한다
export default function CreateServer({ existingNames }: Props) {
  const [picked, setPicked] = useState<Software | null>(null)
  const [modpack, setModpack] = useState(false)

  return (
    <div className="create">
      <div>
        <h1 className="page-title">새 서버 만들기</h1>
        <p className="page-sub">어떤 서버를 만들지 골라 주세요. 나머지는 차근차근 안내해 드릴게요.</p>
      </div>

      <section>
        {GROUPS.map((g) => (
          <div className="sw-group" key={g.label}>
            <div className="sw-group-label">{g.label}</div>
            <div className="sw-grid">
              {g.items.map((s) => (
                <button key={s} className="sw-tile" onClick={() => setPicked(s)}>
                  <SoftwareBadge software={s} size={40} />
                  <div>
                    <div className="t">{SOFTWARE_INFO[s].label}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className="sw-group">
          <div className="sw-group-label">모드팩</div>
          <div className="sw-grid">
            <button className="sw-tile" onClick={() => setModpack(true)}>
              <span className="sw-badge" style={{ width: 40, height: 40, borderRadius: 12, color: '#1bd96a', background: '#1bd96a24' }}>
                <Package size={22} />
              </span>
              <div>
                <div className="t">Modpack</div>
              </div>
            </button>
          </div>
        </div>
      </section>
      {modpack && <ModpackDialog existingNames={existingNames} onClose={() => setModpack(false)} />}

      {picked && (
        <SetupWizard
          key={picked}
          software={picked}
          existingNames={existingNames}
          onClose={() => setPicked(null)}
        />
      )}
    </div>
  )
}
