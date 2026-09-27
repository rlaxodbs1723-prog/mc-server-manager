import { AlertOctagon, FileText } from 'lucide-react'
import { useState } from 'react'
import type { CrashAnalysis } from '../../shared-types'
import { Modal } from './ui'

interface Props {
  name: string
  folderPath: string
  analysis: CrashAnalysis
  onClose: () => void
}

// 튕긴 원인만 알려 준다. 고치는 것은 사용자가 직접 한다
export default function CrashDialog({ name, folderPath, analysis, onClose }: Props) {
  const a = analysis
  const [showDetail, setShowDetail] = useState(false)

  return (
    <Modal onClose={onClose}>
      <div className="crash">
        <div className="crash-head">
          <div className="crash-icon">
            <AlertOctagon size={24} />
          </div>
          <div>
            <span className="hint">{name} 서버가 튕겼어요</span>
            <h2>{a.title}</h2>
          </div>
        </div>

        <section>
          <div className="label">원인</div>
          <p className="crash-cause">{a.cause}</p>
        </section>

        {a.excerpt && (
          <section>
            <button className="btn ghost sm" onClick={() => setShowDetail((v) => !v)}>
              {showDetail ? '오류 내용 숨기기' : '오류 내용 보기'}
            </button>
            {showDetail && <pre className="crash-excerpt">{a.excerpt}</pre>}
          </section>
        )}

        <div className="actions">
          {a.reportPath && (
            <button className="btn" onClick={() => window.api.openCrashReport(folderPath, a.reportPath!)}>
              <FileText size={16} />
              크래시 보고서
            </button>
          )}
          <button className="btn primary" onClick={onClose} autoFocus>
            확인
          </button>
        </div>
      </div>
    </Modal>
  )
}
