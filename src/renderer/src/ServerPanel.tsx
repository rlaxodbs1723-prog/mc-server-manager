import { ArrowDown, CopyPlus, FolderOpen, Pencil, Play, Search, Send, Settings, Square, Trash2, X, Zap } from 'lucide-react'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { SOFTWARE_INFO, type ModKindInfo, type PreflightResult, type Progress, type ServerListItem } from '../../shared-types'
import { suggest, usageOf } from './consoleHelp'
import EulaDialog from './EulaDialog'
import InviteBox from './InviteBox'
import FirstRunGuide from './FirstRunGuide'
import ManageTab from './ManageTab'
import BackupTab from './BackupTab'
import FilesTab from './FilesTab'
import DatapacksTab from './DatapacksTab'
import ModsTab from './ModsTab'
import SettingsDialog from './SettingsDialog'
import StatsBar from './StatsBar'
import { Confirm, Modal, ProgressView, SoftwareBadge, useToast } from './ui'
import { bootStage, cleanError, readStored, STATE_LABEL, useStored, writeStored } from './util'
import { useTasks } from './tasks'
import OffSuggestDialog, { checkOffSuggestions } from './OffSuggestDialog'
import PreflightDialog from './PreflightDialog'
import { flushPendingRemovals } from './undo'

const LOG_LIMIT = 1500

// 켜기 전 점검 결과를 비교하는 열쇠 (메모리는 숫자가 매번 달라서 종류만 본다)
function preflightKey(r: PreflightResult): string {
  const mem = !r.memory ? '' : r.memory.startsWith('서버에') ? 'total' : 'free'
  return JSON.stringify([r.missing.map((m) => [m.mod, [...m.needs].sort()]).sort(), r.duplicates.map((d) => [...d.files].sort()).sort(), mem])
}

// 옆 목록의 우클릭 메뉴에서 고른 동작 (n이 바뀔 때마다 한 번 실행)
export type PanelAction = 'start' | 'stop' | 'settings' | 'rename' | 'duplicate' | 'delete'

interface Props {
  server: ServerListItem
  onChanged: () => void
  onDeleted: () => void
  request?: { action: PanelAction; n: number } | null
  onRequestDone?: () => void
}

// 줄 종류에 따라 색을 다르게 (경고·오류·입력한 명령·앱 메시지)
function lineClass(line: string): string | undefined {
  if (line.startsWith('> ')) return 'l-cmd'
  if (line.startsWith('[앱]')) return 'l-app'
  if (/\bERROR\b|Exception|\bFATAL\b|^\s+at /.test(line)) return 'l-error'
  if (/\bWARN\b/.test(line)) return 'l-warn'
  return undefined
}

// 검색어가 있으면 그 부분을 강조한다
function highlight(line: string, q: string) {
  if (!q) return line
  const out: React.ReactNode[] = []
  const lower = line.toLowerCase()
  let from = 0
  for (let at = lower.indexOf(q, from); at !== -1; at = lower.indexOf(q, from)) {
    out.push(line.slice(from, at), <mark key={at}>{line.slice(at, at + q.length)}</mark>)
    from = at + q.length
  }
  out.push(line.slice(from))
  return out
}

const ConsoleLines = memo(function ConsoleLines({ log, query }: { log: string[]; query: string }) {
  return (
    <>
      {log.map((line, i) => (
        <div key={i} className={lineClass(line)}>
          {highlight(line, query)}
        </div>
      ))}
    </>
  )
})

export default function ServerPanel({ server, onChanged, onDeleted, request, onRequestDone }: Props) {
  const toast = useToast()
  const { runJob, busyOf } = useTasks() // 오래 걸리는 작업은 타이틀바 작업 목록에도 보여 준다
  const { folderPath, state } = server
  const software = server.software ?? 'vanilla'
  const [log, setLog] = useState<string[]>([])
  const [command, setCommand] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [showEula, setShowEula] = useState(false)
  const [askDelete, setAskDelete] = useState(false)
  const [askStop, setAskStop] = useState(false) // 접속한 사람이 있을 때 끌지 묻기
  const [naming, setNaming] = useState<'rename' | 'duplicate' | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useStored<'console' | 'manage' | 'mods' | 'datapacks' | 'backup' | 'files'>(`tab:${folderPath}`, 'console') // 서버마다 마지막 탭을 기억한다
  const [modKind, setModKind] = useState<ModKindInfo | null>(null) // 바닐라면 null → 모드 탭 없음
  const consoleRef = useRef<HTMLPreElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [search, setSearch] = useState('')
  const [onlyProblems, setOnlyProblems] = useState(false)
  const [players, setPlayers] = useState<string[]>([])
  const [sugIndex, setSugIndex] = useState(0)
  const [sugHidden, setSugHidden] = useState(false)
  const stickToBottom = useRef(true)
  const [follow, setFollow] = useStored('consoleFollow', true) // 새 줄을 따라 맨 아래로 내려갈지
  const [atBottom, setAtBottom] = useState(true)
  const [checking, setChecking] = useState(false) // 켜기 전 점검 중
  const [preflight, setPreflight] = useState<PreflightResult | null>(null)
  const resumeStart = useRef(false) // 켜기 전 점검에서 끌지 묻는 창을 띄웠으면, 답한 뒤 이어서 켠다

  useEffect(() => {
    window.api.modKind(folderPath).then(setModKind)
  }, [folderPath])

  // 서버를 바꾸면 그 서버의 로그를 새로 불러오고, 이후 줄은 이벤트로 받는다
  useEffect(() => {
    setLog([])
    setError('')
    stickToBottom.current = true
    setAtBottom(true)
    window.api.getLog(folderPath).then(setLog)
    // 로그가 한꺼번에 쏟아질 때(모드 서버 켤 때 등) 줄마다 다시 그리면 느려서, 한 화면(프레임)에 한 번만 모아서 붙인다
    let pending: string[] = []
    let frame = 0
    const flush = (): void => {
      frame = 0
      const add = pending
      pending = []
      setLog((l) => {
        const next = l.concat(add)
        return next.length > LOG_LIMIT ? next.slice(-LOG_LIMIT) : next
      })
    }
    const off = window.api.onServerEvent((e) => {
      if (e.folderPath !== folderPath || e.type !== 'log') return
      pending.push(e.line)
      if (!frame) frame = requestAnimationFrame(flush)
    })
    return () => {
      off()
      cancelAnimationFrame(frame)
    }
  }, [folderPath])

  // 자동완성에 쓸 접속 중인 사람
  useEffect(() => {
    setPlayers([])
    window.api.getManageInfo(folderPath).then((i) => setPlayers(i.players.map((p) => p.name))).catch(() => undefined)
    return window.api.onServerEvent((e) => {
      if (e.type === 'players' && e.folderPath === folderPath) setPlayers(e.players)
    })
  }, [folderPath])

  const query = search.trim().toLowerCase()
  const shownLog = useMemo(
    () =>
      query || onlyProblems
        ? log.filter((l) => (!onlyProblems || /l-(error|warn)/.test(lineClass(l) ?? '')) && (!query || l.toLowerCase().includes(query)))
        : log,
    [log, query, onlyProblems]
  )
  const suggestions = sugHidden ? [] : suggest(command, players)
  const usage = usageOf(command)

  // 콘솔 탭에서 Ctrl+F를 누르면 로그 검색 칸으로 간다
  useEffect(() => {
    if (tab !== 'console') return
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && searchRef.current) {
        e.preventDefault()
        searchRef.current.focus()
        searchRef.current.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tab])

  // 맨 아래를 보고 있을 때만 새 줄을 따라 내려간다 (위로 올려 읽는 중이면 그대로)
  const jumpOnce = useRef(true) // 서버를 열거나 탭을 바꾼 직후에는 따라가기와 상관없이 맨 아래(최신 로그)를 보여 준다
  useLayoutEffect(() => {
    jumpOnce.current = true // 아래 스크롤 계산보다 먼저 돌아야 해서 layout effect로 둔다
  }, [folderPath, tab])
  useLayoutEffect(() => {
    const el = consoleRef.current
    if (!el) return
    if (jumpOnce.current || (follow && stickToBottom.current)) el.scrollTop = el.scrollHeight
    if (log.length) jumpOnce.current = false
  }, [log, tab, follow])

  const scrollToBottom = (): void => {
    const el = consoleRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    stickToBottom.current = true
    setAtBottom(true)
  }

  // 켜기 전 점검: 서버에 맞지 않는 모드가 새로 있으면 끌지 묻는 창을 띄우고 멈춘다.
  // 빠진 필수 모드·메모리 부족이 있으면 확인 창을 띄운다. 아무것도 없으면 바로 켠다
  const startBusy = useRef(false) // 점검·켜는 중 (버튼 말고 우클릭 메뉴로도 두 번 켜지지 않게)
  // skipAskOff: 끌지 묻는 창에서 "나중에"를 골랐으면 이번에는 묻지 않고 켠다
  async function start(skipAskOff = false) {
    if (startBusy.current) return
    setError('')
    if (!server.eulaAccepted) return setShowEula(true)
    startBusy.current = true
    setChecking(true)
    let result: PreflightResult | null = null
    try {
      await flushPendingRemovals() // 되돌리기를 기다리던 지우기를 먼저 끝낸다
      result = await window.api.preflight(folderPath)
    } catch {
      result = null // 점검이 안 되면 그냥 켠다
    } finally {
      setChecking(false)
      startBusy.current = false
    }
    if (result?.askOff && !skipAskOff) {
      resumeStart.current = true
      return checkOffSuggestions()
    }
    if (result && (result.missing.length || result.duplicates.length || result.memory) && readStored(`preflightOk:${folderPath}`, '') !== preflightKey(result)) return setPreflight(result)
    await launch()
  }

  async function launch() {
    if (startBusy.current) return
    startBusy.current = true
    if (preflight) writeStored(`preflightOk:${folderPath}`, preflightKey(preflight)) // "그래도 켜기": 같은 내용이면 다음엔 묻지 않는다
    setPreflight(null)
    setStarting(true)
    setTab('console')
    const off = window.api.onProgress((p) => p.folderPath === folderPath && setProgress(p)) // 다른 서버의 진행 상황은 무시
    try {
      await window.api.startServer(folderPath)
    } catch (e) {
      setError(cleanError(e))
    } finally {
      off()
      setProgress(null)
      setStarting(false)
      startBusy.current = false
      onChanged()
    }
  }

  async function confirmDelete() {
    setAskDelete(false)
    try {
      await window.api.deleteServer(folderPath)
      try {
        localStorage.removeItem(`tab:${folderPath}`)
        localStorage.removeItem(`preflightOk:${folderPath}`)
      } catch {
        // 못 지워도 해는 없다
      }
      toast(`${server.name} 서버를 휴지통으로 옮겼어요`)
      onDeleted()
    } catch (e) {
      toast(cleanError(e), 'error')
    }
  }

  async function acceptAndStart() {
    setShowEula(false)
    await window.api.acceptEula(folderPath)
    server.eulaAccepted = true // 목록 새로고침 전에 바로 시작할 수 있도록
    await start()
  }

  async function submitCommand(e: React.FormEvent) {
    e.preventDefault()
    if (!command.trim()) return
    try {
      await window.api.sendCommand(folderPath, command)
      setHistory((h) => [command, ...h.filter((x) => x !== command)].slice(0, 50))
      setHistoryIndex(-1)
      setCommand('')
      stickToBottom.current = true
    } catch (err) {
      toast(cleanError(err), 'error')
    }
  }

  // Tab: 자동완성 / ↑↓: 추천이 있으면 고르기, 없으면 이전에 친 명령어 불러오기
  function onCommandKey(e: React.KeyboardEvent) {
    if (suggestions.length && (e.key === 'Tab' || e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Escape')) {
      e.preventDefault()
      if (e.key === 'Escape') return setSugHidden(true)
      if (e.key === 'Tab') {
        setCommand(suggestions[Math.min(sugIndex, suggestions.length - 1)].text)
        setSugIndex(0)
        return
      }
      const n = suggestions.length
      setSugIndex((i) => (e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n))
      return
    }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    const next = e.key === 'ArrowUp' ? Math.min(historyIndex + 1, history.length - 1) : Math.max(historyIndex - 1, -1)
    setHistoryIndex(next)
    setCommand(next === -1 ? '' : history[next])
  }

  const on = state !== 'stopped'

  // 접속한 사람이 있으면 한 번 묻고 끈다
  function stop(sure = false) {
    if (!sure && players.length > 0) return setAskStop(true)
    setAskStop(false)
    window.api.stopServer(folderPath)
  }
  const busy = busyOf(folderPath) // 버전 바꾸기 같은 작업 중이면 그 이름

  // 우클릭 메뉴에서 온 요청
  const handled = useRef(0)
  useEffect(() => {
    if (!request || request.n === handled.current) return
    handled.current = request.n
    onRequestDone?.() // 한 번만 실행되게 비운다 (다시 이 서버를 열 때 또 실행되지 않게)
    if (request.action === 'start' && !on) start()
    if (request.action === 'stop' && on) stop()
    if (request.action === 'settings') setShowSettings(true)
    if (request.action === 'rename') setNaming('rename')
    if (request.action === 'duplicate' && !on) setNaming('duplicate')
    if (request.action === 'delete' && !on) setAskDelete(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request])

  return (
    <div className="server">
      <header className="server-head">
        <SoftwareBadge software={software} size={52} name={server.name} icon={server.icon} />
        <div className="title">
          <h1 className="editable" onClick={() => setNaming('rename')} title="눌러서 이름 바꾸기">
            <span className="n">{server.name}</span>
            <Pencil size={16} className="edit-icon" />
          </h1>
          <div className="subline">
            <span className={`pill ${state}`}>
              <span className={`dot ${state}`} />
              {STATE_LABEL[state]}
            </span>
            <span>
              {SOFTWARE_INFO[software].label} {server.mcVersion}
              {server.loaderVersion ? ` · ${server.loaderVersion}` : ''}
            </span>
            <InviteBox folderPath={folderPath} />
          </div>
        </div>
        <div className="head-actions">
          <button className="btn icon ghost" onClick={() => setShowSettings(true)} title="서버 설정">
            <Settings size={19} />
          </button>
          <button
            className="btn icon ghost"
            onClick={() => setNaming('duplicate')}
            disabled={on || starting || !!busy}
            title={busy ? `${busy} 중이라 복제할 수 없어요` : on || starting ? '서버를 끈 다음에 복제할 수 있어요' : '서버 복제'}
          >
            <CopyPlus size={19} />
          </button>
          <button className="btn icon ghost" onClick={() => window.api.openFolder(folderPath)} title="서버 폴더 열기">
            <FolderOpen size={19} />
          </button>
          <button
            className="btn icon ghost"
            onClick={() => setAskDelete(true)}
            disabled={on || starting || !!busy}
            title={busy ? `${busy} 중이라 삭제할 수 없어요` : on || starting ? '서버를 끈 다음에 삭제할 수 있어요' : '서버 삭제'}
          >
            <Trash2 size={19} />
          </button>
          {state === 'stopping' && (
            <button className="btn danger" onClick={() => window.api.stopServer(folderPath, true)} title="저장하지 않고 바로 꺼요">
              <Zap size={16} />
              강제 종료
            </button>
          )}
          {on ? (
            <button className="btn lg" onClick={() => stop()} disabled={state === 'stopping'}>
              <Square size={16} fill="currentColor" />
              {state === 'stopping' ? '끄는 중…' : '서버 끄기'}
            </button>
          ) : (
            <button className="btn primary lg" onClick={() => start()} disabled={starting || checking || !!busy} title={busy ? `${busy} 중이에요. 끝나면 켤 수 있어요` : undefined}>
              {starting || checking || busy ? <span className="spinner" /> : <Play size={17} fill="currentColor" />}
              {checking ? '점검 중…' : starting ? '준비 중…' : busy ? `${busy} 중…` : '서버 켜기'}
            </button>
          )}
        </div>
      </header>

      {starting && progress && <ProgressView progress={progress} />}
      {/* 자바가 실행된 뒤 다 켜질 때까지: 로그로 단계를 짐작해 보여 준다 */}
      {!starting && state === 'starting' && <BootProgress log={log} />}
      {error && <p className="error-text">{error}</p>}

      <StatsBar folderPath={folderPath} on={on} />

      <nav className="tabs">
        <button className={tab === 'console' ? 'active' : ''} onClick={() => setTab('console')}>
          콘솔
        </button>
        <button className={tab === 'manage' ? 'active' : ''} onClick={() => setTab('manage')}>
          관리
        </button>
        {modKind && (
          <button className={tab === 'mods' ? 'active' : ''} onClick={() => setTab('mods')}>
            {modKind.kind}
          </button>
        )}
        <button className={tab === 'datapacks' ? 'active' : ''} onClick={() => setTab('datapacks')}>
          데이터팩
        </button>
        <button className={tab === 'backup' ? 'active' : ''} onClick={() => setTab('backup')}>
          백업
        </button>
        <button className={tab === 'files' ? 'active' : ''} onClick={() => setTab('files')}>
          설정 파일
        </button>
      </nav>

      {tab === 'datapacks' ? (
        <DatapacksTab folderPath={folderPath} serverOn={on} />
      ) : tab === 'backup' ? (
        <BackupTab folderPath={folderPath} serverOn={on} />
      ) : tab === 'files' ? (
        <FilesTab folderPath={folderPath} serverOn={on} />
      ) : tab === 'manage' ? (
        <ManageTab folderPath={folderPath} running={state === 'running'} />
      ) : tab === 'mods' && modKind ? (
        <ModsTab folderPath={folderPath} kind={modKind} serverOn={on} />
      ) : (
        <div className="console-card">
          {log.length > 0 && (
            <div className="console-tools">
              <div className="console-search">
                <Search size={14} />
                <input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="로그 검색 (Ctrl+F)" />
                {search && (
                  <button onClick={() => setSearch('')} aria-label="검색 지우기">
                    <X size={14} />
                  </button>
                )}
              </div>
              <button className={`console-chip ${onlyProblems ? 'on' : ''}`} onClick={() => setOnlyProblems((v) => !v)}>
                경고·오류만
              </button>
              <button
                className={`console-chip ${follow ? 'on' : ''}`}
                onClick={() => {
                  setFollow(!follow)
                  if (!follow) scrollToBottom()
                }}
                title="새 로그가 나오면 맨 아래로 따라 내려가요"
              >
                아래로 따라가기
              </button>
              {(query || onlyProblems) && <span className="hint">{shownLog.length}줄</span>}
            </div>
          )}
          {log.length ? (
            <pre
              className="console"
              ref={consoleRef}
              onScroll={(e) => {
                const el = e.currentTarget
                stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30
                if (stickToBottom.current !== atBottom) setAtBottom(stickToBottom.current)
              }}
            >
              <ConsoleLines log={shownLog} query={query} />
            </pre>
          ) : null}
          {log.length > 0 && !atBottom && (
            <button className="console-jump" onClick={scrollToBottom}>
              <ArrowDown size={14} />
              맨 아래로
            </button>
          )}
          {log.length ? null : (
            // 한 번도 켜지 않은 서버(남은 로그가 없음)에는 시작 안내를 보여 준다
            <FirstRunGuide software={software} onStart={() => start()} startDisabled={starting || checking || !!busy} busyText={checking ? '점검 중…' : starting ? '준비 중…' : undefined} />
          )}
          <form className="command" onSubmit={submitCommand}>
            {on && (suggestions.length > 0 || usage) && (
              <div className="suggest">
                {suggestions.length ? (
                  suggestions.map((sg, i) => (
                    <button
                      type="button"
                      key={sg.text}
                      className={i === Math.min(sugIndex, suggestions.length - 1) ? 'active' : ''}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setCommand(sg.text)
                        setSugIndex(0)
                      }}
                    >
                      <span className="sg-label">{sg.label}</span>
                      <span className="sg-desc">{sg.desc}</span>
                    </button>
                  ))
                ) : (
                  <div className="sg-usage">{usage}</div>
                )}
                {suggestions.length > 0 && <div className="sg-foot">Tab으로 고르기 · ↑↓ 이동 · Esc 닫기</div>}
              </div>
            )}
            <input
              className="input"
              value={command}
              onChange={(e) => {
                setCommand(e.target.value)
                setSugIndex(0)
                setSugHidden(false)
              }}
              onKeyDown={onCommandKey}
              placeholder={on ? '명령어를 입력해 주세요 (예: say 안녕, op 닉네임, list)' : '서버가 켜져 있을 때 명령어를 쓸 수 있어요'}
              disabled={!on}
            />
            <button type="submit" className="btn primary icon" style={{ height: 42, width: 42 }} disabled={!on || !command.trim()} aria-label="보내기">
              <Send size={17} />
            </button>
          </form>
        </div>
      )}

      {showSettings && <SettingsDialog folderPath={folderPath} serverOn={on} mcVersion={server.mcVersion} software={software} loaderVersion={server.loaderVersion} onVersionChanged={onChanged} onClose={() => setShowSettings(false)} />}
      {modKind?.kind === '모드' && (
        <OffSuggestDialog
          folderPath={folderPath}
          serverOn={on}
          onAnswered={() => {
            if (!resumeStart.current) return
            resumeStart.current = false
            void start()
          }}
          onLater={() => {
            if (!resumeStart.current) return
            resumeStart.current = false
            void start(true)
          }}
        />
      )}
      {preflight && (
        <PreflightDialog
          result={preflight}
          onStart={launch}
          onCancel={() => setPreflight(null)}
          onFind={(id) => {
            setPreflight(null)
            setTab('mods')
            // 모드 탭이 이미 열려 있으면 이벤트로, 새로 열리면 저장해 둔 값으로 검색한다
            sessionStorage.setItem('modsSearch', id)
            window.dispatchEvent(new Event('mods-search'))
          }}
        />
      )}
      {showEula && <EulaDialog onAccept={acceptAndStart} onCancel={() => setShowEula(false)} />}
      {naming && (
        <NameDialog
          title={naming === 'rename' ? '서버 이름 바꾸기' : '서버 복제'}
          body={naming === 'rename' ? '앱에 보이는 이름만 바뀌어요.' : '월드, 모드, 설정을 모두 복사해서 새 서버를 만들어요.'}
          initial={naming === 'rename' ? server.name : `${server.name} 복사본`}
          confirmText={naming === 'rename' ? '바꾸기' : '복제하기'}
          onCancel={() => setNaming(null)}
          onConfirm={async (name) => {
            if (naming === 'rename') await window.api.renameServer(folderPath, name)
            else await runJob(folderPath, '서버 복제', `${name} 서버를 만들었어요`, () => window.api.duplicateServer(folderPath, name))
            toast(naming === 'rename' ? '이름을 바꿨어요' : `${name} 서버를 만들었어요`)
            setNaming(null)
            onChanged()
          }}
        />
      )}
      {askStop && (
        <Confirm
          title={`${players.length}명이 접속해 있어요`}
          body="서버를 끄면 모두 나가져요. 월드는 저장하고 꺼요."
          confirmText="서버 끄기"
          danger
          onCancel={() => setAskStop(false)}
          onConfirm={() => stop(true)}
        />
      )}
      {askDelete && (
        <Confirm
          title={`${server.name} 서버를 삭제할까요?`}
          body="월드, 설정, 모드가 모두 휴지통으로 옮겨져요. 필요하면 휴지통에서 되살릴 수 있어요."
          confirmText="삭제하기"
          danger
          onCancel={() => setAskDelete(false)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  )
}

function NameDialog(props: {
  title: string
  body: string
  initial: string
  confirmText: string
  onCancel: () => void
  onConfirm: (name: string) => Promise<void>
}) {
  const [name, setName] = useState(props.initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      await props.onConfirm(name.trim())
    } catch (err) {
      setError(cleanError(err))
      setBusy(false)
    }
  }
  return (
    <Modal onClose={busy ? undefined : props.onCancel}>
      <form onSubmit={submit}>
        <h2>{props.title}</h2>
        <div className="body">{props.body}</div>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="서버 이름" autoFocus onFocus={(e) => e.target.select()} />
        {!name.trim() && <p className="error-text">서버 이름을 입력해 주세요.</p>}
        {error && <p className="error-text">{error}</p>}
        <div className="actions">
          <button type="button" className="btn" onClick={props.onCancel} disabled={busy}>
            취소
          </button>
          <button type="submit" className="btn primary" disabled={busy || !name.trim()}>
            {busy && <span className="spinner" />}
            {props.confirmText}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function BootProgress({ log }: { log: string[] }) {
  const { message, percent } = bootStage(log)
  const [since] = useState(() => Date.now())
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const sec = Math.floor((Date.now() - since) / 1000)
  return (
    <div className="progress-card">
      <div className="row">
        <span className="spinner" />
        {message}
        <span className="hint" style={{ marginLeft: 'auto' }}>
          {sec < 60 ? `${sec}초` : `${Math.floor(sec / 60)}분 ${sec % 60}초`}째
        </span>
      </div>
      <div className="bar">
        <i style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}
