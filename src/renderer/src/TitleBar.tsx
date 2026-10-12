import { Copy, Download, Minus, Settings, Square, WifiOff, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import AppSettingsDialog from './AppSettingsDialog'
import BugReportDialog from './BugReportDialog'
import type { SiteStatus, UpdateState } from '../../shared-types'
import { Confirm, useToast } from './ui'
import { cleanError } from './util'
import { useEffect, useState } from 'react'
import { TaskButton } from './tasks'
import InboxButton from './Inbox'

// 디스코드 로고 (lucide에는 없어서 직접 그린다)
function DiscordLogo() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ marginRight: 5, verticalAlign: -2 }}>
      <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
    </svg>
  )
}

// 윈도우 기본 테두리 대신 쓰는 타이틀바. 빈 곳을 잡고 창을 옮길 수 있다.
export default function TitleBar() {
  const [maximized, setMaximized] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showBug, setShowBug] = useState(false)
  const [sites, setSites] = useState<SiteStatus>({ modrinth: true, curseforge: true })
  const toast = useToast()
  const [update, setUpdate] = useState<UpdateState>({ state: 'none' })
  const [askUpdate, setAskUpdate] = useState(false)
  const [running, setRunning] = useState(0) // 업데이트하면 꺼지는 서버 수 (확인 창에 보여 준다)
  useEffect(() => {
    window.api.getUpdate().then(setUpdate).catch(() => undefined)
    return window.api.onUpdate((u) => {
      // 버튼만 생기면 못 보고 지나치기 쉬워서, 준비된 순간에 한 번 알려 준다
      if (u.state === 'ready') toast(`새 버전 ${u.version}이 준비됐어요. 오른쪽 위 "업데이트"를 누르면 설치돼요.`)
      setUpdate(u)
    })
  }, [])
  useEffect(() => {
    window.api.getSiteStatus().then(setSites).catch(() => undefined)
    return window.api.onSiteStatus(setSites)
  }, [])
  // 응답하지 않는 사이트 (다시 되면 알아서 사라진다)
  const down = [!sites.modrinth && 'Modrinth', !sites.curseforge && 'CurseForge'].filter(Boolean).join(', ')

  useEffect(() => {
    window.api.isMaximized().then(setMaximized)
    return window.api.onWindowMaximized(setMaximized)
  }, [])

  return (
    <header className="titlebar" onDoubleClick={() => window.api.windowControl('maximize')}>
      <div className="brand">
        {/* 앱 아이콘과 같은 그림 (build-tools/icon.svg) */}
        <svg className="logo" viewBox="0 0 128 128" aria-hidden="true">
          <rect width="128" height="128" rx="28" fill="#1b1d23" />
          <rect x="24" y="30" width="80" height="30" rx="8" fill="#2d313a" />
          <circle cx="40" cy="45" r="6" fill="#35d07f" />
          <rect x="54" y="42" width="38" height="6" rx="3" fill="#5b6270" />
          <rect x="24" y="68" width="80" height="30" rx="8" fill="#2d313a" />
          <circle cx="40" cy="83" r="6" fill="#35d07f" />
          <rect x="54" y="80" width="28" height="6" rx="3" fill="#5b6270" />
        </svg>
        MC CubePanel
      </div>
      {down && (
        <span className="site-down" title="이 사이트가 지금 응답하지 않아요. 앱 문제가 아니라 사이트 문제라서 잠시 뒤에 알아서 다시 돼요. 그동안 검색·설치가 안 되거나 아이콘이 안 보일 수 있어요.">
          <WifiOff size={13} />
          {down} 연결 안 됨
        </span>
      )}
      {update.state === 'ready' && (
        <button
          className="update-btn"
          onDoubleClick={(e) => e.stopPropagation()}
          title={`새 버전 ${update.version}이 준비됐어요. 누르면 설치하고 앱을 다시 켜요. (그냥 앱을 꺼도 그때 설치돼요)`}
          onClick={() => {
            window.api
              .listServers()
              .then((list) => setRunning(list.filter((s) => s.state !== 'stopped').length))
              .catch(() => setRunning(0))
              .finally(() => setAskUpdate(true))
          }}
        >
          <Download size={14} />
          업데이트
        </button>
      )}
      {askUpdate &&
        createPortal(
          <div onDoubleClick={(e) => e.stopPropagation()}>
            <Confirm
              title={`새 버전 ${update.state === 'ready' ? update.version : ''}으로 업데이트할까요?`}
              body={running ? `켜져 있는 서버 ${running}개는 월드를 저장하고 꺼요. 업데이트가 끝나면 앱이 다시 켜져요.` : '설치가 끝나면 앱이 다시 켜져요. 몇 초면 돼요.'}
              confirmText={running ? '서버 끄고 업데이트' : '업데이트'}
              onCancel={() => setAskUpdate(false)}
              onConfirm={() => {
                setAskUpdate(false)
                window.api.installUpdate().catch((e) => toast(cleanError(e), 'error'))
              }}
            />
          </div>,
          document.body
        )}
      <TaskButton />
      <InboxButton />
      <button className="bug-btn" onClick={() => window.api.openExternal('https://discord.gg/Z6EdhRP9Ep')} onDoubleClick={(e) => e.stopPropagation()} title="디스코드 서버에서 질문하고, 새 소식을 받아 보세요">
        <DiscordLogo />
        디스코드
      </button>
      <button className="bug-btn" onClick={() => setShowBug(true)} onDoubleClick={(e) => e.stopPropagation()}>
        문의/버그 제보
      </button>
      {showBug &&
        createPortal(
          <div onDoubleClick={(e) => e.stopPropagation()}>
            <BugReportDialog onClose={() => setShowBug(false)} />
          </div>,
          document.body
        )}
      <button className="task-btn app-settings-btn" onClick={() => setShowSettings(true)} title="앱 설정" onDoubleClick={(e) => e.stopPropagation()}>
        <Settings size={16} />
      </button>
      {/* 타이틀바는 "잡고 끌면 창이 움직이는" 영역이라, 그 안에 창을 띄우면 클릭이 안 먹는다. 화면 맨 바깥에 띄운다 */}
      {/* 화면 바깥에 띄워도 React 이벤트는 타이틀바로 올라온다. 더블클릭이 "창 최대화"로 가지 않게 여기서 멈춘다 */}
      {showSettings &&
        createPortal(
          <div onDoubleClick={(e) => e.stopPropagation()}>
            <AppSettingsDialog onClose={() => setShowSettings(false)} />
          </div>,
          document.body
        )}
      <div className="win-buttons" onDoubleClick={(e) => e.stopPropagation()}>
        <button onClick={() => window.api.windowControl('minimize')} aria-label="최소화">
          <Minus size={16} />
        </button>
        <button onClick={() => window.api.windowControl('maximize')} aria-label={maximized ? '이전 크기로' : '최대화'}>
          {maximized ? <Copy size={13} style={{ transform: 'scaleX(-1)' }} /> : <Square size={13} />}
        </button>
        <button className="close" onClick={() => window.api.windowControl('close')} aria-label="닫기">
          <X size={17} />
        </button>
      </div>
    </header>
  )
}
