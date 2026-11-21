import { useEffect, useState } from 'react'
import type { DiscordHookView } from '../../shared-types'
import DiscordLogo from './DiscordLogo'
import { Modal, useToast } from './ui'
import { cleanError } from './util'

// 디스코드 알림: 바로 저장된다(저장하기 버튼과 따로). 웹후크 주소는 저장하면 화면에서 지우고 끝 네 글자만 보여 준다
export function DiscordRows({ folderPath }: { folderPath: string }) {
  const toast = useToast()
  const [view, setView] = useState<DiscordHookView | null>(null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.api.getDiscordHook(folderPath).then(setView)
  }, [folderPath])

  async function apply(patch: { url?: string; start?: boolean; stop?: boolean; join?: boolean; leave?: boolean }, done?: string) {
    setBusy(true)
    try {
      setView(await window.api.setDiscordHook(folderPath, patch))
      if (patch.url !== undefined) setUrl('')
      if (done) toast(done)
    } catch (e) {
      toast(cleanError(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  async function test() {
    setBusy(true)
    try {
      await window.api.testDiscordHook(folderPath)
      toast('디스코드로 테스트 메시지를 보냈어요')
    } catch (e) {
      toast(cleanError(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  if (!view) return null
  const kinds: { key: 'start' | 'stop' | 'join' | 'leave'; label: string }[] = [
    { key: 'start', label: '서버가 켜질 때' },
    { key: 'stop', label: '서버가 꺼지거나 튕길 때' },
    { key: 'join', label: '플레이어가 들어올 때' },
    { key: 'leave', label: '플레이어가 나갈 때' }
  ]
  return (
    <>
      <div className="setting-row" style={{ alignItems: 'flex-start' }}>
        <div className="setting-text">
          <div className="setting-label">디스코드 알림</div>
          <div className="setting-desc">
            서버가 켜지고 꺼질 때, 튕길 때, 플레이어가 들어오고 나갈 때 내 디스코드 채널에 알려 줘요. 디스코드에서 채널 설정 → 연동 → 웹후크 → 새 웹후크를 만들고 "웹후크 URL 복사"를 눌러 아래에 붙여 넣어요.
          </div>
          <div className="discord-hook">
            <input
              className="input"
              type="password"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={view.configured ? `연결됨 (…${view.tail}) · 바꾸려면 새 주소를 붙여 넣어요` : '웹후크 주소를 붙여 넣어요'}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
            />
            <button className="btn sm" disabled={busy || !url.trim()} onClick={() => apply({ url }, '디스코드 알림을 연결했어요')}>
              저장
            </button>
            {view.configured && (
              <>
                <button className="btn sm" disabled={busy} onClick={test}>
                  테스트
                </button>
                <button className="btn sm ghost" disabled={busy} onClick={() => apply({ url: '' }, '디스코드 알림을 껐어요')}>
                  해제
                </button>
              </>
            )}
          </div>
          {view.configured && (
            <div className="discord-kinds">
              {kinds.map((k) => (
                <label key={k.key} className="mp-check">
                  <input type="checkbox" checked={view[k.key]} disabled={busy} onChange={(e) => apply({ [k.key]: e.target.checked })} />
                  <span>{k.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// 서버 화면 위쪽의 디스코드 버튼을 누르면 뜨는 창 (설정 → 자동 탭 안의 같은 칸을 바로 열어 준다)
export function DiscordDialog({ folderPath, onClose }: { folderPath: string; onClose: () => void }) {
  return (
    <Modal onClose={onClose}>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <DiscordLogo size={22} bare />
        디스코드 알림
      </h2>
      <DiscordRows folderPath={folderPath} />
      <div className="actions">
        <button className="btn primary" onClick={onClose}>
          닫기
        </button>
      </div>
    </Modal>
  )
}
