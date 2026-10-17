import { CloudLightning, CloudRain, Crown, Gamepad2, LogOut, Megaphone, Moon, Plus, Send, ShieldCheck, Sun, Sunrise, X } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { BedrockAction, BedrockManageInfo } from '../../shared-types'
import { Empty, Loading, Modal, useToast } from './ui'
import { cleanError } from './util'

const DIFFICULTY: { value: BedrockManageInfo['difficulty']; label: string }[] = [
  { value: 'peaceful', label: '평화로움' },
  { value: 'easy', label: '쉬움' },
  { value: 'normal', label: '보통' },
  { value: 'hard', label: '어려움' }
]
const GAMEMODE: { value: BedrockManageInfo['gamemode']; label: string; emoji: string; desc: string }[] = [
  { value: 'survival', label: '서바이벌', emoji: '⛏️', desc: '자원을 모으고 살아남아요' },
  { value: 'creative', label: '크리에이티브', emoji: '🧱', desc: '블록 무한, 날 수 있어요' },
  { value: 'adventure', label: '모험', emoji: '🗺️', desc: '블록을 부술 수 없어요' }
]

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

// 배드락 서버 관리 탭: 접속자(관리자·내보내기), 허용 목록, 난이도·게임 모드·시간·날씨, 게임 규칙
export default function BedrockManageTab({ folderPath, running }: { folderPath: string; running: boolean }) {
  const toast = useToast()
  const [info, setInfo] = useState<BedrockManageInfo | null>(null)
  const [message, setMessage] = useState('')
  const [newName, setNewName] = useState('')
  const [pickMode, setPickMode] = useState(false)

  const load = useCallback(
    () =>
      window.api
        .getBedrockManage(folderPath)
        .then(setInfo)
        .catch(() => undefined),
    [folderPath]
  )

  // 접속자가 바뀌거나 서버가 켜지고 꺼질 때 새로 읽는다
  useEffect(() => {
    load()
    return window.api.onServerEvent((e) => {
      if (e.folderPath === folderPath && (e.type === 'players' || e.type === 'status')) load()
    })
  }, [folderPath, load])

  async function act(action: BedrockAction, done?: string) {
    try {
      await window.api.bedrockAction(folderPath, action)
      if (done) toast(done)
      setTimeout(load, 700) // 서버가 허용 목록·권한 파일을 고칠 시간을 준다
    } catch (e) {
      toast(cleanError(e), 'error')
    }
  }

  if (!info) return <Loading />

  return (
    <div className="manage">
      {!running && <div className="banner">서버가 켜져 있을 때 관리할 수 있어요. (허용 목록은 꺼져 있어도 고칠 수 있어요)</div>}

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
              <button className="btn primary icon" style={{ height: 48, width: 48 }} disabled={!running || !message.trim()} aria-label="보내기">
                <Send size={18} />
              </button>
            </form>
          </Card>

          <Card title={`접속 중 ${info.players.length}명`} icon={<span className={`dot ${info.players.length ? 'running' : ''}`} />}>
            {info.players.length === 0 ? (
              <Empty title={running ? '아직 아무도 없어요' : '서버가 꺼져 있어요'} hint={running ? '플레이어가 들어오면 여기에 보여요.' : undefined} />
            ) : (
              <div className="player-list scroll">
                {info.players.map((p) => (
                  <div className="player" key={p.name}>
                    <span className="sw-badge" style={{ width: 40, height: 40, borderRadius: 12, fontSize: 16, color: '#3fc1a5', background: '#3fc1a524' }}>
                      {[...p.name][0]?.toUpperCase()}
                    </span>
                    <div className="player-name" title={p.name}>
                      <span className="n">{p.name}</span>
                      {p.op && <span className="chip blue">관리자</span>}
                    </div>
                    <button
                      className={`btn icon sm ${p.op ? 'op-on' : 'ghost'}`}
                      title={p.op ? '관리자 권한 빼기' : '관리자로 만들기'}
                      onClick={() =>
                        act({ type: p.op ? 'deop' : 'op', name: p.name }, p.op ? `${p.name}님의 관리자 권한을 뺐어요` : `${p.name}님을 관리자로 만들었어요`)
                      }
                    >
                      <Crown size={16} />
                    </button>
                    <button className="btn icon sm ghost" title="내보내기" onClick={() => act({ type: 'kick', name: p.name }, `${p.name}님을 내보냈어요`)}>
                      <LogOut size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card
            title="허용 목록"
            icon={<ShieldCheck size={18} />}
            extra={
              <label className="switch" title={info.allowlistOn ? '허용 목록에 있는 사람만 들어올 수 있어요' : '누구나 들어올 수 있어요'}>
                <input
                  type="checkbox"
                  checked={info.allowlistOn}
                  onChange={(e) =>
                    act({ type: 'allowOn', value: e.target.checked }, e.target.checked ? '허용 목록에 있는 사람만 들어올 수 있어요' : '누구나 들어올 수 있어요')
                  }
                />
                <span />
              </label>
            }
          >
            <form
              className="say-form"
              onSubmit={(e) => {
                e.preventDefault()
                const n = newName.trim()
                if (!n) return
                act({ type: 'allow', name: n }, `${n}님을 허용 목록에 넣었어요`)
                setNewName('')
              }}
            >
              <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Xbox 게이머태그" maxLength={32} />
              <button className="btn primary icon" style={{ height: 48, width: 48 }} disabled={!newName.trim()} aria-label="추가">
                <Plus size={18} />
              </button>
            </form>
            {info.allowlist.length === 0 ? (
              <p className="hint" style={{ marginTop: 10 }}>
                {info.allowlistOn ? '목록이 비어 있어서 아무도 들어올 수 없어요.' : '켜면 여기에 넣은 사람만 들어올 수 있어요.'}
              </p>
            ) : (
              <div className="player-list scroll" style={{ marginTop: 10 }}>
                {info.allowlist.map((name) => (
                  <div className="player" key={name}>
                    <div className="player-name" title={name}>
                      <span className="n">{name}</span>
                    </div>
                    <button className="btn icon sm ghost" title="목록에서 빼기" onClick={() => act({ type: 'disallow', name }, `${name}님을 목록에서 뺐어요`)}>
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="manage-col">
          <Card title="난이도" icon={<span className="card-emoji">⚔️</span>}>
            <div className="seg">
              {DIFFICULTY.map((d) => (
                <button
                  key={d.value}
                  className={d.value === info.difficulty ? 'active' : ''}
                  disabled={!running}
                  onClick={() => {
                    if (d.value === info.difficulty) return
                    setInfo({ ...info, difficulty: d.value })
                    act({ type: 'difficulty', value: d.value }, `난이도를 ${d.label}(으)로 바꿨어요`)
                  }}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </Card>

          <button className="btn block mode-button" disabled={!running} onClick={() => setPickMode(true)}>
            <span className="mode-button-label">
              <Gamepad2 size={18} />
              모두의 게임 모드 바꾸기
            </span>
            <span className="mode-button-now">지금 {GAMEMODE.find((g) => g.value === info.gamemode)?.label}</span>
          </button>

          <Card title="시간 · 날씨" icon={<span className="card-emoji">🌤️</span>}>
            <div className="quick-grid">
              <button className="quick" disabled={!running} onClick={() => act({ type: 'time', value: 'day' }, '아침으로 바꿨어요')}>
                <Sunrise size={20} />
                아침
              </button>
              <button className="quick" disabled={!running} onClick={() => act({ type: 'time', value: 'noon' }, '낮으로 바꿨어요')}>
                <Sun size={20} />낮
              </button>
              <button className="quick" disabled={!running} onClick={() => act({ type: 'time', value: 'midnight' }, '밤으로 바꿨어요')}>
                <Moon size={20} />밤
              </button>
              <button className="quick" disabled={!running} onClick={() => act({ type: 'weather', value: 'clear' }, '날씨를 맑게 했어요')}>
                <Sun size={20} />
                맑음
              </button>
              <button className="quick" disabled={!running} onClick={() => act({ type: 'weather', value: 'rain' }, '비가 내리게 했어요')}>
                <CloudRain size={20} />비
              </button>
              <button className="quick" disabled={!running} onClick={() => act({ type: 'weather', value: 'thunder' }, '천둥이 치게 했어요')}>
                <CloudLightning size={20} />
                천둥
              </button>
            </div>
          </Card>
        </div>
      </div>

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
    </div>
  )
}
