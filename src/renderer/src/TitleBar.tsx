import { Copy, Download, Minus, Settings, Square, WifiOff, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import AppSettingsDialog from './AppSettingsDialog'
import BugReportDialog from './BugReportDialog'
import type { SiteStatus, UpdateState } from '../../shared-types'
import { Confirm, useToast } from './ui'
import { cleanError } from './util'
import { useEffect, useState } from 'react'
import { TaskButton } from './tasks'

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
      <button className="bug-btn" onClick={() => setShowBug(true)} onDoubleClick={(e) => e.stopPropagation()}>
        버그 제보
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
