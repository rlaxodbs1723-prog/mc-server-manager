import { useEffect, useState } from 'react'
import { Modal, useToast } from './ui'
import { cleanError } from './util'

const BASE = 'cubepanel.kr'

// 이름 주소(이름.cubepanel.kr)를 정하거나 없애는 창. 이름만 정하면 바로 쓸 수 있다
export default function DomainDialog({ folderPath, onClose }: { folderPath: string; onClose: () => void }) {
  const toast = useToast()
  const [current, setCurrent] = useState<{ name: string; host: string } | null | undefined>(undefined)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.api
      .getDomain(folderPath)
      .then((d) => {
        setCurrent(d)
        setName(d?.name ?? '')
      })
      .catch(() => setCurrent(null))
  }, [folderPath])

  async function save() {
    setBusy(true)
    try {
      const host = await window.api.claimDomain(folderPath, name)
      await window.api.copyText(host).catch(() => undefined)
      toast(`${host} 주소를 만들었어요. 복사했으니 플레이어에게 보내 주세요!`, 'success')
      onClose()
    } catch (e) {
      toast(cleanError(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    try {
      await window.api.releaseDomain(folderPath)
      toast('이름 주소를 없앴어요')
      onClose()
    } catch (e) {
      toast(cleanError(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const same = current?.name === name
  return (
    <Modal onClose={busy ? undefined : onClose}>
      <h2>이름 주소 만들기</h2>
      <p className="hint">숫자 IP 대신 외우기 쉬운 이름으로 접속하게 해요. 이름만 정하면 바로 쓸 수 있어요.</p>
      <div className="domain-row">
        <input
          className="input"
          value={name}
          maxLength={20}
          placeholder="myserver"
          autoFocus
          disabled={busy || current === undefined}
          onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && name.length >= 3 && !busy && save()}
        />
        <span className="domain-suffix">{`.${BASE}`}</span>
      </div>
      <p className="hint">영어 소문자, 숫자, 하이픈(-)으로 3~20자예요.</p>
      <p className="hint">공유기 포트가 열린 서버에서만 써요. 터널(playit)로 열린 서버는 터널 주소를 써요.</p>
      <p className="hint">이 주소는 이 컴퓨터의 인터넷 주소(IP)를 가리켜요. 주소를 아는 사람은 IP도 알 수 있어요. 서버를 켤 때마다 자동으로 갱신돼요.</p>
      <div className="actions">
        {current && (
          <button className="btn danger" onClick={remove} disabled={busy}>
            없애기
          </button>
        )}
        <button className="btn" onClick={onClose} disabled={busy}>
          닫기
        </button>
        <button className="btn primary" onClick={save} disabled={busy || name.length < 3 || same}>
          {busy && <span className="spinner" />}
          {current ? '이름 바꾸기' : '만들기'}
        </button>
      </div>
    </Modal>
  )
}
