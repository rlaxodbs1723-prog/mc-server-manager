import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Account } from '../../shared-types'
import DiscordLogo from './DiscordLogo'
import { Confirm, Loading, Modal, useToast } from './ui'
import { cleanError } from './util'

// 로그인한 계정 (로그인·로그아웃하면 바로 바뀐다). undefined = 아직 모름
export function useAccount(): Account | null | undefined {
  const [account, setAccount] = useState<Account | null | undefined>(undefined)
  useEffect(() => {
    const load = (): void => void window.api.getAccount().then(setAccount)
    load()
    return window.api.onServerEvent((e) => e.type === 'account' && load())
  }, [])
  return account
}

const LABEL: Record<string, string> = { discord: 'Discord', google: 'Google', dev: '시험 계정' }

function GoogleLogo() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" style={{ marginRight: 5, verticalAlign: -2, flexShrink: 0 }}>
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.7V6.6h-4a12 12 0 0 0 0 10.8l4-3z" />
      <path fill="#EA4335" d="M12 4.8c1.7 0 3.3.6 4.5 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1c.9-2.8 3.5-4.9 6.6-4.9z" />
    </svg>
  )
}

// 서버 공유 창을 열기 전에 로그인을 확인한다. 로그인돼 있으면 바로 children을, 아니면 로그인 안내 창을 보여 준다 (로그인하면 닫힌다)
// plain: 기능 안내 없이 그냥 "로그인" 창 (왼쪽 아래 프로필에서 열 때)
export default function LoginGate({ children, onClose, plain }: { children: ReactNode; onClose: () => void; plain?: boolean }) {
  const account = useAccount()
  // 창을 열 때 로그인 안 돼 있었으면, 로그인한 뒤에는 원래 창(공유 창 등)으로 넘어가지 않고 그냥 닫는다
  const [askedLogin, setAskedLogin] = useState(false)
  useEffect(() => {
    if (account === null) setAskedLogin(true)
    else if (account && askedLogin) onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account])
  if (account === undefined) return null
  if (account) return askedLogin ? null : <>{children}</>
  // 화면 맨 위에 띄운다 (왼쪽 목록 안에서 열어도 다른 칸에 가려지지 않게)
  return createPortal(<LoginDialog onClose={onClose} plain={plain} />, document.body)
}

function LoginDialog({ onClose, plain }: { onClose: () => void; plain?: boolean }) {
  const toast = useToast()
  const [providers, setProviders] = useState<string[] | null>(null)
  const [waiting, setWaiting] = useState('')

  useEffect(() => {
    window.api
      .loginProviders()
      .then(setProviders)
      .catch((e) => {
        toast(cleanError(e), 'error')
        setProviders([])
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function login(p: string): Promise<void> {
    setWaiting(p)
    try {
      const a = await window.api.login(p)
      toast(`${a.name}(으)로 로그인했어요`, 'success')
      // 로그인되면 LoginGate가 원래 창으로 바꿔 준다
    } catch (e) {
      const msg = cleanError(e)
      if (!/취소/.test(msg)) toast(msg, 'error')
      setWaiting('')
    }
  }

  function cancel(): void {
    if (waiting) void window.api.cancelLogin()
    onClose()
  }

  return (
    <Modal onClose={cancel}>
      <h2>{plain ? '로그인' : '서버 공유는 로그인이 필요해요'}</h2>
      {waiting ? (
        <>
          <p className="body">{`브라우저에서 ${LABEL[waiting] ?? waiting} 로그인을 마쳐 주세요. 끝나면 자동으로 이어져요.`}</p>
          <Loading />
        </>
      ) : (
        <>
          {!plain && <p className="body">친구와 서버를 주고받으려면 로그인해 주세요. 공유하는 사람과 들어오는 사람을 확인하는 데만 써요. 비밀번호는 CubePanel이 받지 않아요.</p>}
          {providers === null ? (
            <Loading />
          ) : providers.length === 0 ? (
            <p className="body">지금은 로그인할 수 없어요. 잠시 뒤에 다시 시도해 주세요.</p>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {providers.map((p) => (
                <button key={p} className="btn lg" onClick={() => void login(p)}>
                  {p === 'discord' ? <DiscordLogo /> : p === 'google' ? <GoogleLogo /> : null}
                  {`${LABEL[p] ?? p}(으)로 로그인`}
                </button>
              ))}
            </div>
          )}
          <p className="hint" style={{ marginTop: 12 }}>
            로그인하면 개인정보 처리방침에 동의하는 것으로 봐요. 만 14세 미만은 보호자의 동의를 받아 주세요.{' '}
            <a href="#" onClick={(e) => (e.preventDefault(), void window.api.openExternal('https://cubepanel.kr/privacy'))}>
              처리방침 보기
            </a>
          </p>
        </>
      )}
      <div className="actions">
        <button className="btn" onClick={cancel}>
          {waiting ? '로그인 취소' : '나중에'}
        </button>
      </div>
    </Modal>
  )
}

// 왼쪽 아래 프로필 칸: 로그인한 계정 (누르면 로그아웃·계정 지우기), 로그인 전이면 로그인 버튼
export function ProfileBox() {
  const toast = useToast()
  const account = useAccount()
  const [menu, setMenu] = useState(false)
  const [login, setLogin] = useState(false)
  const [ask, setAsk] = useState(false)
  const [busy, setBusy] = useState(false)
  const [noPic, setNoPic] = useState(false) // 사진을 못 불러오면 이름 첫 글자

  // 로그인되면 로그인 창을 닫는다
  useEffect(() => {
    if (account) setLogin(false)
  }, [account])
  // 메뉴 바깥을 누르면 닫는다
  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menu])

  async function run(job: () => Promise<void>, done: string): Promise<void> {
    setBusy(true)
    try {
      await job()
      toast(done)
    } catch (e) {
      toast(cleanError(e), 'error')
    } finally {
      setBusy(false)
      setAsk(false)
      setMenu(false)
    }
  }

  if (account === undefined) return null
  return (
    <div className="profile-box">
      {account ? (
        <button className="profile" onClick={() => setMenu(!menu)} onMouseDown={(e) => e.stopPropagation()}>
          {account.avatar && !noPic ? (
            <img className="profile-avatar" src={account.avatar} alt="" referrerPolicy="no-referrer" onError={() => setNoPic(true)} />
          ) : (
            <span className="profile-avatar">{[...account.name][0]?.toUpperCase()}</span>
          )}
          <span className="profile-text">
            <b>{account.name}</b>
            <span className="hint">
              {account.provider === 'discord' ? <DiscordLogo /> : account.provider === 'google' ? <GoogleLogo /> : null}
              {LABEL[account.provider] ?? account.provider}
            </span>
          </span>
        </button>
      ) : (
        <button className="profile" onClick={() => setLogin(true)}>
          <span className="profile-avatar no-login">?</span>
          <span className="profile-text">
            <b>로그인</b>
          </span>
        </button>
      )}
      {menu && account && (
        <div className="profile-menu" onMouseDown={(e) => e.stopPropagation()}>
          <button disabled={busy} onClick={() => void run(() => window.api.logout(), '로그아웃했어요')}>
            로그아웃
          </button>
          <button className="danger" disabled={busy} onClick={() => setAsk(true)}>
            계정 지우기
          </button>
        </div>
      )}
      {login && (
        <LoginGate plain onClose={() => setLogin(false)}>
          <></>
        </LoginGate>
      )}
      {ask && (
        <Confirm
          title="계정을 지울까요?"
          body="저장된 계정 정보와 모든 기기의 로그인이 바로 지워져요. 되돌릴 수 없어요. 내 서버와 파일은 그대로예요."
          confirmText="지우기"
          danger
          onConfirm={() => void run(() => window.api.deleteAccount(), '계정을 지웠어요')}
          onCancel={() => setAsk(false)}
        />
      )}
    </div>
  )
}
