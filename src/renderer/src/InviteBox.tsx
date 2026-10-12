import { AlertTriangle, Copy, Info, Radar } from 'lucide-react'
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
      if (r.ok) toast(r.message, 'success')
      else setHelp(true) // 실패하면 빨간 표시로 바뀌고, 원인과 터널로 여는 법을 바로 보여 준다
    } catch (e) {
      toast(cleanError(e), 'error')
    } finally {
      setChecking(false)
    }
  }

  if (invite.state === 'off') return null
  // 서버 포트가 기본(25565)이 아니면 주소 뒤에 :포트를 붙여야 접속된다
  const port = 'port' in invite ? invite.port : 25565
  const suffix = port === 25565 ? '' : `:${port}`
  const localAddr = `localhost${suffix}`
  const lanHint = invite.lan.length ? `같은 와이파이에서는 ${invite.lan.map((ip) => ip + suffix).join(', ')} · 이 컴퓨터에서는 ${localAddr}` : `이 컴퓨터에서는 ${localAddr}`

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
      {/* 방장이 바깥 주소로 들어가면 공유기에 따라 타임아웃이 나서, 이 컴퓨터용 주소를 따로 보여 준다 */}
      <button
        className="invite-self"
        onClick={async () => {
          await window.api.copyText(localAddr)
          toast(`${localAddr}를 복사했어요. 이 컴퓨터에서 접속할 때 쓰세요!`)
        }}
        title={`이 컴퓨터에서 접속할 때는 이 주소를 쓰세요 (눌러서 복사) · ${lanHint}`}
      >
        내 접속: {localAddr}
      </button>
      <button
        onClick={() => toast(`이 컴퓨터에서 마인크래프트로 접속할 때는 바깥 주소 대신 "${localAddr}"를 입력하세요. 같은 와이파이의 다른 컴퓨터는 ${invite.lan.length ? invite.lan.map((ip) => ip + suffix).join(' 또는 ') : '이 컴퓨터의 내부 주소'}를 쓰고, 다른 곳의 친구는 위의 접속 주소를 쓰면 돼요.${suffix ? ' 서버 포트가 기본(25565)이 아니라서 :' + port + '까지 꼭 써야 해요.' : ''}`)}
        title="이 주소를 언제 쓰는지 알려 줘요"
      >
        <Info size={14} />
      </button>
      <button onClick={check} disabled={checking} title="밖에서 접속되는지 확인">
        {checking ? <span className="spinner" /> : <Radar size={14} />}
      </button>
    </span>
  )
}

// 빨간 "밖에서 접속할 수 없어요"를 누르면 뜨는 창: 원인과, playit 터널로 여는 순서
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
  const [claimUrl, setClaimUrl] = useState<string | null>(null)

  // 승인을 기다리는 동안 승인 페이지 주소를 화면에 보여 준다 (브라우저가 안 열릴 때 직접 열 수 있게)
  useEffect(() => {
    if (!linking) return setClaimUrl(null)
    const t = setInterval(() => window.api.getClaimUrl().then(setClaimUrl).catch(() => undefined), 1000)
    return () => clearInterval(t)
  }, [linking])

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
        <h3>해결법: 터널로 열기</h3>
        <ol className="invite-steps">
          <li>{'아래 "터널로 열기"를 눌러요.'}</li>
          <li>{'브라우저에 playit.gg가 열리면 로그인하거나 회원가입해요.'}</li>
          <li>{'"Claim Agent" 화면에서 승인 버튼을 눌러요.'}</li>
          <li>{'앱으로 돌아오면 접속 주소가 떠요. 다음부터는 알아서 열려요.'}</li>
        </ol>
        {linking && <p className="hint">{'브라우저에서 승인을 기다리고 있어요…'}</p>}
        {linking && claimUrl && (
          <>
            <p className="hint">{'브라우저가 안 열리면 아래 주소를 브라우저에 붙여 넣어 주세요.'}</p>
            <p className="hint" style={{ wordBreak: 'break-all', userSelect: 'text' }}>
              {claimUrl}
            </p>
            <div className="actions" style={{ justifyContent: 'flex-start' }}>
              <button className="btn sm" onClick={() => window.api.copyText(claimUrl).then(() => toast('주소를 복사했어요'))}>
                주소 복사
              </button>
              <button className="btn sm" onClick={() => window.api.openClaimPage()}>
                브라우저로 다시 열기
              </button>
            </div>
          </>
        )}
        {invite.lan.length > 0 && <p className="hint">{`같은 와이파이의 플레이어는 지금도 ${invite.lan.map((ip) => ip + (invite.port === 25565 ? '' : `:${invite.port}`)).join(', ')}(으)로 접속할 수 있어요.`}</p>}
        <p className="hint">이 컴퓨터에서는 지금도 {invite.port === 25565 ? 'localhost' : `localhost:${invite.port}`}로 접속할 수 있어요.</p>
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
