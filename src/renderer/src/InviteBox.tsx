import { AlertTriangle, Copy, Radar } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { InviteStatus } from '../../shared-types'
import { Modal, useToast } from './ui'
import { cleanError } from './util'

// 서버 이름 아래 줄에 접속 주소를 작게 보여 준다 (복사·접속 확인 버튼 포함)
export default function InviteBox({ folderPath }: { folderPath: string }) {
  const toast = useToast()
  const [invite, setInvite] = useState<InviteStatus>({ state: 'off' })
  const [checking, setChecking] = useState(false)
  const [help, setHelp] = useState(false)

  useEffect(() => {
    window.api.getInvite(folderPath).then(setInvite)
    return window.api.onServerEvent((e) => {
      if (e.type === 'invite' && e.folderPath === folderPath) setInvite(e.invite)
    })
  }, [folderPath])

  async function check() {
    setChecking(true)
    try {
      const r = await window.api.checkReachable(folderPath)
      toast(r.message, r.ok ? 'success' : 'error')
    } catch (e) {
      toast(cleanError(e), 'error')
    } finally {
      setChecking(false)
    }
  }

  if (invite.state === 'off') return null
  const lanHint = invite.lan.length ? `같은 와이파이에서는 ${invite.lan.join(', ')} · 이 컴퓨터에서는 localhost` : '이 컴퓨터에서는 localhost'

  if (invite.state === 'failed')
    return (
      <>
        <button className="invite-inline failed" onClick={() => setHelp(true)} title="눌러서 원인과 해결법 보기">
          <AlertTriangle size={14} />
          밖에서 접속할 수 없어요
        </button>
        {help && <InviteHelp folderPath={folderPath} invite={invite} onClose={() => setHelp(false)} />}
      </>
    )
  if (invite.state === 'opening')
    return (
      <span className="invite-inline muted" title={lanHint}>
        <span className="spinner" />
        접속 주소 준비 중…
      </span>
    )

  return (
    <span className="invite-inline" title={`접속 주소\n${lanHint}`}>
      <b>{invite.address}</b>
      <button
        onClick={async () => {
          await window.api.copyText(invite.address)
          toast('주소를 복사했어요. 플레이어에게 보내 주세요!')
        }}
        title="주소 복사"
      >
        <Copy size={14} />
      </button>
      <button onClick={check} disabled={checking} title="밖에서 접속되는지 확인">
        {checking ? <span className="spinner" /> : <Radar size={14} />}
      </button>
    </span>
  )
}

// 빨간 "밖에서 접속할 수 없어요"를 누르면 뜨는 창: 원인과 해결법 (포트 포워딩, 또는 playit 터널)
function InviteHelp({
  folderPath,
  invite,
  onClose
}: {
  folderPath: string
  invite: Extract<InviteStatus, { state: 'failed' }>
  onClose: () => void
}) {
  const toast = useToast()
  const [linking, setLinking] = useState(false)

  async function tunnel() {
    setLinking(true)
    try {
      await window.api.useTunnel(folderPath)
      onClose()
    } catch (e) {
      toast(cleanError(e), 'error')
    } finally {
      setLinking(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <h2>밖에서 접속할 수 없어요</h2>
      <div className="invite-help">
        <h3>원인</h3>
        <p>{invite.message}</p>
        <h3>해결법</h3>
        <p>{`공유기에서 포트 포워딩을 직접 해 주세요. (포트 ${invite.port}, TCP)`}</p>
        <p>{'또는 playit.gg 터널로 열 수 있어요. 처음 한 번은 브라우저에서 playit 계정으로 승인해야 해요.'}</p>
        {linking && <p className="hint">{'브라우저에서 승인을 기다리고 있어요…'}</p>}
        {invite.lan.length > 0 && <p className="hint">{`같은 와이파이의 플레이어는 지금도 ${invite.lan.join(', ')}(으)로 접속할 수 있어요.`}</p>}
      </div>
      <div className="actions">
        <button className="btn primary" onClick={tunnel} disabled={linking}>
          {linking ? <span className="spinner" /> : null}
          터널로 열기
        </button>
        <button className="btn" onClick={onClose}>
          확인
        </button>
      </div>
    </Modal>
  )
}
