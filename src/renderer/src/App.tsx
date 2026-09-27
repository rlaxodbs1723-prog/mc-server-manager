import { CopyPlus, FolderOpen, Pencil, Play, Plus, Settings, Square, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { SOFTWARE_INFO, type CrashAnalysis, type ServerListItem } from '../../shared-types'
import CrashDialog from './CrashDialog'
import CreateServer from './CreateServer'
import ServerPanel, { type PanelAction } from './ServerPanel'
import ContextMenu from './ContextMenu'
import { TasksProvider } from './tasks'
import TitleBar from './TitleBar'
import { Confirm, SoftwareBadge, ToastProvider, useToast } from './ui'
import { readStored, STATE_LABEL, writeStored } from './util'

// 앱을 닫을 때 확인 창 문구
function quitMessage(running: number, creating: number, jobs: string[]): string {
  const parts: string[] = []
  if (running) parts.push(`켜져 있는 서버 ${running}개를 안전하게 저장하고 끈 다음 앱을 닫을게요.`)
  if (creating) parts.push(`만들고 있는 서버 ${creating}개는 취소돼요.`)
  if (jobs.length) parts.push(`지금 하고 있는 작업(${[...new Set(jobs)].join(', ')})이 중간에 멈춰서 파일이 망가질 수 있어요. 끝날 때까지 기다리는 게 좋아요.`)
  return parts.join(' ')
}

function quitTitle(running: number, creating: number, jobs: string[]): string {
  if (jobs.length) return '아직 작업 중이에요'
  if (running) return '서버가 켜져 있어요'
  return creating ? '서버를 만들고 있어요' : '앱을 닫을까요?'
}

// 서버 목록 두 번째 줄: 켜져 있으면 접속 인원·켠 시간, 꺼져 있으면 모드 수·마지막 백업
function ago(ms: number): string {
  const min = Math.floor(ms / 60000)
  if (min < 1) return '방금'
  if (min < 60) return `${min}분`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}시간${min % 60 ? ` ${min % 60}분` : ''}`
  return `${Math.floor(h / 24)}일`
}

function serverStatusLine(s: ServerListItem, now: number, modWord: string | null): string {
  if (s.state === 'running' && s.startedAt) {
    const up = now - s.startedAt < 60_000 ? '방금 켜짐' : `${ago(now - s.startedAt)}째 켜짐`
    return `${s.playerCount}명 접속 · ${up}`
  }
  if (s.state !== 'stopped') return STATE_LABEL[s.state]
  const parts: string[] = []
  if (modWord && s.modCount != null) parts.push(`${modWord} ${s.modCount}개`)
  parts.push(s.lastBackupAt ? `백업 ${ago(now - s.lastBackupAt)} 전` : '백업 없음')
  return parts.join(' · ')
}

export default function App() {
  const [servers, setServers] = useState<ServerListItem[]>([])
  const [selected, setSelected] = useState<string | null>(null) // 서버 폴더 경로, null이면 "새 서버" 화면
  const [askQuit, setAskQuit] = useState<{ creating: number; jobs: string[] } | null>(null)
  const [now, setNow] = useState(Date.now()) // 켠 시간·백업 시간 표시용 (1분마다)
  const [quitting, setQuitting] = useState(false)
  const [dragging, setDragging] = useState<string | null>(null) // 끌고 있는 서버 폴더
  const [dropAt, setDropAt] = useState<number | null>(null) // 놓으면 들어갈 자리 (이 번호의 서버 앞)
  const [menu, setMenu] = useState<{ x: number; y: number; server: ServerListItem } | null>(null)
  const [request, setRequest] = useState<{ action: PanelAction; n: number } | null>(null)
  // 그 서버를 열고 동작을 넘긴다
  const ask = (s: ServerListItem, action: PanelAction) => {
    setSelected(s.folderPath)
    setRequest({ action, n: Date.now() })
  }

  const refresh = useCallback(
    () =>
      window.api.listServers().then((list) => {
        setServers(list)
        return list
      }),
    []
  )

  // 설정 창 등에서 서버 정보(아이콘 등)를 바꾸면 목록을 새로 읽는다
  useEffect(() => {
    const on = () => void refresh()
    window.addEventListener('servers-changed', on)
    return () => window.removeEventListener('servers-changed', on)
  }, [refresh])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  // 마지막으로 연 서버를 기억해 두었다가 다음에 켤 때 그 서버를 연다
  useEffect(() => {
    if (selected) writeStored('lastServer', selected)
  }, [selected])

  useEffect(() => {
    refresh().then((list) =>
      setSelected((cur) => {
        if (cur) return cur
        const last = readStored<string | null>('lastServer', null)
        return list.find((s) => s.folderPath === last)?.folderPath ?? list[0]?.folderPath ?? null
      })
    )
    // 서버가 켜지고 꺼질 때 목록의 상태 표시를 갱신한다 (켠 시각·백업 시간도 바뀌므로 목록을 다시 읽는다)
    const offEvent = window.api.onServerEvent((e) => {
      if (e.type === 'status') {
        setServers((list) => list.map((s) => (s.folderPath === e.folderPath ? { ...s, state: e.state } : s)))
        void refresh()
      }
      if (e.type === 'backups') void refresh() // 서버 목록의 "백업 N분 전"
      if (e.type === 'players') setServers((list) => list.map((s) => (s.folderPath === e.folderPath ? { ...s, playerCount: e.players.length } : s)))
    })
    const offQuit = window.api.onConfirmQuit(setAskQuit)
    return () => {
      offEvent()
      offQuit()
    }
  }, [refresh])

  const current = servers.find((s) => s.folderPath === selected)
  const runningCount = servers.filter((s) => s.state !== 'stopped').length

  return (
    <ToastProvider>
      <CrashWatcher servers={servers} />
      <TasksProvider
        servers={servers}
        onCreated={refresh}
        onOpen={async (folderPath) => {
          await refresh()
          setSelected(folderPath)
        }}
      >
        <div className="app">
          <TitleBar />
          <div className="shell">
            <aside className="sidebar">
              <button className={`new-server ${!current ? 'active' : ''}`} onClick={() => setSelected(null)}>
                <span className="plus">
                  <Plus size={18} strokeWidth={2.5} />
                </span>
                새 서버 만들기
              </button>

              <div className="sidebar-title">내 서버 {servers.length > 0 && servers.length}</div>
              {servers.length === 0 && (
                <p className="empty-side">
                  아직 만든 서버가 없어요.
                  <br />위 버튼으로 첫 서버를 만들어 보세요.
                </p>
              )}
              {servers.map((s, idx) => (
                <button
                  key={s.folderPath}
                  className={`server-item ${selected === s.folderPath ? 'active' : ''} ${dragging === s.folderPath ? 'dragging' : ''} ${dragging && dropAt === idx ? 'drop-before' : ''} ${dragging && dropAt === idx + 1 && idx === servers.length - 1 ? 'drop-after' : ''}`}
                  onClick={() => setSelected(s.folderPath)}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', s.folderPath)
                    setDragging(s.folderPath)
                  }}
                  onDragOver={(e) => {
                    if (!dragging) return
                    e.preventDefault()
                    // 칸의 위쪽 절반이면 이 서버 앞, 아래쪽 절반이면 뒤에 하얀 줄을 보여 준다 (놓으면 그 자리로 옮긴다)
                    const rect = e.currentTarget.getBoundingClientRect()
                    const i = servers.findIndex((x) => x.folderPath === s.folderPath)
                    const at = e.clientY - rect.top < rect.height / 2 ? i : i + 1
                    if (at !== dropAt) setDropAt(at)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    if (!dragging || dropAt == null) return
                    const from = servers.findIndex((x) => x.folderPath === dragging)
                    const next = [...servers]
                    const [moved] = next.splice(from, 1)
                    next.splice(dropAt > from ? dropAt - 1 : dropAt, 0, moved)
                    setServers(next)
                    window.api.setServerOrder(next.map((x) => x.folderPath))
                  }}
                  onDragEnd={() => {
                    setDragging(null)
                    setDropAt(null)
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setMenu({ x: e.clientX, y: e.clientY, server: s })
                  }}
                >
                  <SoftwareBadge software={s.software ?? 'vanilla'} size={36} name={s.name} icon={s.icon} />
                  <div className="meta">
                    <div className="name">{s.name}</div>
                    <div className="sub">
                      {SOFTWARE_INFO[s.software ?? 'vanilla'].label} · {s.mcVersion}
                    </div>
                    <div className={`sub status ${s.state}`}>{serverStatusLine(s, now, s.modCount == null ? null : ['paper', 'purpur'].includes(s.software ?? '') ? '플러그인' : '모드')}</div>
                  </div>
                  <span className={`dot ${s.state}`} title={STATE_LABEL[s.state]} />
                </button>
              ))}
            </aside>

            <main className={`main ${current ? 'fill' : ''}`}>
              {current ? (
                <ServerPanel
                  key={current.folderPath}
                  server={current}
                  onChanged={refresh}
                  request={request}
                  onRequestDone={() => setRequest(null)}
                  onDeleted={() => {
                    setSelected(null)
                    refresh()
                  }}
                />
              ) : (
                <CreateServer existingNames={servers.map((x) => x.name)} />
              )}
            </main>
          </div>
        </div>
        {menu &&
          (() => {
            const s = menu.server
            const on = s.state !== 'stopped'
            return (
              <ContextMenu
                x={menu.x}
                y={menu.y}
                onClose={() => setMenu(null)}
                items={[
                  on
                    ? { label: '서버 끄기', icon: <Square size={15} />, onClick: () => ask(s, 'stop'), disabled: s.state === 'stopping' }
                    : { label: '서버 켜기', icon: <Play size={15} />, onClick: () => ask(s, 'start') },
                  'sep',
                  { label: '설정', icon: <Settings size={15} />, onClick: () => ask(s, 'settings') },
                  { label: '이름 바꾸기', icon: <Pencil size={15} />, onClick: () => ask(s, 'rename') },
                  { label: '복제', icon: <CopyPlus size={15} />, onClick: () => ask(s, 'duplicate'), disabled: on },
                  { label: '폴더 열기', icon: <FolderOpen size={15} />, onClick: () => window.api.openFolder(s.folderPath) },
                  'sep',
                  { label: '삭제', icon: <Trash2 size={15} />, onClick: () => ask(s, 'delete'), danger: true, disabled: on }
                ]}
              />
            )
          })()}
      </TasksProvider>

      {askQuit && (
        <Confirm
          title={quitTitle(runningCount, askQuit.creating, askQuit.jobs)}
          body={quitMessage(runningCount, askQuit.creating, askQuit.jobs)}
          confirmText={askQuit.jobs.length ? '그래도 닫기' : runningCount ? '끄고 닫기' : '취소하고 닫기'}
          danger={askQuit.jobs.length > 0}
          onCancel={() => setAskQuit(null)}
          onConfirm={() => {
            setAskQuit(null)
            setQuitting(true)
            window.api.quitApp()
          }}
        />
      )}
      {quitting && (
        <div className="quitting">
          <div>
            <div className="spinner" />
            <h2>서버를 저장하고 있어요</h2>
            <p className="muted" style={{ marginTop: 6 }}>
              월드가 망가지지 않게 잠시만 기다려 주세요.
            </p>
          </div>
        </div>
      )}
    </ToastProvider>
  )
}

// 서버가 튕기면 알려 준다. 자동으로 다시 켜면 알림만(분석은 콘솔에), 아니면 원인·해결 방법 창을 띄운다
function CrashWatcher({ servers }: { servers: ServerListItem[] }) {
  const toast = useToast()
  const [crash, setCrash] = useState<{ name: string; folderPath: string; analysis: CrashAnalysis } | null>(null)
  useEffect(
    () =>
      window.api.onServerEvent((e) => {
        if (e.type !== 'crashed') return
        const name = servers.find((s) => s.folderPath === e.folderPath)?.name ?? '서버'
        if (e.restarting) toast(`서버가 튕겨서 5초 뒤에 다시 켜요 (${name}) · ${e.reason}`, 'error')
        else setCrash({ name, folderPath: e.folderPath, analysis: e.analysis })
      }),
    [servers, toast]
  )
  if (!crash) return null
  return <CrashDialog name={crash.name} folderPath={crash.folderPath} analysis={crash.analysis} onClose={() => setCrash(null)} />
}
