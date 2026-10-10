import { Ban, CloudLightning, Gamepad2, ListChecks, ShieldCheck, CloudRain, Crown, LogOut, Megaphone, Moon, Send, Sun, Sunrise } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { Difficulty, GameMode, ManageAction, ManageInfo, PlayerRecord } from '../../shared-types'
import GameRulesDialog from './GameRulesDialog'
import PlayerDialog from './PlayerDialog'
import Select from './Select'
import { Confirm, Empty, Loading, Modal, useToast } from './ui'
import { cleanError } from './util'
import { WhitelistPanel } from './WhitelistDialog'

const DIFFICULTY: { value: Difficulty; label: string }[] = [
  { value: 'peaceful', label: '평화로움' },
  { value: 'easy', label: '쉬움' },
  { value: 'normal', label: '보통' },
  { value: 'hard', label: '어려움' }
]
const GAMEMODE: { value: GameMode; label: string; emoji: string; desc: string }[] = [
  { value: 'survival', label: '서바이벌', emoji: '⛏️', desc: '자원을 모으고 살아남아요' },
  { value: 'creative', label: '크리에이티브', emoji: '🧱', desc: '블록 무한, 날 수 있어요' },
  { value: 'adventure', label: '모험', emoji: '🗺️', desc: '블록을 부술 수 없어요' },
  { value: 'spectator', label: '관전', emoji: '👻', desc: '벽을 통과하며 구경만 해요' }
]

function Segmented<T extends string>({ value, options, onChange, disabled }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'active' : ''} onClick={() => o.value !== value && onChange(o.value)} disabled={disabled}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Card({ title, icon, children, extra }: { title: string; icon: ReactNode; children: ReactNode; extra?: ReactNode }) {
  return (
    <section className="manage-card">
      <header>
        <h3>
          {icon}
          {title}
        </h3>
        {extra}
      </header>
      {children}
    </section>
  )
}

export default function ManageTab({ folderPath, running }: { folderPath: string; running: boolean }) {
  const toast = useToast()
  const [info, setInfo] = useState<ManageInfo | null>(null)
  const [message, setMessage] = useState('')
  const [askBan, setAskBan] = useState<string | null>(null)
  const [pickMode, setPickMode] = useState(false)
  const [showRules, setShowRules] = useState(false)
  const [history, setHistory] = useState<PlayerRecord[]>([])
  const [openPlayer, setOpenPlayer] = useState<string | null>(null)

  const load = useCallback(() => {
    window.api.getPlayerHistory(folderPath).then(setHistory).catch(() => undefined)
    return window.api.getManageInfo(folderPath).then(setInfo)
  }, [folderPath])

  // 접속자가 바뀌거나 서버가 켜지고 꺼질 때 새로 읽는다
  useEffect(() => {
    load()
    return window.api.onServerEvent((e) => {
      if (e.folderPath === folderPath && (e.type === 'players' || e.type === 'status')) load()
    })
  }, [folderPath, load])

  async function act(action: ManageAction, done?: string) {
    try {
      await window.api.manage(folderPath, action)
      if (done) toast(done)
      setTimeout(load, 700) // 서버가 ops.json 같은 파일을 고칠 시간을 준다
    } catch (e) {
      toast(cleanError(e), 'error')
    }
  }

  if (!info) return <Loading />

  return (
    <div className="manage">
      {!running && <div className="banner">서버가 켜져 있을 때 관리할 수 있어요.</div>}

      <div className="manage-grid">
        <div className="manage-col">
          <Card title="공지 보내기" icon={<Megaphone size={18} />}>
            <form
              className="say-form"
              onSubmit={(e) => {
                e.preventDefault()
                if (!message.trim()) return
                act({ type: 'say', text: message }, '공지를 보냈어요')
                setMessage('')
              }}
            >
              <input
                className="input"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={running ? '모두에게 보낼 메시지' : '서버가 켜져 있을 때 보낼 수 있어요'}
                disabled={!running}
                maxLength={200}
              />
              {message.length > 150 && <span className="hint say-count">{`${message.length}/200`}</span>}
              <button className="btn primary icon" style={{ height: 48, width: 48 }} disabled={!running || !message.trim()} aria-label="보내기">
                <Send size={18} />
              </button>
            </form>
          </Card>

          <Card title={`접속 중 ${info.players.length}명`} icon={<span className={`dot ${info.players.length ? 'running' : ''}`} />}>
            {info.players.length === 0 ? (
              <Empty title={running ? '아직 아무도 없어요' : '서버가 꺼져 있어요'} hint={running ? '플레이어가 들어오면 여기에 보여요.' : undefined} />
            ) : (
              <div className="player-list">
                {info.players.map((p) => (
                  <div className="player" key={p.name}>
                    <img src={`https://mc-heads.net/avatar/${p.name}/40`} alt="" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                    <button className="player-name linkish" title={`${p.name} 정보 보기`} onClick={() => setOpenPlayer(p.name)}>
                      <span className="n">{p.name}</span>
                      {p.op && <span className="chip blue">관리자</span>}
                    </button>
                    <div className="player-mode">
                      <Select
                        value=""
                        placeholder="게임 모드"
                        options={GAMEMODE}
                        onChange={(v) => act({ type: 'gamemode', name: p.name, value: v as GameMode }, `${p.name}님을 ${GAMEMODE.find((g) => g.value === v)?.label} 모드로 바꿨어요`)}
                      />
                    </div>
                    <button
                      className={`btn icon sm ${p.op ? 'op-on' : 'ghost'}`}
                      title={p.op ? '관리자 권한 빼기' : '관리자로 만들기'}
                      onClick={() => act({ type: p.op ? 'deop' : 'op', name: p.name }, p.op ? `${p.name}님의 관리자 권한을 뺐어요` : `${p.name}님을 관리자로 만들었어요`)}
                    >
                      <Crown size={16} />
                    </button>
                    <button className="btn icon sm ghost" title="내보내기" onClick={() => act({ type: 'kick', name: p.name }, `${p.name}님을 내보냈어요`)}>
                      <LogOut size={16} />
                    </button>
                    <button className="btn icon sm ghost danger-hover" title="차단" onClick={() => setAskBan(p.name)}>
                      <Ban size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {info.banned.length > 0 && (
            <Card title={`차단한 사람 ${info.banned.length}명`} icon={<Ban size={18} />}>
              <div className="player-list">
                {info.banned.map((name) => (
                  <div className="player" key={name}>
                    <img src={`https://mc-heads.net/avatar/${name}/40`} alt="" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                    <div className="player-name" title={name}>
                      <span className="n">{name}</span>
                    </div>
                    <button className="btn sm" onClick={() => act({ type: 'pardon', name }, `${name}님의 차단을 풀었어요`)}>
                      차단 풀기
                    </button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card title="화이트리스트" icon={<ShieldCheck size={18} />}>
            <WhitelistPanel folderPath={folderPath} />
          </Card>
        </div>

        <div className="manage-col">
          <Card title="난이도" icon={<span className="card-emoji">⚔️</span>}>
            <Segmented
              value={info.difficulty}
              options={DIFFICULTY}
              disabled={!running}
              onChange={(v) => {
                setInfo({ ...info, difficulty: v })
                act({ type: 'difficulty', value: v }, `난이도를 ${DIFFICULTY.find((d) => d.value === v)?.label}(으)로 바꿨어요`)
              }}
            />
          </Card>

          <button className="btn block mode-button" disabled={!running} onClick={() => setPickMode(true)}>
            <span className="mode-button-label">
              <Gamepad2 size={18} />
              모두의 게임 모드 바꾸기
            </span>
            <span className="mode-button-now">
              지금 {GAMEMODE.find((g) => g.value === info.gamemode)?.label}
            </span>
          </button>

          <Card title="시간 · 날씨" icon={<span className="card-emoji">🌤️</span>}>
            <div className="quick-grid">
              <button className="quick" disabled={!running} onClick={() => act({ type: 'time', value: 'day' }, '아침으로 바꿨어요')}>
                <Sunrise size={20} />
                아침
              </button>
              <button className="quick" disabled={!running} onClick={() => act({ type: 'time', value: 'noon' }, '낮으로 바꿨어요')}>
                <Sun size={20} />
                낮
              </button>
              <button className="quick" disabled={!running} onClick={() => act({ type: 'time', value: 'midnight' }, '밤으로 바꿨어요')}>
                <Moon size={20} />
                밤
              </button>
              <button className="quick" disabled={!running} onClick={() => act({ type: 'weather', value: 'clear' }, '날씨를 맑게 했어요')}>
                <Sun size={20} />
                맑음
              </button>
              <button className="quick" disabled={!running} onClick={() => act({ type: 'weather', value: 'rain' }, '비가 내리게 했어요')}>
                <CloudRain size={20} />
                비
              </button>
              <button className="quick" disabled={!running} onClick={() => act({ type: 'weather', value: 'thunder' }, '천둥이 치게 했어요')}>
                <CloudLightning size={20} />
                천둥
              </button>
            </div>
          </Card>

          <button className="btn block mode-button" disabled={!running} onClick={() => setShowRules(true)}>
            <span className="mode-button-label">
              <ListChecks size={18} />
              게임 규칙
            </span>
            <span className="mode-button-now">죽어도 아이템 유지, PvP 등</span>
          </button>
        </div>
      </div>

      {showRules && <GameRulesDialog folderPath={folderPath} onClose={() => setShowRules(false)} />}
      {pickMode && (
        <Modal onClose={() => setPickMode(false)}>
          <h2>게임 모드 바꾸기</h2>
          <p className="body">지금 접속한 모든 사람과, 앞으로 들어올 사람의 게임 모드가 바뀌어요.</p>
          <div className="mode-grid">
            {GAMEMODE.map((g) => (
              <button
                key={g.value}
                className={`mode-card ${info.gamemode === g.value ? 'active' : ''}`}
                onClick={() => {
                  setPickMode(false)
                  setInfo({ ...info, gamemode: g.value })
                  act({ type: 'gamemodeAll', value: g.value }, `모두 ${g.label} 모드로 바꿨어요`)
                }}
              >
                <span className="mode-emoji">{g.emoji}</span>
                <b>{g.label}</b>
                <span className="hint">{g.desc}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {askBan && (
        <Confirm
          title={`${askBan}님을 차단할까요?`}
          body="차단하면 서버에서 내보내지고 다시 들어올 수 없어요. 나중에 차단 목록에서 풀 수 있어요."
          confirmText="차단하기"
          danger
          onCancel={() => setAskBan(null)}
          onConfirm={() => {
            act({ type: 'ban', name: askBan }, `${askBan}님을 차단했어요`)
            setAskBan(null)
          }}
        />
      )}
      {openPlayer && (
        <PlayerDialog
          record={history.find((h) => h.name === openPlayer) ?? { name: openPlayer, online: true, firstSeen: Date.now(), lastSeen: Date.now(), joins: 1, playMs: 0 }}
          others={info.players.map((p) => p.name).filter((n) => n !== openPlayer)}
          running={running}
          act={act}
          onClose={() => setOpenPlayer(null)}
        />
      )}
    </div>
  )
}
