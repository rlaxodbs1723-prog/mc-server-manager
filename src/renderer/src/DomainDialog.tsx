import { useEffect, useState } from 'react'
import { DomainField } from './AddressMemory'
import { Confirm, Loading, Modal, useToast } from './ui'
import { cleanError, writeStored } from './util'

// 접속 주소 옆 "주소 변경" 버튼으로 여는 창: 이름 주소(이름.cubepanel.kr)를 보고, 바꾸고, 없앤다. 누르면 바로 적용된다
export default function DomainDialog({ folderPath, onClose }: { folderPath: string; onClose: () => void }) {
  const toast = useToast()
  const [host, setHost] = useState<string | null | undefined>(undefined) // undefined: 불러오는 중
  const [value, setValue] = useState<{ domainName?: string; blocked: boolean }>({ blocked: true })
  const [busy, setBusy] = useState(false)
  const [askRemove, setAskRemove] = useState(false)

  useEffect(() => {
    window.api.peekDomain(folderPath).then((d) => setHost(d?.host ?? null), () => setHost(null))
  }, [folderPath])

  async function save() {
    if (!value.domainName) return
    setBusy(true)
    try {
      const h = await window.api.claimDomain(folderPath, value.domainName)
      toast(`${h} 주소로 바꿨어요. 서버를 켜면 이 주소로 접속돼요`, 'success')
      window.dispatchEvent(new Event('servers-changed'))
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
      writeStored(`domainSkip:${folderPath}`, '1') // 일부러 없앴으니 켤 때 다시 묻지 않는다
      toast('이름 주소를 없앴어요')
      window.dispatchEvent(new Event('servers-changed'))
      onClose()
    } catch (e) {
      toast(cleanError(e), 'error')
      setBusy(false)
      setAskRemove(false)
    }
  }

  return (
    <Modal onClose={busy ? undefined : onClose}>
      <h2>서버 주소 변경</h2>
      {host === undefined ? (
        <Loading />
      ) : (
        <>
          {host && <p className="hint">{`지금 주소: ${host}`}</p>}
          <DomainField onChange={setValue} />
        </>
      )}
      <div className="actions">
        {host && (
          <button className="btn danger" onClick={() => setAskRemove(true)} disabled={busy}>
            없애기
          </button>
        )}
        <button className="btn" onClick={onClose} disabled={busy}>
          취소
        </button>
        <button className="btn primary" onClick={save} disabled={busy || host === undefined || value.blocked || !value.domainName}>
          {busy && <span className="spinner" />}
          {host ? '이름 바꾸기' : '이름 정하기'}
        </button>
      </div>
      {askRemove && (
        <Confirm
          title="이름 주소를 없앨까요?"
          body={`${host} 주소가 없어져요. 이 주소로 접속하던 플레이어는 들어올 수 없게 돼요. 숫자 주소는 그대로 써요.`}
          confirmText="없애기"
          danger
          onConfirm={remove}
          onCancel={() => setAskRemove(false)}
        />
      )}
    </Modal>
  )
}
