import { useState } from 'react'
import { Modal, useToast } from './ui'
import { cleanError } from './util'

// 버그 제보: 적은 내용으로 GitHub 새 이슈 화면을 열어 준다. 마지막 "제출"은 GitHub에서 직접 누른다
export default function BugReportDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')

  async function send() {
    try {
      await window.api.openBugReport(title, details)
      toast('브라우저에서 제보 화면을 열었어요. 내용을 확인하고 제출을 눌러 주세요')
      onClose()
    } catch (e) {
      toast(cleanError(e), 'error')
    }
  }

  return (
    <Modal onClose={onClose}>
      <h2>버그 제보</h2>
      <div className="bug-report">
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="한 줄 요약 (예: 모드 설치가 안 돼요)" autoFocus maxLength={200} />
        <textarea
          className="input"
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          rows={7}
          placeholder={'무엇을 하다가 어떻게 됐는지 적어 주세요.\n예: Fabric 1.21 서버에서 모드를 설치하니 서버가 켜지지 않아요.'}
        />
        <p className="hint">GitHub 제보 화면이 브라우저로 열려요. 앱 버전과 윈도우 정보는 자동으로 들어가요. 제출하려면 GitHub 계정이 필요해요.</p>
      </div>
      <div className="actions">
        <button className="btn" onClick={onClose}>
          취소
        </button>
        <button className="btn primary" onClick={send} disabled={!title.trim() && !details.trim()}>
          제보 화면 열기
        </button>
      </div>
    </Modal>
  )
}
