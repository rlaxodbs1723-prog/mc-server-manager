import { useCallback, useEffect, useState } from 'react'
import type { OffSuggestion } from '../../shared-types'
import { Modal, useToast } from './ui'
import { cleanError } from './util'

const WHY: Record<OffSuggestion['reason'], string> = {
  client: '클라이언트 전용',
  clientMixin: '서버에서 튕김'
}

// 모드를 넣은 뒤 서버를 확인해 보라고 알린다 (모드 탭 → 이 창)
export const checkOffSuggestions = (): void => {
  window.dispatchEvent(new Event('off-suggest-check'))
}

// 서버에 맞지 않아 보이는 모드가 있으면 끌지 물어본다. 고른 것만 끄고, 고르지 않은 것은 다시 묻지 않는다
// onAnswered: 답을 고른 뒤 (켜기 전 점검에서 뜬 경우 이어서 켜려고)
// onLater: "나중에"를 눌렀을 때
export default function OffSuggestDialog({ folderPath, serverOn, onAnswered, onLater }: { folderPath: string; serverOn: boolean; onAnswered?: () => void; onLater?: () => void }) {
  const toast = useToast()
  const [list, setList] = useState<OffSuggestion[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [later, setLater] = useState(false) // "나중에": 다음에 다시 물을 때까지 숨긴다 (켜 두기로 정한 것은 아니다)

  const load = useCallback(() => {
    window.api
      .offSuggestions(folderPath)
      .then((l) => {
        setLater(false)
        setList(l)
        setPicked(new Set(l.map((x) => x.fileName)))
      })
      .catch(() => setList([]))
  }, [folderPath])

  useEffect(() => {
    load()
    window.addEventListener('off-suggest-check', load)
    return () => window.removeEventListener('off-suggest-check', load)
  }, [load])

  if (!list.length || later) return null

  async function apply(files: string[]) {
    setBusy(true)
    try {
      await window.api.applyOffSuggestions(folderPath, files)
      if (files.length)
        toast(`모드 ${files.length}개를 껐어요`, 'success', {
          label: '되돌리기',
          onClick: async () => {
            let failed = ''
            for (const f of files) await window.api.setModEnabled(folderPath, f, true).catch((e) => (failed = cleanError(e)))
            if (failed) toast(`되돌리지 못한 모드가 있어요: ${failed}`, 'error')
            window.dispatchEvent(new Event('mods-changed'))
          }
        })
      setList([])
      window.dispatchEvent(new Event('mods-changed'))
      onAnswered?.()
    } catch (e) {
      toast(cleanError(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const toggle = (f: string) =>
    setPicked((p) => {
      const n = new Set(p)
      if (n.has(f)) n.delete(f)
      else n.add(f)
      return n
    })

  return (
    <Modal>
      <h2>서버에 맞지 않는 모드가 있어요</h2>
      <div className="body">
        아래 모드는 서버에서 필요 없거나, 서버에서 켜면 튕길 수 있어요. 끌 모드를 골라 주세요. 지우지 않고 꺼 두기만 해서 나중에 모드 탭에서 다시 켤 수 있어요.
      </div>
      <div className="off-list">
        {list.map((m) => (
          <label className="mp-check" key={m.fileName}>
            <input type="checkbox" checked={picked.has(m.fileName)} onChange={() => toggle(m.fileName)} disabled={busy} />
            <span className="off-title">{m.title}</span>
            <span
              className="mini-tag"
              title={m.reason === 'client' ? '게임 화면용 모드라서 서버에서는 필요 없어요' : '이 버전은 서버에서 켜면 튕겨요 (모드 쪽 버그). 게임에서는 문제없어요'}
            >
              {WHY[m.reason]}
            </span>
          </label>
        ))}
      </div>
      {serverOn && <p className="error-text">서버가 켜져 있어서 모드를 끌 수 없어요. 먼저 서버를 꺼 주세요.</p>}
      <div className="actions">
        <button className="btn ghost" onClick={() => {
            setLater(true)
            onLater?.()
          }} disabled={busy} title="지금은 그대로 두고, 다음에 서버를 켜거나 이 서버를 열 때 다시 물어봐요">
          나중에
        </button>
        <button className="btn" onClick={() => apply([])} disabled={busy} title="고른 것과 상관없이 모두 켜 두고, 다시 묻지 않아요">
          모두 켜 두기
        </button>
        <button className="btn primary" onClick={() => apply([...picked])} disabled={busy || serverOn || !picked.size}>
          {busy && <span className="spinner" />}
          {picked.size ? `${picked.size}개 끄기` : '끌 모드를 골라 주세요'}
        </button>
      </div>
    </Modal>
  )
}
