import { Copy, Link2, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ShareDevice, ShareRole } from '../../shared-types'
import { Confirm, Loading, Modal, useToast } from './ui'
import { cleanError } from './util'

// 서버 공유 (방장): 공유를 켜고, 친구에게 줄 초대 코드를 만들고, 공유받은 친구(기기)를 보고 끊는다.
// 서버는 늘 이 컴퓨터에서 돈다. 친구는 자기 CubePanel에서 이 서버를 보고(관리자면 다룬다)
export default function ShareDialog({ folderPath, onClose }: { folderPath: string; onClose: () => void }) {
  const toast = useToast()
  const [status, setStatus] = useState<{ sharing: boolean; online: boolean } | null>(null)
  const [devices, setDevices] = useState<ShareDevice[] | null>(null)
  const [role, setRole] = useState<ShareRole>('view')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [askStop, setAskStop] = useState(false)

  const load = async (): Promise<void> => {
    const s = await window.api.shareStatus(folderPath)
    setStatus(s)
    if (s.sharing && s.online) setDevices(await window.api.shareDevices(folderPath).catch(() => null))
  }
  useEffect(() => {
    void load().catch((e) => toast(cleanError(e), 'error'))
    // 방에 붙는 데 1~2초 걸려서, 연결되기 전이면 잠깐 뒤에 다시 본다
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

  return (
    <Modal onClose={busy ? undefined : onClose}>
      <h2>서버 공유</h2>
      {!status ? (
        <Loading />
      ) : !status.sharing ? (
        <>
          <p className="body">친구 CubePanel에서도 이 서버의 상태와 콘솔을 볼 수 있게 해요. 서버는 계속 이 컴퓨터에서 돌아가서, 친구가 보려면 이 컴퓨터와 CubePanel이 켜져 있어야 해요.</p>
          <div className="actions">
            <button className="btn" onClick={onClose}>
              닫기
            </button>
            <button className="btn primary" disabled={busy} onClick={() => run(() => window.api.startSharing(folderPath))}>
              {busy && <span className="spinner" />}
              공유 시작
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="hint">{status.online ? '공유 중이에요.' : '공유 중계 서버에 연결하는 중이에요…'}</p>

          <div className="label" style={{ marginTop: 14 }}>
            초대 코드 만들기
          </div>
          <div className="seg">
            <button className={role === 'view' ? 'active' : ''} onClick={() => setRole('view')}>
              보기만
            </button>
            <button className={role === 'admin' ? 'active' : ''} onClick={() => setRole('admin')}>
              관리자
            </button>
          </div>
          <p className="hint">
            {role === 'view' ? '서버 상태와 콘솔, 접속자를 볼 수만 있어요.' : '서버 켜기·끄기, 명령, 관리까지 할 수 있어요. 믿는 친구에게만 주세요.'}
          </p>
          <button
            className="btn"
            disabled={busy || !status.online}
            onClick={() =>
              run(async () => {
                const c = await window.api.createShareInvite(folderPath, role)
                setCode(c)
                await window.api.copyText(c).catch(() => undefined)
                toast('초대 코드를 복사했어요. 친구에게 보내 주세요!')
              })
            }
          >
            <Link2 size={16} />
            초대 코드 만들기
          </button>
          {code && (
            <div className="key-row" style={{ marginTop: 8 }}>
              <code style={{ userSelect: 'text', wordBreak: 'break-all', fontSize: 12 }}>{code}</code>
              <button className="btn sm ghost" onClick={() => window.api.copyText(code).then(() => toast('복사했어요'))}>
                <Copy size={14} />
              </button>
            </div>
          )}
          {code && <p className="hint">친구가 CubePanel → 새 서버 만들기 → "공유받은 서버"에 넣으면 돼요. 한 번만 쓸 수 있고 하루 안에 써야 해요.</p>}

          <div className="label" style={{ marginTop: 14 }}>
            공유받은 친구
          </div>
          {!devices ? (
            <p className="hint">{status.online ? '불러오는 중…' : '연결되면 보여요.'}</p>
          ) : devices.length === 0 ? (
            <p className="hint">아직 없어요.</p>
          ) : (
            devices.map((d) => (
              <div className="setting-row" key={d.id}>
                <div className="setting-text">
                  <div className="setting-label">
                    <span className={`dot ${d.online ? 'running' : 'stopped'}`} style={{ marginRight: 6 }} />
                    {d.name}
                  </div>
                  <div className="setting-desc">{d.role === 'admin' ? '관리자' : '보기만'}</div>
                </div>
                <button
                  className="btn sm ghost"
                  disabled={busy}
                  onClick={() => run(() => window.api.setShareRole(folderPath, d.id, d.role === 'admin' ? 'view' : 'admin'))}
                >
                  {d.role === 'admin' ? '보기만으로' : '관리자로'}
                </button>
                <button className="btn sm ghost" disabled={busy} onClick={() => run(() => window.api.revokeShareDevice(folderPath, d.id))} title="이 친구 끊기">
                  <Trash2 size={15} />
                </button>
              </div>
            ))
          )}

          <div className="actions">
            <button className="btn danger" disabled={busy} onClick={() => setAskStop(true)}>
              공유 끄기
            </button>
            <button className="btn" onClick={onClose} disabled={busy}>
              닫기
            </button>
          </div>
        </>
      )}
      {askStop && (
        <Confirm
          title="공유를 끌까요?"
          body="공유받은 친구가 모두 끊기고, 만든 초대 코드도 못 쓰게 돼요. 다시 공유하면 새 코드를 만들어야 해요."
          confirmText="공유 끄기"
          danger
          onConfirm={() => {
            setAskStop(false)
            void run(() => window.api.stopSharing(folderPath))
          }}
          onCancel={() => setAskStop(false)}
        />
      )}
    </Modal>
  )
}
