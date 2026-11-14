import { Copy, KeyRound, Link2, Share2, Trash2, X, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ShareDevice, SharePerm } from '../../shared-types'
import { useLeaveAnimation } from './leave'
import { PERM_INFO } from './perms'
import { Confirm, Loading, useToast } from './ui'
import { cleanError } from './util'

// 서버 공유 (방장): 넓은 설정 창.
//   공유: 초대 코드 만들기·복사, 공유받은 친구 목록, 공유 끄기
//   권한: 친구 한 명이나 전체를 골라 할 수 있는 일을 정한다 (새로 들어온 친구는 보기만으로 시작)
// 서버는 늘 이 컴퓨터에서 돈다. 친구는 자기 CubePanel에서 이 서버를 보고, 받은 권한만큼 다룬다

type Tab = '공유' | '권한'
const NONE = '' // 권한 탭에서 아직 아무도 안 고름
const ALL = '*' // 전체

// 권한을 묶어서 보여 준다
const PERM_GROUPS: { title: string; perms: SharePerm[] }[] = [
  { title: '서버', perms: ['start', 'stop', 'console'] },
  { title: '플레이어', perms: ['announce', 'players', 'whitelist', 'welcome'] },
  { title: '게임', perms: ['difficulty', 'gamemodeAll', 'timeWeather'] },
  { title: '월드·기록', perms: ['world', 'chat', 'backup'] }
]
const ORDER = PERM_GROUPS.flatMap((g) => g.perms)

export default function ShareDialog({ folderPath, onClose }: { folderPath: string; onClose: () => void }) {
  const toast = useToast()
  const leaveRef = useRef<HTMLDivElement>(null)
  useLeaveAnimation(leaveRef)
  const [tab, setTab] = useState<Tab>('공유')
  const [status, setStatus] = useState<{ sharing: boolean; online: boolean } | null>(null)
  const [devices, setDevices] = useState<ShareDevice[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [askStop, setAskStop] = useState(false)
  const [askRevoke, setAskRevoke] = useState<ShareDevice | null>(null)
  const [code, setCode] = useState('')
  // 권한 탭에서 고른 대상: NONE(아직 안 고름) · ALL(전체) · 친구 기기 id
  const [target, setTarget] = useState(ALL) // 처음엔 전체

  const load = async (): Promise<void> => {
    const s = await window.api.shareStatus(folderPath)
    setStatus(s)
    if (s.sharing && s.online) setDevices(await window.api.shareDevices(folderPath).catch(() => null))
  }
  useEffect(() => {
    void load().catch((e) => toast(cleanError(e), 'error'))
    // 방에 붙는 데 1~2초 걸리고, 친구가 들어오고 나가는 것도 보여 주려고 자주 다시 본다
    const t = setInterval(() => void load().catch(() => undefined), 3000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderPath])

  async function run(job: () => Promise<unknown>): Promise<void> {
    setBusy(true)
    try {
      await job()
      await load()
    } catch (e) {
      toast(cleanError(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function makeCode(): Promise<void> {
    setBusy(true)
    try {
      const c = await window.api.createShareInvite(folderPath, [])
      setCode(c)
      await window.api.copyText(c).catch(() => undefined)
      toast('초대 코드를 복사했어요. 친구에게 보내 주세요!', 'success')
    } catch (e) {
      toast(cleanError(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  // Esc로 닫기 (위에 확인 창이 떠 있으면 그 창이 먼저 받는다)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const tabs: { title: Tab; icon: LucideIcon }[] = [
    { title: '공유', icon: Share2 },
    { title: '권한', icon: KeyRound }
  ]
  const sharing = !!status?.sharing
  const online = !!status?.online
  const picked = devices?.find((d) => d.id === target) ?? null
  const all = target === ALL && !!devices?.length
  // 전체: 모든 친구가 가진 권한만 켜진 것으로 보인다
  const shownPerms: SharePerm[] = picked ? picked.perms : all ? ORDER.filter((p) => devices!.every((d) => d.perms.includes(p))) : []
  // 전체에서 하나를 켜거나 끄면 친구마다 그 하나만 바꾼다 (나머지 권한은 그대로)
  // 권한 바꾸기: 화면은 바로 바꾸고, 저장은 뒤에서 (실패하면 알리고 다시 읽는다)
  function applyPerms(changes: { id: string; perms: SharePerm[] }[]): void {
    setDevices((cur) =>
      cur?.map((d) => {
        const c = changes.find((x) => x.id === d.id)
        return c ? { ...d, perms: c.perms } : d
      }) ?? cur
    )
    void Promise.all(changes.map((c) => window.api.setSharePerms(folderPath, c.id, c.perms))).catch((e) => {
      toast(cleanError(e), 'error')
      void load().catch(() => undefined)
    })
  }
  function setForAll(perm: SharePerm, on: boolean): void {
    applyPerms(
      (devices ?? []).map((d) => {
        const p = on ? [...d.perms, perm] : d.perms.filter((x) => x !== perm)
        return { id: d.id, perms: ORDER.filter((x) => p.includes(x)) }
      })
    )
  }

  let content: React.ReactNode
  if (!status) content = <Loading />
  else if (!sharing)
    content = (
      <div className="share-start">
        <p className="body">친구 CubePanel에서도 이 서버를 보고, 정해 준 만큼 다룰 수 있게 해요.</p>
        <ul className="share-notes">
          <li>서버는 계속 이 컴퓨터에서 돌아가요. 친구가 보려면 이 컴퓨터와 CubePanel이 켜져 있어야 해요.</li>
          <li>친구마다 할 수 있는 일을 따로 정할 수 있어요. 기본은 "보기만"이에요.</li>
          <li>파일, 모드, 월드 초기화는 언제나 방장만 할 수 있어요.</li>
        </ul>
        <button className="btn primary lg" disabled={busy} onClick={() => run(() => window.api.startSharing(folderPath))}>
          {busy && <span className="spinner" />}
          공유 시작
        </button>
      </div>
    )
  else if (tab === '공유')
    content = (
      <div>
        <p className="hint" style={{ margin: '0 0 12px' }}>
          <span className={`dot ${online ? 'running' : 'stopped'}`} style={{ marginRight: 8 }} />
          {online ? '공유 중이에요. 이 컴퓨터와 CubePanel이 켜져 있는 동안 친구가 연결할 수 있어요.' : '공유 중계 서버에 연결하는 중이에요…'}
        </p>

        <div className="label">초대 코드</div>
        <div className="share-code">
          {code ? <code>{code}</code> : <span className="hint share-code-empty">아직 만든 코드가 없어요</span>}
          <button className="btn sm ghost" disabled={!code} onClick={() => window.api.copyText(code).then(() => toast('복사했어요'))} title="복사">
            <Copy size={15} />
            복사
          </button>
          <button className="btn sm primary" disabled={busy} onClick={makeCode}>
            {busy ? <span className="spinner" /> : <Link2 size={15} />}
            {code ? '새 코드 만들기' : '코드 만들기'}
          </button>
        </div>
        <p className="hint">새로 들어온 친구는 보기만으로 시작해요. 들어온 뒤 "권한"에서 할 수 있는 일을 정해 주세요.</p>
        <p className="hint">친구가 CubePanel → 새 서버 만들기 → "공유받은 서버"에 넣으면 돼요. 한 번만 쓸 수 있고 하루 안에 써야 해요.</p>

        <div className="label" style={{ marginTop: 18 }}>
          {devices?.length ? `공유받은 친구 ${devices.length}명` : '공유받은 친구'}
        </div>
        {!devices ? (
          <p className="hint">{online ? '불러오는 중…' : '공유 중계 서버에 연결되면 보여요.'}</p>
        ) : devices.length === 0 ? (
          <p className="hint">아직 없어요. 코드를 만들어 친구에게 보내 보세요.</p>
        ) : (
          <div className="friend-list">
            {devices.map((d) => (
              <div className="friend-row" key={d.id}>
                <span className={`dot ${d.online ? 'running' : 'stopped'}`} />
                <span className="friend-name">
                  <b>{d.name}</b>
                  <span className="hint">
                    {d.online ? '접속 중' : '접속 안 함'}
                    {d.pc && ` · ${d.pc}`}
                  </span>
                </span>
                <label className="friend-notify" title="서버가 켜지면 이 친구에게 알림을 보내요">
                  <span className="hint">서버 열 때 알림 가기</span>
                  <span className="switch">
                    <input
                      type="checkbox"
                      checked={d.notify}
                      onChange={(e) => {
                        const on = e.target.checked
                        setDevices((cur) => cur?.map((x) => (x.id === d.id ? { ...x, notify: on } : x)) ?? cur)
                        window.api.setShareNotify(folderPath, d.id, on).catch((err) => {
                          toast(cleanError(err), 'error')
                          void load().catch(() => undefined)
                        })
                      }}
                    />
                    <span />
                  </span>
                </label>
                <button className="btn icon sm ghost danger-hover" disabled={busy} onClick={() => setAskRevoke(d)} title="이 친구 끊기">
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="reset-row" style={{ marginTop: 18 }}>
          <span>
            <b>공유 끄기</b>
            <span className="hint">공유받은 친구가 모두 끊기고, 만든 초대 코드도 못 쓰게 돼요.</span>
          </span>
          <button className="btn danger" disabled={busy} onClick={() => setAskStop(true)}>
            공유 끄기
          </button>
        </div>
      </div>
    )
  else
    content = (
      <div>
        {devices?.length ? (
          <div className="perm-targets">
            <button className={`chip ${target === ALL ? 'active' : ''}`} onClick={() => setTarget(ALL)}>
              전체
            </button>
            {devices.map((d) => (
              <button key={d.id} className={`chip ${target === d.id ? 'active' : ''}`} onClick={() => setTarget(d.id)}>
                {d.name}
              </button>
            ))}
          </div>
        ) : null}
        <p className="hint" style={{ margin: '6px 0 4px' }}>
          {picked
            ? `${picked.name} 님이 할 수 있는 일이에요. 바꾸면 바로 적용돼요.`
            : all
              ? '누르면 모든 친구에게 바로 적용돼요.'
              : devices?.length
                ? '위에서 친구나 전체를 골라 주세요.'
                : '친구가 들어오면 여기서 권한을 줄 수 있어요. 새로 들어온 친구는 보기만으로 시작해요.'}
        </p>
        <PermEditor
          perms={shownPerms}
          disabled={busy || !online || (!picked && !all)}
          onChange={(p) => picked && applyPerms([{ id: picked.id, perms: p }])}
          onSetAll={all ? setForAll : undefined}
          friends={all ? (devices ?? []) : undefined}
          onEvery={(on) =>
            picked
              ? applyPerms([{ id: picked.id, perms: on ? [...ORDER] : [] }])
              : all && applyPerms((devices ?? []).map((d) => ({ id: d.id, perms: on ? [...ORDER] : [] })))
          }
        />
      </div>
    )

  return (
    <div className="backdrop" ref={leaveRef} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="settings-modal" role="dialog" aria-modal="true">
        <nav className="settings-nav">
          <h2>서버 공유</h2>
          {tabs.map((t) => (
            <button key={t.title} className={sharing && tab === t.title ? 'active' : ''} disabled={!sharing} onClick={() => setTab(t.title)}>
              <t.icon size={18} />
              {t.title}
            </button>
          ))}
        </nav>
        <section className="settings-body">
          <header>
            <h3>{sharing ? tab : '서버 공유'}</h3>
            <button className="btn icon sm ghost" onClick={onClose} aria-label="닫기">
              <X size={18} />
            </button>
          </header>
          <div className="settings-content">{content}</div>
        </section>
      </div>
      {askStop && (
        <Confirm
          title="공유를 끌까요?"
          body="공유받은 친구가 모두 끊기고, 만든 초대 코드도 못 쓰게 돼요. 다시 공유하면 새 코드를 만들어야 해요."
          confirmText="공유 끄기"
          danger
          onConfirm={() => {
            setAskStop(false)
            setCode('')
            void run(() => window.api.stopSharing(folderPath))
          }}
          onCancel={() => setAskStop(false)}
        />
      )}
      {askRevoke && (
        <Confirm
          title={`${askRevoke.name} 님을 끊을까요?`}
          body="이 친구 목록에서 서버가 연결되지 않아요. 다시 공유하려면 새 초대 코드를 보내야 해요."
          confirmText="끊기"
          danger
          onConfirm={() => {
            const d = askRevoke
            setAskRevoke(null)
            if (target === d.id) setTarget(NONE)
            void run(() => window.api.revokeShareDevice(folderPath, d.id))
          }}
          onCancel={() => setAskRevoke(null)}
        />
      )}
    </div>
  )
}

// 권한 스위치들 (묶음별). 보기는 언제나 된다
// onSetAll이 있으면(전체) 스위치 대신 켜기·끄기 버튼: 누르면 모든 친구에게 바로 적용
function PermEditor({
  perms,
  onChange,
  onSetAll,
  onEvery,
  friends,
  disabled
}: {
  perms: SharePerm[]
  onChange: (p: SharePerm[]) => void
  onSetAll?: (p: SharePerm, on: boolean) => void
  onEvery: (on: boolean) => void // 모든 권한 한 번에 켜기·끄기
  friends?: ShareDevice[] // 전체일 때: 권한마다 몇 명이 가졌는지 글씨로 보여 준다
  disabled?: boolean
}) {
  const Row = onSetAll ? 'div' : 'label'
  // 전체: "모두 켜짐 / 모두 꺼짐 / 2명 켜짐"
  const stateText = (has: number, total: number): string => (has === total ? '모두 켜짐' : has === 0 ? '모두 꺼짐' : `${total}명 중 ${has}명 켜짐`)
  const countOf = (p: SharePerm): number => friends?.filter((d) => d.perms.includes(p)).length ?? 0
  return (
    <div className="perm-editor">
      <div className="reset-row perm-every">
        <span>
          <b>모든 권한</b>
        </span>
        <span className="perm-onoff">
          <button className="btn sm" disabled={disabled} onClick={() => onEvery(true)}>
            전체 켜기
          </button>
          <button className="btn sm ghost" disabled={disabled} onClick={() => onEvery(false)}>
            전체 끄기
          </button>
        </span>
      </div>
      {PERM_GROUPS.map((g) => (
        <div className="perm-group" key={g.title}>
          <div className="label">{g.title}</div>
          {g.perms.map((p) => {
            const I = PERM_INFO[p].icon
            return (
              <Row className="reset-row" key={p}>
                <span>
                  <b>
                    <I size={15} style={{ marginRight: 6, verticalAlign: -2 }} />
                    {PERM_INFO[p].title}
                  </b>
                  {friends && <span className={`hint perm-state ${countOf(p) ? 'on' : ''}`}>{stateText(countOf(p), friends.length)}</span>}
                </span>
                {onSetAll ? (
                  <span className="perm-onoff">
                    <button className="btn sm" disabled={disabled} onClick={() => onSetAll(p, true)}>
                      켜기
                    </button>
                    <button className="btn sm ghost" disabled={disabled} onClick={() => onSetAll(p, false)}>
                      끄기
                    </button>
                  </span>
                ) : (
                  <span className="switch">
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={perms.includes(p)}
                      onChange={(e) => onChange(ORDER.filter((x) => (x === p ? e.target.checked : perms.includes(x))))}
                    />
                    <span />
                  </span>
                )}
              </Row>
            )
          })}
        </div>
      ))}
    </div>
  )
}
