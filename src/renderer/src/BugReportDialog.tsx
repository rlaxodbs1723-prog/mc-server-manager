import { Paperclip, X } from 'lucide-react'
import { useState } from 'react'
import type { BugFile } from '../../shared-types'
import DropZone from './DropZone'
import { Modal, useToast } from './ui'
import { cleanError } from './util'

const MAX_FILES = 10
const mb = (n: number) => (n / 1024 / 1024).toFixed(1)

// 버그 제보: 앱 안에서 바로 보낸다 (사진·영상 첨부 가능, 앱 버전·윈도우 정보는 자동)
export default function BugReportDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [files, setFiles] = useState<BugFile[]>([])
  const [sending, setSending] = useState(false)

  const add = (more: BugFile[]) =>
    setFiles((cur) => {
      const next = [...cur]
      for (const f of more) if (!next.some((x) => x.path === f.path)) next.push(f)
      if (next.length > MAX_FILES) toast(`파일은 ${MAX_FILES}개까지 넣을 수 있어요`, 'error')
      return next.slice(0, MAX_FILES)
    })

  async function pick() {
    try {
      add(await window.api.pickBugFiles())
    } catch (e) {
      toast(cleanError(e), 'error')
    }
  }

  async function dropped(list: FileList) {
    const ok: BugFile[] = []
    for (const f of Array.from(list)) {
      try {
        ok.push(await window.api.bugFileInfo(f))
      } catch (e) {
        toast(cleanError(e), 'error')
      }
    }
    add(ok)
  }

  async function send() {
    setSending(true)
    try {
      await window.api.sendBugReport(
        title,
        details,
        files.map((f) => f.path)
      )
      toast('제보를 보냈어요. 고마워요!')
      onClose()
    } catch (e) {
      toast(cleanError(e), 'error')
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal onClose={sending ? undefined : onClose}>
      <h2>버그 제보</h2>
      <DropZone label="놓으면 첨부해요 (사진·영상)" onFiles={dropped} disabled={sending}>
        <div className="bug-report">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="한 줄 요약 (예: 모드 설치가 안 돼요)" autoFocus maxLength={200} />
          <textarea
            className="input"
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            rows={7}
            maxLength={4000}
            placeholder={'무엇을 하다가 어떻게 됐는지 적어 주세요.\n예: Fabric 1.21 서버에서 모드를 설치하니 서버가 켜지지 않아요.'}
          />
          <div className="bug-files">
            {files.map((f) => (
              <span key={f.path} className="bug-file">
                <span className="name">{f.name}</span>
                <span className="size">{mb(f.size)}MB</span>
                <button onClick={() => setFiles((cur) => cur.filter((x) => x.path !== f.path))} aria-label="빼기" disabled={sending}>
                  <X size={13} />
                </button>
              </span>
            ))}
            <button className="btn sm ghost" onClick={pick} disabled={sending || files.length >= MAX_FILES}>
              <Paperclip size={14} />
              사진·영상 첨부
            </button>
          </div>
          <p className="hint">앱 버전과 윈도우 정보가 같이 보내져요. 사진·영상은 파일당 10MB까지예요.</p>
        </div>
      </DropZone>
      <div className="actions">
        <button className="btn" onClick={onClose} disabled={sending}>
          취소
        </button>
        <button className="btn primary" onClick={send} disabled={sending || (!title.trim() && !details.trim())}>
          {sending && <span className="spinner" />}
          {sending ? '보내는 중…' : '보내기'}
        </button>
      </div>
    </Modal>
  )
}
