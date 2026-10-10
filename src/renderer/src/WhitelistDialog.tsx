import { UserPlus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { WhitelistInfo } from '../../shared-types'
import { Confirm, Empty, Modal, useToast } from './ui'
import { cleanError } from './util'

// 화이트리스트 켜기/끄기와 목록 관리. 바꾸는 즉시 저장되고, 켜진 서버에는 바로 적용된다.
// 설정 창(WhitelistDialog)과 관리 탭에서 같이 쓴다.
export function WhitelistPanel({ folderPath, autoFocus }: { folderPath: string; autoFocus?: boolean }) {
  const toast = useToast()
  const [info, setInfo] = useState<WhitelistInfo | null>(null)
  const [name, setName] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const [askEmpty, setAskEmpty] = useState(false) // 목록이 빈 채로 켜려고 할 때

  const load = () => window.api.getWhitelist(folderPath).then(setInfo)
  useEffect(() => {
    load()
  }, [folderPath]) // eslint-disable-line react-hooks/exhaustive-deps

  async function toggle(enabled: boolean, sure = false) {
    // 목록이 비어 있으면 켜는 순간 아무도(방장도) 못 들어온다
    if (enabled && !sure && info && info.players.length === 0) return setAskEmpty(true)
    setAskEmpty(false)
    try {
      await window.api.setWhitelistEnabled(folderPath, enabled)
      await load()
      toast(enabled ? '화이트리스트를 켰어요' : '화이트리스트를 껐어요')
    } catch (e) {
      toast(cleanError(e), 'error')
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setAdding(true)
    setError('')
    try {
      const p = await window.api.addWhitelist(folderPath, name)
      setName('')
      await load()
      toast(`${p.name}님을 추가했어요`)
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setAdding(false)
    }
  }

  async function remove(player: string) {
    try {
      await window.api.removeWhitelist(folderPath, player)
      await load()
      toast(`${player}님을 뺐어요`)
    } catch (e) {
      toast(cleanError(e), 'error')
    }
  }

  if (!info) return <p className="hint">불러오고 있어요…</p>
  return (
    <>
      <label className="check-row agree" style={{ marginTop: 4, justifyContent: 'space-between' }}>
        <span>
          <b style={{ color: 'var(--text)' }}>화이트리스트 사용</b>
          <br />
          <span className="hint">켜면 목록에 있는 사람만 들어올 수 있어요.</span>
        </span>
        <span className="switch">
          <input type="checkbox" checked={info.enabled} onChange={(e) => toggle(e.target.checked)} />
          <span />
        </span>
      </label>

      <form className="wl-add" onSubmit={add}>
        <input
          className="input"
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setError('')
          }}
          placeholder="마인크래프트 닉네임"
          maxLength={16}
          autoFocus={autoFocus}
        />
        <button className="btn primary" style={{ height: 48 }} disabled={adding || !name.trim()}>
          {adding ? <span className="spinner" /> : <UserPlus size={16} />}
          추가
        </button>
      </form>
      {error && (
        <p className="error-text" style={{ marginTop: 8 }}>
          {error}
        </p>
      )}
      {!info.onlineMode && (
        <p className="hint" style={{ marginTop: 8 }}>
          정품 인증이 꺼져 있어서 닉네임만으로 추가돼요.
        </p>
      )}

      {askEmpty && (
        <Confirm
          title="목록이 비어 있어요"
          body="이대로 켜면 아무도(방장도) 들어올 수 없어요. 먼저 닉네임을 추가하는 게 좋아요."
          confirmText="그래도 켜기"
          cancelText="먼저 추가하기"
          onConfirm={() => toggle(true, true)}
          onCancel={() => setAskEmpty(false)}
        />
      )}

      <div className="wl-list">
        {info.players.length === 0 ? (
          <Empty title="아직 아무도 없어요" hint="닉네임을 넣어 허락할 플레이어를 추가해요." />
        ) : (
          info.players.map((p) => (
            <div className="wl-item" key={p.uuid}>
              <img
                src={`https://mc-heads.net/avatar/${encodeURIComponent(p.name)}/32`}
                alt=""
                onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
              />
              <span className="wl-name">{p.name}</span>
              <button className="btn sm ghost" onClick={() => remove(p.name)}>
                빼기
              </button>
            </div>
          ))
        )}
      </div>
    </>
  )
}

export default function WhitelistDialog({ folderPath, onClose }: { folderPath: string; onClose: () => void }) {
  return (
    <Modal onClose={onClose}>
      <div className="wl-head">
        <h2>화이트리스트</h2>
        <button className="btn icon sm ghost" onClick={onClose} aria-label="닫기">
          <X size={18} />
        </button>
      </div>
      <WhitelistPanel folderPath={folderPath} autoFocus />
    </Modal>
  )
}
