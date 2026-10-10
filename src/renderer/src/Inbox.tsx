import { Mail } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Inbox, InboxPost, MyBugReport } from '../../shared-types'
import { AttachedFiles, ReportDetail } from './BugReportDialog'
import { Empty, LeaveBox, Loading, Modal } from './ui'
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

// 디스코드 시간(UTC)을 이 컴퓨터 시간대 날짜로
const shortDate = (at: string): string => {
  const d = new Date(at)
  return Number.isNaN(d.getTime()) ? at : d.toLocaleDateString()
}

type Tab = 'notices' | 'patches' | 'replies'

// 타이틀바의 알림함 버튼: 누르면 버튼 아래에 공지, 패치노트, 버그 제보 답장 패널이 열린다. 새 글이 있으면 빨간 점
export default function InboxButton() {
  const [show, setShow] = useState(false)
  const [box, setBox] = useState<Inbox | null>(null)
  const [error, setError] = useState('')
  const [reports, setReports] = useState<MyBugReport[]>([])
  const [seen, setSeen] = useState<string[]>(readSeen)
  const ref = useRef<HTMLDivElement>(null)

  // 패널 밖을 누르거나 Esc면 닫는다 (제보 자세히 보기 창 안을 누른 건 빼고)
  useEffect(() => {
    if (!show) return
    const close = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (!ref.current?.contains(t) && !t.closest?.('.backdrop')) setShow(false)
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && setShow(false)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', key)
    }
  }, [show])

  const loadReports = () => window.api.getMyBugReports().then(setReports).catch(() => undefined)
  const loadBox = (fresh = false) =>
    window.api
      .getInbox(fresh)
      .then((b) => {
        setBox(b)
        setError('')
      })
      .catch((e) => setError(cleanError(e)))

  useEffect(() => {
    loadBox()
    loadReports()
    const t = setInterval(() => loadBox(), 10 * 60_000) // 새 글 빨간 점용
    const off = window.api.onBugReplies(loadReports)
    return () => {
      clearInterval(t)
      off()
    }
  }, [])

  const newPosts = box ? idsOf(box).filter((id) => !seen.includes(id)).length : 0
  const unread = newPosts + unreadReplies(reports)

  return (
    <div className="task-anchor inbox-anchor" ref={ref} onDoubleClick={(e) => e.stopPropagation()}>
      <button className={`task-btn ${show ? 'active' : ''}`} onClick={() => {
          if (!show) void loadBox(true) // 열 때마다 새로 받아 온다
          setShow((v) => !v)
        }} title="알림함">
        <Mail size={16} />
        {unread > 0 && <span className="bug-dot" />}
      </button>
      {show && (
        <InboxPanel
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
        />
      )}
    </div>
  )
}

function InboxPanel(props: {
  box: Inbox | null
  error: string
  reports: MyBugReport[]
  seen: string[]
  onSeen: (ids: string[]) => void
  onRepliesSeen: () => void
}) {
  const { box, error, reports, seen, onSeen, onRepliesSeen } = props
  // 안 읽은 답장이 있으면 답장부터, 아니면 공지부터
  const [tab, setTab] = useState<Tab>(() => (unreadReplies(reports) > 0 ? 'replies' : 'notices'))
  const [openId, setOpenId] = useState<string | null>(null)
  const open = reports.find((r) => r.id === openId) ?? null
  const [openPost, setOpenPost] = useState<InboxPost | null>(null) // 눌러서 자세히 보는 공지·패치노트

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
  // 목록에는 제목과 첫 줄만, 누르면 전체를 창으로
  const post = (p: InboxPost) => (
    <button key={p.id} className={`bug-mine-item ${isNew(p.id) ? 'new' : ''}`} onClick={() => setOpenPost(p)}>
      <div className="bug-mine-head">
        <b>{p.title || '📎'}</b>
        <span className="hint">{shortDate(p.date)}</span>
      </div>
      {(p.body || p.files.length > 0) && <div className="inbox-line hint">{p.body.split('\n')[0] || `📎 ${p.files.length}`}</div>}
    </button>
  )

  return (
    <LeaveBox className="task-panel inbox-panel">
      <div className="inbox">
        <div className="task-panel-head">
          <b>알림함</b>
        </div>
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
      {/* 패널은 움직이는 효과가 있어서, 자세히 보기 창은 화면 맨 위(body)에 띄운다 */}
      {open && createPortal(<ReportDetail report={open} onClose={() => setOpenId(null)} />, document.body)}
      {openPost && createPortal(<PostDetail post={openPost} onClose={() => setOpenPost(null)} />, document.body)}
    </LeaveBox>
  )
}

// 공지·패치노트 하나 전체
function PostDetail({ post, onClose }: { post: InboxPost; onClose: () => void }) {
  return (
    <Modal onClose={onClose}>
      <div className="post-detail">
        <h2>{post.title}</h2>
        <span className="hint">{new Date(post.date).toLocaleString()}</span>
        {post.body && <p>{post.body}</p>}
        {post.files.length > 0 && <AttachedFiles files={post.files} />}
      </div>
      <div className="actions">
        <button className="btn primary" onClick={onClose}>
          닫기
        </button>
      </div>
    </Modal>
  )
}
