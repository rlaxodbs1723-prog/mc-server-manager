import { Gift, Heart, MapPin } from 'lucide-react'
import { useState } from 'react'
import type { ManageAction, PlayerRecord } from '../../shared-types'
import Select from './Select'
import { Modal } from './ui'

// 자주 주는 아이템 (1.13 이후 이름. 옛 버전은 직접 입력)
const ITEMS = [
  { value: 'minecraft:diamond', label: '💎 다이아몬드' },
  { value: 'minecraft:iron_ingot', label: '⛓️ 철 주괴' },
  { value: 'minecraft:gold_ingot', label: '🪙 금 주괴' },
  { value: 'minecraft:emerald', label: '💚 에메랄드' },
  { value: 'minecraft:cooked_beef', label: '🥩 스테이크' },
  { value: 'minecraft:golden_apple', label: '🍎 황금 사과' },
  { value: 'minecraft:torch', label: '🔥 횃불' },
  { value: 'minecraft:oak_log', label: '🪵 참나무 원목' },
  { value: 'minecraft:diamond_sword', label: '🗡️ 다이아몬드 검' },
  { value: 'minecraft:diamond_pickaxe', label: '⛏️ 다이아몬드 곡괭이' },
  { value: 'minecraft:elytra', label: '🪽 겉날개' },
  { value: 'minecraft:ender_pearl', label: '🟣 엔더 진주' },
  { value: 'custom', label: '✏️ 직접 입력' }
]

export const playTime = (ms: number): string => {
  const m = Math.floor(ms / 60000)
  if (m < 1) return '1분 미만'
  if (m < 60) return `${m}분`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}시간 ${m % 60}분` : `${Math.floor(h / 24)}일 ${h % 24}시간`
}

export const ago = (t: number): string => {
  const m = Math.floor((Date.now() - t) / 60000)
  if (m < 1) return '방금'
  if (m < 60) return `${m}분 전`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}시간 전`
  const d = Math.floor(h / 24)
  return d < 30 ? `${d}일 전` : new Date(t).toLocaleDateString('ko-KR')
}

interface Props {
  record: PlayerRecord
  others: string[] // 순간이동할 수 있는 다른 접속자
  running: boolean
  act: (a: ManageAction, done: string) => void
  onClose: () => void
}

export default function PlayerDialog({ record: r, others, running, act, onClose }: Props) {
  const [item, setItem] = useState(ITEMS[0].value)
  const [custom, setCustom] = useState('')
  const [count, setCount] = useState(1)
  const live = running && r.online
  const itemId = item === 'custom' ? custom.trim() : item

  return (
    <Modal onClose={onClose}>
      <div className="pd-head">
        <img src={`https://mc-heads.net/body/${r.name}/80`} alt="" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
        <div>
          <h2>{r.name}</h2>
          <span className={`pill ${r.online ? 'running' : ''}`}>
            <span className={`dot ${r.online ? 'running' : ''}`} />
            {r.online ? '접속 중' : `마지막 접속 ${ago(r.lastSeen)}`}
          </span>
        </div>
      </div>

      <div className="pd-stats">
        <div>
          <span>총 플레이</span>
          <b>{playTime(r.playMs)}</b>
        </div>
        <div>
          <span>접속 횟수</span>
          <b>{r.joins}번</b>
        </div>
        <div>
          <span>처음 접속</span>
          <b>{new Date(r.firstSeen).toLocaleDateString('ko-KR')}</b>
        </div>
      </div>

      {live ? (
        <div className="pd-actions">
          <div className="pd-row">
            <Gift size={17} />
            <div className="pd-item">
              <Select value={item} options={ITEMS} onChange={setItem} />
            </div>
            {item === 'custom' && (
              <input className="input pd-custom" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="예: minecraft:netherite_ingot" />
            )}
            <input
              className="input pd-count"
              type="number"
              min={1}
              max={999}
              value={count}
              title="1 ~ 999"
              onChange={(e) => setCount(Math.min(999, Math.max(1, Number(e.target.value) || 1)))}
            />
            <button
              className="btn primary"
              disabled={!itemId}
              onClick={() => act({ type: 'give', name: r.name, item: itemId, count }, `${r.name}님에게 아이템을 줬어요`)}
            >
              주기
            </button>
          </div>
          <div className="pd-row">
            <MapPin size={17} />
            {others.length ? (
              <div className="pd-item">
                <Select
                  value=""
                  placeholder="누구 옆으로 보낼까요?"
                  options={others.map((o) => ({ value: o, label: o }))}
                  onChange={(t) => act({ type: 'tp', name: r.name, target: t }, `${r.name}님을 ${t}님 옆으로 보냈어요`)}
                />
              </div>
            ) : (
              <span className="hint">다른 사람이 접속하면 그 옆으로 순간이동시킬 수 있어요</span>
            )}
          </div>
          <div className="pd-row">
            <Heart size={17} />
            <span className="hint" style={{ flex: 1 }}>체력과 배고픔을 가득 채워요</span>
            <button className="btn" onClick={() => act({ type: 'heal', name: r.name }, `${r.name}님을 회복시켰어요`)}>
              회복
            </button>
          </div>
        </div>
      ) : (
        <p className="hint">접속 중일 때 아이템 주기, 순간이동, 회복을 할 수 있어요.</p>
      )}

      <div className="actions">
        <button className="btn" onClick={onClose} autoFocus>
          닫기
        </button>
      </div>
    </Modal>
  )
}
