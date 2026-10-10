import { Paperclip, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { BugFile, MyBugReport } from '../../shared-types'
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
  const [mine, setMine] = useState<MyBugReport[]>([])
  const [tab, setTab] = useState<'new' | 'mine'>('new')
  const [open, setOpen] = useState<MyBugReport | null>(null) // 눌러서 자세히 보는 제보

  // 내가 보낸 제보와 답장. 답장이 안 읽은 게 있으면 처음부터 그쪽을 보여 준다
  useEffect(() => {
    const load = () =>
      window.api.getMyBugReports().then((list) => {
        setMine(list)
        if (list.some((r) => r.replies.length > r.seen)) setTab('mine')
      })
    load()
    return window.api.onBugReplies(load)
  }, [])
  useEffect(() => {
    if (tab === 'mine') void window.api.markBugRepliesSeen()
  }, [tab, mine])

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
      {mine.length > 0 && (
        <div className="seg bug-tabs">
          <button className={tab === 'new' ? 'active' : ''} onClick={() => setTab('new')}>
            새 제보
          </button>
          <button className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}>
            {`내 제보 (${mine.length})`}
          </button>
        </div>
      )}
      {tab === 'mine' ? (
        <>
          <div className="bug-mine">
            {mine.map((r) => (
              <button key={r.id} className="bug-mine-item" onClick={() => setOpen(r)}>
                <div className="bug-mine-head">
                  <b>{r.title}</b>
                  <span className="hint">{new Date(r.sentAt).toLocaleDateString()}</span>
                </div>
                {r.replies.length ? (
                  r.replies.map((x, i) => (
                    <div key={x.id} className={`bug-reply ${i >= r.seen ? 'new' : ''}`}>
                      <span className="bug-reply-from">{'개발자 답장'}</span>
                      {x.text}
                    </div>
                  ))
                ) : (
                  <p className="hint">{'아직 답장이 없어요. 답장이 오면 알려 드려요.'}</p>
                )}
              </button>
            ))}
          </div>
          <div className="actions">
            <button className="btn primary" onClick={onClose}>
              닫기
            </button>
          </div>
        </>
      ) : (
        <>
      <DropZone label="놓으면 첨부해요 (사진·영상)" onFiles={dropped} disabled={sending}>
        <div className="bug-report">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="한 줄 요약 (예: 모드 설치가 안 돼요)" autoFocus maxLength={200} />
          <span className="hint bug-count">{`${title.length}/200`}</span>
          <textarea
            className="input"
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            rows={7}
            maxLength={4000}
            placeholder={'무엇을 하다가 어떻게 됐는지 적어 주세요.\n예: Fabric 1.21 서버에서 모드를 설치하니 서버가 켜지지 않아요.'}
          />
          <span className="hint bug-count">{`${details.length}/4000`}</span>
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
          <p className="hint">앱 버전과 윈도우 정보가 같이 보내져요. 사진·영상은 파일당 4MB까지예요. 답장이 오면 알려 드려요.</p>
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
        </>
      )}
      {open && (
        <Modal onClose={() => setOpen(null)}>
          <h2 className="bug-detail-title">{open.title}</h2>
          <div className="bug-detail">
            <span className="hint">{new Date(open.sentAt).toLocaleString()}</span>
            {open.details && <div className="bug-question">{open.details}</div>}
            {open.replies.length ? (
              open.replies.map((x) => (
                <div key={x.id} className="bug-reply">
                  <span className="bug-reply-from">{'개발자 답장'}</span>
                  {x.text}
                </div>
              ))
            ) : (
              <p className="hint">{'아직 답장이 없어요. 답장이 오면 알려 드려요.'}</p>
            )}
          </div>
          <div className="actions">
            <button className="btn primary" onClick={() => setOpen(null)}>
              닫기
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  )
}
