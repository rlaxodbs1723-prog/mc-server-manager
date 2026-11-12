import { useState } from 'react'
import { Modal, useToast } from './ui'
import { cleanError } from './util'

// 친구가 준 공유 코드로 친구 서버를 내 목록에 넣는다 (서버는 친구 컴퓨터에서 돈다)
export default function JoinShareDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  async function join() {
    setBusy(true)
    try {
      const path = await window.api.joinShare(code.trim())
      toast('공유받은 서버를 목록에 넣었어요', 'success')
      window.dispatchEvent(new CustomEvent('open-server', { detail: path }))
      onClose()
    } catch (e) {
      toast(cleanError(e), 'error')
      setBusy(false)
    }
  }

  return (
    <Modal onClose={busy ? undefined : onClose}>
      <h2>공유받은 서버 추가</h2>
      <p className="body">친구가 보내 준 초대 코드를 붙여 넣으세요. 친구 컴퓨터에서 돌아가는 서버의 상태와 콘솔을 여기서 볼 수 있어요.</p>
      <input
        className="input"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && code.trim() && !busy && void join()}
        placeholder="초대 코드"
        autoFocus
      />
      <div className="actions">
        <button className="btn" onClick={onClose} disabled={busy}>
          취소
        </button>
        <button className="btn primary" onClick={join} disabled={busy || !code.trim()}>
          {busy && <span className="spinner" />}
          추가
        </button>
      </div>
    </Modal>
  )
}
