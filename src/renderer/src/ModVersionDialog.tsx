import { useEffect, useState } from 'react'
import type { ModVersionItem } from '../../shared-types'
import { Empty, Loading, Modal, useToast } from './ui'
import { cleanError } from './util'

const TYPE_LABEL = { release: '', beta: '베타', alpha: '알파' }

// 설치된 모드의 버전 고르기: 이 서버 버전·로더에 맞는 것만 보여 준다
interface Props {
  title: string
  load: () => Promise<ModVersionItem[]>
  apply: (versionId: string) => Promise<string[] | void> // 받지 못한 것들 (있으면)
  onClose: () => void
  onDone: () => void
}

export default function ModVersionDialog({ title, load, apply, onClose, onDone }: Props) {
  const toast = useToast()
  const [list, setList] = useState<ModVersionItem[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  useEffect(() => {
    load()
      .then(setList)
      .catch((e) => setError(cleanError(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function pick(v: ModVersionItem) {
    setBusy(v.id)
    try {
      const failed = await apply(v.id)
      toast(`${title}을(를) ${v.versionNumber} 버전으로 바꿨어요`)
      if (failed?.length) toast(`일부를 받지 못했어요: ${failed.join(' / ')}`, 'error')
      onDone()
    } catch (e) {
      toast(cleanError(e), 'error')
      setBusy('')
    }
  }

  return (
    <Modal onClose={busy ? undefined : onClose}>
      <h2>{title} 버전 바꾸기</h2>
      <p className="body">이 서버에 맞는 버전만 보여 드려요.</p>
      {error ? (
        <p className="error-text">{error}</p>
      ) : list === null ? (
        <Loading />
      ) : list.length === 0 ? (
        <Empty title="이 서버에 맞는 다른 버전이 없어요" />
      ) : (
        <div className="save-list">
          {list.map((v) => (
            <div className={`map-file ${v.current ? 'current' : ''}`} key={v.id}>
              <div className="save-text">
                <b>
                  {v.versionNumber} {TYPE_LABEL[v.type] && <span className="chip warn">{TYPE_LABEL[v.type]}</span>}
                </b>
                <span className="hint">{new Date(v.date).toLocaleDateString('ko-KR')}</span>
              </div>
              {v.current ? (
                <span className="chip blue">지금 버전</span>
              ) : (
                <button className="btn sm primary" onClick={() => pick(v)} disabled={!!busy}>
                  {busy === v.id && <span className="spinner" />}
                  이 버전으로
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="actions">
        <button className="btn" onClick={onClose} disabled={!!busy}>
          닫기
        </button>
      </div>
    </Modal>
  )
}
