import { Box, Copy, Minus, Settings, Square, WifiOff, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import AppSettingsDialog from './AppSettingsDialog'
import type { SiteStatus } from '../../shared-types'
import { useEffect, useState } from 'react'
import { TaskButton } from './tasks'

// 윈도우 기본 테두리 대신 쓰는 타이틀바. 빈 곳을 잡고 창을 옮길 수 있다.
export default function TitleBar() {
  const [maximized, setMaximized] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [sites, setSites] = useState<SiteStatus>({ modrinth: true, curseforge: true })
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
        <span className="logo">
          <Box size={13} strokeWidth={2.5} />
        </span>
        CraftPanel
      </div>
      {down && (
        <span className="site-down" title="이 사이트가 지금 응답하지 않아요. 앱 문제가 아니라 사이트 문제라서 잠시 뒤에 알아서 다시 돼요. 그동안 검색·설치가 안 되거나 아이콘이 안 보일 수 있어요.">
          <WifiOff size={13} />
          {down} 연결 안 됨
        </span>
      )}
      <TaskButton />
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
