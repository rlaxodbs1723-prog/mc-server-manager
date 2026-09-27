// 서버 만들기와 오래 걸리는 작업(모드 업데이트, 백업, 버전 바꾸기 등)을 타이틀바의 작업 버튼 목록에 보여 준다.
import { AlertCircle, CheckCircle2, Download, X } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { CreateServerOptions, Progress, ServerListItem, Software } from '../../shared-types'
import { Empty, LeaveBox, SoftwareBadge, useToast } from './ui'
import { cleanError } from './util'

interface Task {
  id: string
  kind: 'create' | 'job'
  options?: CreateServerOptions // 서버 만들기일 때
  name: string // 서버 이름
  software: Software
  icon?: string | null
  title?: string // 작업 이름 (예: 모드 모두 업데이트)
  doneText?: string
  status: 'running' | 'done' | 'error'
  progress: Progress | null
  startedAt: number
  folderPath?: string
  error?: string
  cancelling?: boolean
}

interface TasksApi {
  tasks: Task[]
  markCancelling: (id: string, on: boolean) => void
  startCreate: (options: CreateServerOptions) => void
  // 작업 목록에 올려 두고 work를 실행한다. 결과·오류는 그대로 돌려준다 (토스트 등은 부르는 쪽에서)
  // doneText가 함수면 결과를 보고 정한다 (null이면 목록에서 뺀다. 예: 저장 창에서 취소)
  runJob: <T>(folderPath: string, title: string, doneText: string | ((r: T) => string | null), work: (report: (p: Progress) => void) => Promise<T>) => Promise<T>
  // 이 서버에서 지금 하고 있는 작업 이름 (없으면 null). 켜기 버튼 등을 막고 이유를 보여 줄 때 쓴다
  busyOf: (folderPath: string) => string | null
  dismiss: (id: string) => void
  open: (folderPath: string) => void
}

const TasksContext = createContext<TasksApi>({ tasks: [], markCancelling: () => {}, startCreate: () => {}, runJob: (_f, _t, _d, work) => work(() => {}), busyOf: () => null, dismiss: () => {}, open: () => {} })
export const useTasks = () => useContext(TasksContext)

let nextId = 1

// 남은 시간은 메인이 단계별 속도와 지난번 기록으로 계산해 보내 준다 (progress.etaSeconds)
function remainingText(t: Task): string {
  const left = t.progress?.etaSeconds
  if (left == null) return '남은 시간을 계산하고 있어요'
  if (left <= 3) return '거의 다 됐어요'
  if (left < 60) return `약 ${left}초 남았어요`
  return `약 ${Math.floor(left / 60)}분 ${left % 60}초 남았어요`
}

interface ProviderProps {
  children: ReactNode
  onCreated: () => void // 서버 목록 새로고침
  onOpen: (folderPath: string) => void // 팝업의 "열기"
  servers: ServerListItem[] // 작업 옆에 서버 이름·아이콘을 보여 주려고
}

export function TasksProvider({ children, onCreated, onOpen, servers }: ProviderProps) {
  const toast = useToast()
  const [tasks, setTasks] = useState<Task[]>([])
  const update = (id: string, fn: (t: Task) => Task) => setTasks((list) => list.map((t) => (t.id === id ? fn(t) : t)))
  const dismiss = (id: string) => setTasks((list) => list.filter((t) => t.id !== id))
  const callbacks = useRef({ onCreated, onOpen, servers })
  callbacks.current = { onCreated, onOpen, servers }

  // 진행 상황은 작업 번호로 나눠 받는다
  useEffect(
    () =>
      window.api.onCreateProgress((id, progress) =>
        update(id, (t) => ({ ...t, progress }))
      ),
    []
  )

  const startCreate = useCallback(
    (options: CreateServerOptions) => {
      const id = String(nextId++)
      const t0 = Date.now()
      setTasks((list) => [...list, { id, kind: 'create', options, name: options.name, software: options.software, status: 'running', progress: null, startedAt: t0 }])
      window.api
        .createServer(options, id)
        .then((info) => {
          update(id, (t) => ({ ...t, status: 'done', folderPath: info.folderPath }))
          toast(`${options.name} 서버를 만들었어요`)
          callbacks.current.onCreated()
        })
        .catch((e) => {
          const msg = cleanError(e)
          if (msg.includes('설치를 취소했어요')) {
            dismiss(id)
            toast(`${options.name} 서버 만들기를 중단했어요`)
          } else update(id, (t) => ({ ...t, status: 'error', error: msg }))
        })
    },
    [toast]
  )

  const runJob = useCallback(async <T,>(folderPath: string, title: string, doneText: string | ((r: T) => string | null), work: (report: (p: Progress) => void) => Promise<T>): Promise<T> => {
    const id = String(nextId++)
    const s = callbacks.current.servers.find((x) => x.folderPath === folderPath)
    setTasks((list) => [
      ...list,
      { id, kind: 'job', folderPath, name: s?.name ?? '', software: s?.software ?? 'vanilla', icon: s?.icon, title, status: 'running', progress: null, startedAt: Date.now() }
    ])
    try {
      const r = await work((p) =>
        update(id, (t) => ({ ...t, progress: { ...p, percent: p.percent ?? (p.total ? Math.round(((p.done ?? 0) / p.total) * 100) : undefined) } }))
      )
      const text = typeof doneText === 'function' ? doneText(r) : doneText
      if (text === null) dismiss(id)
      else update(id, (t) => ({ ...t, status: 'done', doneText: text }))
      return r
    } catch (e) {
      update(id, (t) => ({ ...t, status: 'error', error: cleanError(e) }))
      throw e
    }
  }, [])

  return (
    <TasksContext.Provider value={{ tasks, markCancelling: (id, on) => update(id, (t) => ({ ...t, cancelling: on })), startCreate, runJob, busyOf: (f) => tasks.find((t) => t.kind === 'job' && t.status === 'running' && t.folderPath === f)?.title ?? null, dismiss, open: (f) => callbacks.current.onOpen(f) }}>
      {children}
    </TasksContext.Provider>
  )
}

// 타이틀바의 작업 버튼: 진행 중이면 둥근 진행 표시가 돌고, 누르면 목록이 펼쳐진다
export function TaskButton() {
  const { tasks, dismiss, open, markCancelling: setTasksCancelling } = useTasks()
  const toast = useToast()
  const [show, setShow] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const running = tasks.filter((t) => t.status === 'running')
  const done = tasks.filter((t) => t.status !== 'running')
  const avg = running.length ? running.reduce((n, t) => n + (t.progress?.percent ?? 0), 0) / running.length : 0

  // 서버 만들기가 새로 시작되면 한 번 펼쳐서 알려 준다 (다른 작업은 버튼의 진행 표시로만)
  const creates = tasks.filter((t) => t.kind === 'create').length
  const count = useRef(creates)
  useEffect(() => {
    if (creates > count.current) setShow(true)
    count.current = creates
  }, [creates])

  useEffect(() => {
    if (!show) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setShow(false)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setShow(false)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', key)
    }
  }, [show])

  return (
    <div className="task-anchor" ref={ref} onDoubleClick={(e) => e.stopPropagation()}>
      <button className={`task-btn ${show ? 'active' : ''}`} onClick={() => setShow((v) => !v)} title="작업 목록">
        {running.length > 0 && (
          <svg className="task-ring" viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="15" />
            <circle cx="18" cy="18" r="15" className="fg" style={{ strokeDasharray: `${(avg / 100) * 94.2} 94.2` }} />
          </svg>
        )}
        <Download size={16} />
        {running.length > 1 && <span className="task-count">{running.length}</span>}
      </button>
      {show && (
        <LeaveBox className="task-panel">
          <div className="task-panel-head">
            <b>작업</b>
            {done.length > 0 && (
              <button className="btn sm ghost" onClick={() => done.forEach((t) => dismiss(t.id))}>
                끝난 것 지우기
              </button>
            )}
          </div>
          {tasks.length === 0 && <Empty title="진행 중인 작업이 없어요" hint="서버 만들기, 업데이트, 백업 같은 작업이 여기에 보여요." />}
          <div className="task-list">
            {[...tasks].reverse().map((t) => {
              const percent = t.progress?.percent ?? null
              return (
                <div key={t.id} className={`task-popup ${t.status}`}>
                  <div className="task-head">
                    <SoftwareBadge software={t.software} size={32} name={t.name} icon={t.icon} />
                    <div className="task-title">
                      <b>{t.kind === 'job' ? `${t.title}${t.name ? ` · ${t.name}` : ''}` : t.name}</b>
                      <span className="hint">
                        {t.status === 'running'
                          ? t.progress?.message ?? '준비하고 있어요'
                          : t.status === 'done'
                          ? t.doneText ?? '서버를 만들었어요'
                          : t.kind === 'job'
                          ? '하지 못했어요'
                          : '만들지 못했어요'}
                      </span>
                    </div>
                    {t.status === 'done' && <CheckCircle2 size={20} className="task-ok" />}
                    {t.status === 'error' && <AlertCircle size={20} className="task-bad" />}
                    {t.status === 'running' && t.kind === 'create' && (
                      <button
                        className="btn sm danger task-cancel"
                        disabled={t.cancelling}
                        onClick={() => {
                          setTasksCancelling(t.id, true)
                          window.api.cancelCreate(t.id).catch(() => {
                            setTasksCancelling(t.id, false)
                            toast('중단하지 못했어요. 앱을 껐다 켠 뒤에 다시 해 보세요', 'error')
                          })
                        }}
                      >
                        {t.cancelling ? '중단하는 중…' : '중단'}
                      </button>
                    )}
                    {t.status !== 'running' && (
                      <button className="btn icon sm ghost" onClick={() => dismiss(t.id)} aria-label="지우기">
                        <X size={16} />
                      </button>
                    )}
                  </div>
                  {t.status === 'running' && (
                    <>
                      <div className={`bar ${percent == null ? 'indeterminate' : ''}`}>
                        <i style={percent == null ? undefined : { width: `${percent}%` }} />
                      </div>
                      <div className="task-meta">
                        <span>{t.kind === 'create' ? remainingText(t) : ''}</span>
                        {percent != null && <span>{percent}%</span>}
                      </div>
                    </>
                  )}
                  {t.status === 'done' && t.folderPath && (
                    <button
                      className="btn sm primary block"
                      onClick={() => {
                        open(t.folderPath!)
                        dismiss(t.id)
                        setShow(false)
                      }}
                    >
                      서버 열기
                    </button>
                  )}
                  {t.status === 'error' && <p className="error-text task-error">{t.error}</p>}
                </div>
              )
            })}
          </div>
        </LeaveBox>
      )}
    </div>
  )
}
