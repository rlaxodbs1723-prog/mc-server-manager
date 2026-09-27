import { AlertTriangle, Search } from 'lucide-react'
import type { PreflightResult } from '../../shared-types'
import { Modal } from './ui'

// 서버를 켜기 전 점검에서 걸린 것을 보여 주고, 그래도 켤지 묻는다
export default function PreflightDialog({ result, onStart, onCancel, onFind }: { result: PreflightResult; onStart: () => void; onCancel: () => void; onFind: (modId: string) => void }) {
  // 필요한 모드별로 묶는다: fabric-api ← Architectury, Balm 외 3개
  const byNeed = new Map<string, string[]>()
  for (const m of result.missing) for (const n of m.needs) byNeed.set(n, [...(byNeed.get(n) ?? []), m.mod])
  const names = (list: string[]): string => (list.length > 3 ? `${list.slice(0, 3).join(', ')} 외 ${list.length - 3}개` : list.join(', '))

  return (
    <Modal onClose={onCancel}>
      <h2>켜기 전에 확인해 주세요</h2>
      <div className="body">이대로 켜면 서버가 튕기거나 느릴 수 있어요.</div>
      <div className="preflight-list">
        {[...byNeed].map(([need, by]) => {
          const off = need.endsWith(' (꺼져 있음)')
          const id = need.replace(' (꺼져 있음)', '')
          return (
            <div className="preflight-item" key={need}>
              <AlertTriangle size={16} />
              <div className="pf-text">
                <b>{off ? `꺼 둔 모드 "${id}"이(가) 필요해요` : `"${id}" 모드가 없어요`}</b>
                <span className="hint">{names(by)}에 필요해요.</span>
              </div>
              {!off && (
                <button className="btn sm" onClick={() => onFind(id)} title="모드 탭에서 찾아요">
                  <Search size={14} />
                  찾기
                </button>
              )}
            </div>
          )
        })}
        {result.memory && (
          <div className="preflight-item">
            <AlertTriangle size={16} />
            <div className="pf-text">
              <b>메모리가 모자라요</b>
              <span className="hint">{result.memory}</span>
            </div>
          </div>
        )}
      </div>
      <div className="actions">
        <button className="btn" onClick={onCancel}>
          취소
        </button>
        <button className="btn primary" onClick={onStart}>
          그래도 켜기
        </button>
      </div>
    </Modal>
  )
}
