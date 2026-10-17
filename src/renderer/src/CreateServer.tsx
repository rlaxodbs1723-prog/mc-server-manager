import { useState } from 'react'
import { SOFTWARE_INFO, type DetectedServer, type Software } from '../../shared-types'
import DiscordLogo from './DiscordLogo'
import ImportServerDialog from './ImportServerDialog'
import ModpackDialog from './ModpackDialog'
import SetupWizard from './SetupWizard'
import { FolderInput, Package } from 'lucide-react'
import { SoftwareBadge, useToast } from './ui'
import { cleanError } from './util'

// 만들기 화면에서 묶어 보여 줄 순서
const GROUPS: { label: string; items: Software[] }[] = [
  { label: '기본', items: ['vanilla', 'bedrock'] },
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
  const toast = useToast()
  const [importing, setImporting] = useState<{ folder: string; detected: DetectedServer } | null>(null)

  // 폴더를 고르면 안을 살펴 종류·버전을 알아내고 가져오기 창을 연다
  async function pickImport() {
    const folder = await window.api.pickServerFolder().catch(() => null)
    if (!folder) return
    try {
      setImporting({ folder, detected: await window.api.detectServer(folder) })
    } catch (e) {
      toast(cleanError(e), 'error')
    }
  }

  return (
    <div className="create">
      <div className="beta-note">
        <div>
          <b>아직 초기 버전이라 버그가 있을 수 있어요</b>
          <span>쓰다가 이상한 점이 있으면 버그 제보를 많이 해 주세요. 보내 주신 제보로 빨리 고칠게요!</span>
        </div>
        <div className="beta-actions">
          <button className="btn sm" onClick={() => window.api.openExternal('https://discord.gg/Z6EdhRP9Ep')}>
            <DiscordLogo />
            디스코드 서버 가입
          </button>
          <button className="btn sm primary" onClick={() => window.dispatchEvent(new Event('open-bug-report'))}>
            버그 제보하기
          </button>
        </div>
      </div>

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
          <div className="sw-group-label">모드팩 · 가져오기</div>
          <div className="sw-grid">
            <button className="sw-tile" onClick={() => setModpack(true)}>
              <span className="sw-badge" style={{ width: 40, height: 40, borderRadius: 12, color: '#1bd96a', background: '#1bd96a24' }}>
                <Package size={22} />
              </span>
              <div>
                <div className="t">Modpack</div>
              </div>
            </button>
            <button className="sw-tile" onClick={pickImport}>
              <span className="sw-badge" style={{ width: 40, height: 40, borderRadius: 12, color: '#f5a524', background: '#f5a52424' }}>
                <FolderInput size={22} />
              </span>
              <div>
                <div className="t">기존 서버</div>
              </div>
            </button>
          </div>
        </div>
      </section>
      {modpack && <ModpackDialog existingNames={existingNames} onClose={() => setModpack(false)} />}
      {importing && <ImportServerDialog folder={importing.folder} detected={importing.detected} existingNames={existingNames} onClose={() => setImporting(null)} />}

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
