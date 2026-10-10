import { Mail } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Inbox, InboxPost, MyBugReport } from '../../shared-types'
import { AttachedFiles, ReportDetail } from './BugReportDialog'
import { Empty, Loading, Modal } from './ui'
import { cleanError } from './util'

// 읽은 공지·패치노트는 이 컴퓨터에만 기억한다 (못 읽으면 전부 새 글로 보일 뿐이다)
const SEEN_KEY = 'inboxSeen'
const readSeen = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]')
  } catch {
    return []
  }
}
const writeSeen = (ids: string[]): void => {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(ids))
  } catch {
    // 저장 못 해도 괜찮다
  }
}
const idsOf = (box: Inbox): string[] => [...box.notices, ...box.patches].map((p) => p.id)
const unreadReplies = (list: MyBugReport[]): number => list.reduce((n, r) => n + Math.max(0, r.replies.length - r.seen), 0)

type Tab = 'notices' | 'patches' | 'replies'

// 타이틀바의 알림함 버튼: 공지, 패치노트, 버그 제보 답장을 한곳에서 본다. 새 글이 있으면 빨간 점
export default function InboxButton() {
  const [show, setShow] = useState(false)
  const [box, setBox] = useState<Inbox | null>(null)
  const [error, setError] = useState('')
  const [reports, setReports] = useState<MyBugReport[]>([])
  const [seen, setSeen] = useState<string[]>(readSeen)

  const loadReports = () => window.api.getMyBugReports().then(setReports).catch(() => undefined)
  const loadBox = () =>
    window.api
      .getInbox()
      .then((b) => {
        setBox(b)
        setError('')
      })
      .catch((e) => setError(cleanError(e)))

  useEffect(() => {
    loadBox()
    loadReports()
    const t = setInterval(loadBox, 30 * 60_000)
    const off = window.api.onBugReplies(loadReports)
    return () => {
      clearInterval(t)
      off()
    }
  }, [])

  const newPosts = box ? idsOf(box).filter((id) => !seen.includes(id)).length : 0
  const unread = newPosts + unreadReplies(reports)

  return (
    <>
      <button className="task-btn inbox-btn" onClick={() => setShow(true)} title="알림함" onDoubleClick={(e) => e.stopPropagation()}>
        <Mail size={16} />
        {unread > 0 && <span className="bug-dot" />}
      </button>
      {show &&
        createPortal(
          <div onDoubleClick={(e) => e.stopPropagation()}>
            <InboxDialog
              box={box}
              error={error}
              reports={reports}
              seen={seen}
              onSeen={(ids) => {
                const next = [...new Set([...seen, ...ids])]
                setSeen(next)
                writeSeen(next)
              }}
              onRepliesSeen={() => window.api.markBugRepliesSeen().then(loadReports)}
              onClose={() => setShow(false)}
            />
          </div>,
          document.body
        )}
    </>
  )
}

function InboxDialog(props: {
  box: Inbox | null
  error: string
  reports: MyBugReport[]
  seen: string[]
  onSeen: (ids: string[]) => void
  onRepliesSeen: () => void
  onClose: () => void
}) {
  const { box, error, reports, seen, onSeen, onRepliesSeen, onClose } = props
  // 안 읽은 답장이 있으면 답장부터, 아니면 공지부터
  const [tab, setTab] = useState<Tab>(() => (unreadReplies(reports) > 0 ? 'replies' : 'notices'))
  const [openId, setOpenId] = useState<string | null>(null)
  const open = reports.find((r) => r.id === openId) ?? null

  // 탭을 보면 그 탭의 글은 읽은 것으로 친다 (빨간 표시는 이번에 연 동안은 남겨 둔다)
  const [firstSeen] = useState(seen)
  useEffect(() => {
    if (!box) return
    if (tab === 'notices') onSeen(box.notices.map((n) => n.id))
    if (tab === 'patches') onSeen(box.patches.map((p) => p.id))
    if (tab === 'replies') onRepliesSeen()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, box])

  const isNew = (id: string) => !firstSeen.includes(id)
  const dot = (n: number) => (n > 0 ? <span className="inbox-tab-dot" /> : null)
  const newNotices = box ? box.notices.filter((n) => isNew(n.id)).length : 0
  const newPatches = box ? box.patches.filter((p) => isNew(p.id)).length : 0
  const post = (p: InboxPost) => (
    <article key={p.id} className={`inbox-item ${isNew(p.id) ? 'new' : ''}`}>
      <div className="inbox-head">
        <b>{p.title}</b>
        <span className="hint">{p.date}</span>
      </div>
      {p.body && <p>{p.body}</p>}
      {p.files.length > 0 && <AttachedFiles files={p.files} />}
    </article>
  )

  return (
    <Modal onClose={onClose}>
      <div className="inbox">
        <h2>알림함</h2>
        <div className="seg">
          <button className={tab === 'notices' ? 'active' : ''} onClick={() => setTab('notices')}>
            공지 {dot(newNotices)}
          </button>
          <button className={tab === 'patches' ? 'active' : ''} onClick={() => setTab('patches')}>
            패치노트 {dot(newPatches)}
          </button>
          <button className={tab === 'replies' ? 'active' : ''} onClick={() => setTab('replies')}>
            제보 답장 {dot(unreadReplies(reports))}
          </button>
        </div>

        <div className="inbox-list">
          {tab !== 'replies' && !box && (error ? <p className="error-text">{error}</p> : <Loading />)}

          {tab === 'notices' &&
            box &&
            (box.notices.length ? (
              box.notices.map(post)
            ) : (
              <Empty title="공지가 없어요" />
            ))}

          {tab === 'patches' &&
            box &&
            (box.patches.length ? (
              box.patches.map(post)
            ) : (
              <Empty title="패치노트가 없어요" />
            ))}

          {tab === 'replies' &&
            (reports.length ? (
              reports.map((r) => (
                <button
                  key={r.id}
                  className={`bug-mine-item ${r.replies.length > r.seen ? 'new' : ''}`}
                  onClick={() => {
                    setOpenId(r.id)
                    void window.api.refreshBugReplies() // 첨부 파일 주소가 막혔을 수 있어서 새로 받는다
                  }}
                >
                  <div className="bug-mine-head">
                    <b>{r.title}</b>
                    <span className="hint">{new Date(r.sentAt).toLocaleDateString()}</span>
                  </div>
                  {r.replies.length ? (
                    <div className="bug-reply">{r.replies[r.replies.length - 1].text || '📎'}</div>
                  ) : (
                    <p className="hint">{'아직 답장이 없어요. 답장이 오면 알려 드려요.'}</p>
                  )}
                </button>
              ))
            ) : (
              <Empty title="보낸 제보가 없어요" hint="오른쪽 위 버그 제보로 보내면 답장을 여기서 볼 수 있어요." />
            ))}
        </div>
      </div>
      <div className="actions">
        <button className="btn primary" onClick={onClose}>
          닫기
        </button>
      </div>
      {open && <ReportDetail report={open} onClose={() => setOpenId(null)} />}
    </Modal>
  )
}
