import { useCallback, useEffect, useState } from 'react'
import type { OffSuggestion } from '../../shared-types'
import { Modal, useToast } from './ui'
import { cleanError } from './util'

const WHY: Record<OffSuggestion['reason'], string> = {
  client: '클라이언트 전용',
  clientMixin: '서버에서 튕김',
  startFail: '켜다가 멈춤'
}

// 이 모드를 필요로 하는 모드 이름들 (세 개까지만 보여 준다)
const needers = (names: string[]): string => names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3}` : '')

// 모드를 넣은 뒤 서버를 확인해 보라고 알린다 (모드 탭 → 이 창)
export const checkOffSuggestions = (): void => {
  window.dispatchEvent(new Event('off-suggest-check'))
}

// 서버에 맞지 않아 보이는 모드가 있으면 끌지 물어본다. 고른 것만 끄고, 고르지 않은 것은 다시 묻지 않는다
// onAnswered: 답을 고른 뒤 (켜기 전 점검에서 뜬 경우 이어서 켜려고). 인자가 true면 앱이 이미 서버를 켜기 시작했다 (켜다가 멈춘 모드를 끈 경우)
// onLater: "나중에"를 눌렀을 때
export default function OffSuggestDialog({ folderPath, serverOn, onAnswered, onLater }: { folderPath: string; serverOn: boolean; onAnswered?: (autoStarted: boolean) => void; onLater?: () => void }) {
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
        setPicked(new Set(l.filter((x) => !x.neededBy?.length).map((x) => x.fileName))) // 다른 모드가 필요로 하는 것은 기본으로 고르지 않는다
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
      // 켜다가 멈춘 모드를 껐으면 바로 서버를 켜 보고, 같은 문제가 또 나오면 앱이 알아서 이어서 고친다
      let started = false
      if (!serverOn && list.some((m) => files.includes(m.fileName) && m.reason === 'startFail')) {
        try {
          window.api.autoFixStart(folderPath).catch((e) => toast(cleanError(e), 'error'))
          started = true
          toast('서버를 다시 켜 봐요. 같은 문제가 또 나오면 알아서 이어서 고쳐요')
        } catch {
          started = false
        }
      }
      onAnswered?.(started)
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
          <div key={m.fileName}>
            <label className="mp-check">
              <input type="checkbox" checked={picked.has(m.fileName)} onChange={() => toggle(m.fileName)} disabled={busy} />
              <span className="off-title">{m.title}</span>
              <span
                className="mini-tag"
                title={m.reason === 'client' ? '게임 화면용 모드라서 서버에서는 필요 없어요' : '이 버전은 서버에서 켜면 튕겨요 (모드 쪽 버그). 게임에서는 문제없어요'}
              >
                {WHY[m.reason]}
              </span>
            </label>
            {m.neededBy && m.neededBy.length > 0 && (
              <p className="error-text" style={{ margin: '2px 0 8px 28px', fontSize: 13 }}>
                {`${needers(m.neededBy)}가 이 모드를 필요로 해요. 끄면 서버가 안 켜질 수 있어서 기본으로 고르지 않았어요. 튕긴 원인이 다른 모드일 수 있어요.`}
              </p>
            )}
          </div>
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
