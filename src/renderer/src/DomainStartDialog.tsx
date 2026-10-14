import { useState } from 'react'
import { DomainField } from './AddressMemory'
import { Modal, useToast } from './ui'
import { cleanError } from './util'

// 이름 주소가 없는 서버(이름 주소 기능이 생기기 전에 만든 서버)를 켤 때 한 번 정하게 하는 창
export default function DomainStartDialog({
  folderPath,
  onDone,
  onSkip,
  onCancel
}: {
  folderPath: string
  onDone: () => void
  onSkip: () => void
  onCancel: () => void
}) {
  const toast = useToast()
  const [domain, setDomain] = useState<{ domainName?: string; blocked: boolean }>({ blocked: true })
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!domain.domainName) return
    setBusy(true)
    try {
      const host = await window.api.claimDomain(folderPath, domain.domainName)
      await window.api.copyText(host).catch(() => undefined)
      toast(`${host} 주소를 만들었어요. 복사했으니 플레이어에게 보내 주세요!`, 'success')
      onDone()
    } catch (e) {
      toast(cleanError(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={busy ? undefined : onCancel}>
      <h2>서버 주소 이름 정하기</h2>
      <DomainField onChange={setDomain} />
      <div className="actions">
        <button className="btn" onClick={onCancel} disabled={busy}>
          취소
        </button>
        <button className="btn" onClick={onSkip} disabled={busy}>
          건너뛰고 켜기
        </button>
        <button className="btn primary" onClick={save} disabled={busy || domain.blocked}>
          {busy && <span className="spinner" />}
          이름 정하고 켜기
        </button>
      </div>
    </Modal>
  )
}
