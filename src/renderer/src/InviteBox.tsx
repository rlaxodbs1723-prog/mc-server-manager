import { AlertTriangle, Copy, Radar } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { InviteStatus } from '../../shared-types'
import { useToast } from './ui'
import { cleanError } from './util'

// 서버 이름 아래 줄에 접속 주소를 작게 보여 준다 (복사·접속 확인 버튼 포함)
export default function InviteBox({ folderPath }: { folderPath: string }) {
  const toast = useToast()
  const [invite, setInvite] = useState<InviteStatus>({ state: 'off' })
  const [checking, setChecking] = useState(false)

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
      <span className="invite-inline failed" title={`${invite.message}\n${lanHint}`}>
        <AlertTriangle size={14} />
        밖에서 접속할 수 없어요
      </span>
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
