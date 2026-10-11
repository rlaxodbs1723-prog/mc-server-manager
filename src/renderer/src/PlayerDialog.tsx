import { useEffect, useState, type ReactNode } from 'react'
import type { ManageAction, PlayerData, PlayerRecord } from '../../shared-types'
import { EnderChest, PlayerInventory } from './Inventory'
import { Loading, Modal } from './ui'
import { cleanError } from './util'

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

const MODES = ['서바이벌', '크리에이티브', '모험', '관전']
const DIMS: Record<string, string> = {
  'minecraft:overworld': '오버월드',
  'minecraft:the_nether': '네더',
  'minecraft:the_end': '엔드'
}
const place = (dim: string | null, pos: number[] | null): string =>
  pos ? `${DIMS[dim ?? ''] ?? dim ?? ''} ${pos.map((n) => Math.floor(n)).join(', ')}`.trim() : '-'

// 하트·고기 줄 (게임처럼 10칸, 반 칸 있음)
function Bar({ value, full, half, empty }: { value: number; full: string; half: string; empty: string }) {
  return (
    <span className="pd-bar">
      {Array.from({ length: 10 }, (_, i) => {
        const v = value - i * 2
        return <span key={i}>{v >= 2 ? full : v >= 1 ? half : empty}</span>
      })}
    </span>
  )
}

// 월드에 저장된 정보: 체력, 배고픔, 레벨, 위치, 인벤토리, 엔더 상자
function PlayerSaved(props: { folderPath: string; name: string; live: boolean; header: ReactNode; onHeal: (what: 'health' | 'food') => void }) {
  const { folderPath, name, live, header, onHeal } = props
  const [data, setData] = useState<PlayerData | null | undefined>(undefined)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'inv' | 'ender'>('inv')
  // 접속 중이면 창이 열려 있는 동안 5초마다 새로 읽는다 (물을 때마다 서버 로그에 남아서 너무 자주 묻지 않는다)
  useEffect(() => {
    let alive = true
    const load = () =>
      window.api
        .getPlayerData(folderPath, name)
        .then((d) => alive && (setData(d), setError('')))
        .catch((e) => alive && setError(cleanError(e)))
    load()
    const t = live ? setInterval(load, 5000) : undefined
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [folderPath, name, live])
  // 왼쪽: 플레이어 정보, 오른쪽: 인벤토리
  const cols = (left: ReactNode, right: ReactNode) => (
    <div className="pd-cols">
      <div className="pd-left">
        {header}
        {left}
      </div>
      <div className="pd-right">{right}</div>
    </div>
  )
  if (error) return cols(null, <p className="error-text">{error}</p>)
  if (data === undefined) return cols(null, <Loading text="게임 파일을 읽는 중이에요. 처음에는 조금 걸려요." />)
  if (data === null) return cols(null, <p className="hint">이 플레이어의 저장된 정보가 없어요. 서버에 한 번 들어왔다 나가면 생겨요.</p>)
  const heal = (what: 'health' | 'food', label: string) =>
    live && (
      <button className="btn sm pd-heal" onClick={() => onHeal(what)}>
        {label}
      </button>
    )
  return cols(
    <div className="pd-info">
      <div>
        <span>체력</span>
        <span className="pd-line">
          <Bar value={Math.ceil(data.health)} full="❤️" half="💔" empty="🖤" />
          {heal('health', '체력 회복')}
        </span>
      </div>
      <div>
        <span>배고픔</span>
        <span className="pd-line">
          <Bar value={data.food} full="🍗" half="🦴" empty="▫️" />
          {heal('food', '배고픔 회복')}
        </span>
      </div>
      <div>
        <span>레벨</span>
        <b>{data.level}</b>
        <span className="pd-xp">
          <span style={{ width: `${Math.round(data.xpProgress * 100)}%` }} />
        </span>
      </div>
      <div>
        <span>게임 모드</span>
        <b>{MODES[data.gameMode] ?? '-'}</b>
      </div>
      <div>
        <span>마지막 위치</span>
        <b>{place(data.dimension, data.pos)}</b>
      </div>
      <div>
        <span>마지막 사망 위치</span>
        <b>{place(data.deathDimension, data.deathPos)}</b>
      </div>
    </div>,
    <>
      <div className="pd-inv-head">
        <div className="seg">
          <button className={tab === 'inv' ? 'active' : ''} onClick={() => setTab('inv')}>
            인벤토리
          </button>
          <button className={tab === 'ender' ? 'active' : ''} onClick={() => setTab('ender')}>
            엔더 상자
          </button>
        </div>
        {data.live ? (
          <span className="pill running">
            <span className="dot running" />
            실시간
          </span>
        ) : (
          <span className="hint">{`${new Date(data.savedAt).toLocaleString()} 저장`}</span>
        )}
      </div>
      {tab === 'inv' ? <PlayerInventory items={data.inventory} digits={data.digits} glint={data.glint} /> : <EnderChest items={data.ender} digits={data.digits} glint={data.glint} />}
    </>
  )
}

interface Props {
  folderPath: string
  record: PlayerRecord
  running: boolean
  act: (a: ManageAction, done: string) => void
  onClose: () => void
}

export default function PlayerDialog({ folderPath, record: r, running, act, onClose }: Props) {
  const live = running && r.online

  return (
    <Modal onClose={onClose}>
      <div className="pd">
        <PlayerSaved
          folderPath={folderPath}
          name={r.name}
          live={live}
          onHeal={(what) => act({ type: 'heal', name: r.name, what }, what === 'health' ? `${r.name}님의 체력을 채웠어요` : `${r.name}님의 배고픔을 채웠어요`)}
          header={
            <>
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
            </>
          }
        />
      </div>

      <div className="actions">
        <button className="btn" onClick={onClose} autoFocus>
          닫기
        </button>
      </div>
    </Modal>
  )
}
