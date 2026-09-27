import { ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { Modal } from './ui'

interface Props {
  onAccept: () => void
  onCancel: () => void
}

// 서버를 처음 켤 때 한 번 보여 준다. 사용자가 직접 체크해야만 동의할 수 있다.
export default function EulaDialog({ onAccept, onCancel }: Props) {
  const [checked, setChecked] = useState(false)

  return (
    <Modal onClose={onCancel}>
      <h2>마인크래프트 이용 약관에 동의해 주세요</h2>
      <p className="body">
        서버를 열려면 Mojang의 최종 사용자 라이선스 계약(EULA)에 동의해야 해요. 서버로 돈을 벌거나 유료 아이템을 파는 것
        등에 제한이 있으니 한 번 읽어 보세요.
      </p>
      <p className="body">
        <button className="link" onClick={() => window.api.openEulaPage()}>
          EULA 전문 읽기
          <ExternalLink size={14} />
        </button>
      </p>
      <label className="check-row agree">
        <span className="switch">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <span />
        </span>
        EULA를 읽었고 동의해요
      </label>
      <div className="actions">
        <button className="btn" onClick={onCancel}>
          취소
        </button>
        <button className="btn primary" disabled={!checked} onClick={onAccept}>
          동의하고 켜기
        </button>
      </div>
    </Modal>
  )
}
