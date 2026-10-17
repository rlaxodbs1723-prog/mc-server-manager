import { Cpu, Layers, RefreshCw, Save, Swords, Timer, Users, X, type LucideIcon } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { DEFAULT_AUTOMATION, type BedrockUpdateInfo, type ServerAutomation } from '../../shared-types'
import { useTasks } from './tasks'
import { FieldRow, valueOf, type Field } from './SettingsDialog'
import { Confirm, useToast } from './ui'
import { cleanError } from './util'

const sel = (v: string, l: string) => ({ value: v, label: l })

const TABS: { title: string; icon: LucideIcon; fields: Field[] }[] = [
  { title: '버전', icon: Layers, fields: [] },
  {
    title: '게임',
    icon: Swords,
    fields: [
      { key: 'server-name', label: '서버 설명', desc: '마인크래프트 서버 목록에서 서버 이름 아래에 보이는 문구예요.', type: 'text', def: '' },
      {
        key: 'default-player-permission-level',
        label: '새로 들어온 사람의 권한',
        desc: '처음 들어온 사람에게 줄 권한이에요. 방문자는 구경만 할 수 있어요.',
        type: 'select',
        def: 'member',
        options: [sel('visitor', '방문자 (구경만)'), sel('member', '멤버 (일반)'), sel('operator', '관리자')]
      },
      { key: 'force-gamemode', label: '접속할 때 게임 모드 맞추기', desc: '들어올 때마다 서버의 기본 게임 모드로 바꿔요.', type: 'bool', def: false },
      { key: 'disable-player-interaction', label: '플레이어끼리 상호작용 막기', desc: '서로 때리거나 건드릴 수 없어요.', type: 'bool', def: false },
      { key: 'texturepack-required', label: '리소스팩 필수', desc: '서버의 리소스팩을 받지 않으면 입장할 수 없어요.', type: 'bool', def: false },
      { key: 'disable-custom-skins', label: '커스텀 스킨 막기', desc: '모두 기본 스킨으로 보여요.', type: 'bool', def: false }
    ]
  },
  {
    title: '접속',
    icon: Users,
    fields: [
      { key: 'max-players', label: '최대 인원', type: 'number', def: 10, min: 1, max: 200, unit: '명' },
      { key: 'online-mode', label: 'Xbox 로그인 필요', desc: '켜면 Xbox 계정으로 로그인한 사람만 들어올 수 있어요.', type: 'bool', def: true },
      { key: 'allow-list', label: '허용 목록만 입장', desc: '관리 탭에서 사람을 추가해요.', type: 'bool', def: false },
      { key: 'allow-cheats', label: '치트 허용', desc: '명령어(/gamemode 등)를 쓸 수 있어요.', type: 'bool', def: false },
      { key: 'player-idle-timeout', label: '가만히 있으면 내보내기', desc: '0이면 내보내지 않아요.', type: 'number', def: 30, min: 0, max: 1440, unit: '분' },
      {
        key: 'chat-restriction',
        label: '채팅 제한',
        type: 'select',
        def: 'None',
        options: [sel('None', '제한 없음'), sel('Dropped', '채팅 막기'), sel('Disabled', '채팅 끄기')]
      }
    ]
  },
  { title: '자동', icon: Timer, fields: [] },
  {
    title: '성능',
    icon: Cpu,
    fields: [
      { key: 'view-distance', label: '시야 거리', desc: '클수록 멀리 보이지만 컴퓨터가 힘들어해요.', type: 'number', def: 32, min: 5, max: 96, unit: '청크' },
      {
        key: 'tick-distance',
        label: '시뮬레이션 거리',
        desc: '플레이어 주변에서 몹·작물이 움직이는 범위예요.',
        type: 'number',
        def: 4,
        min: 4,
        max: 12,
        unit: '청크'
      },
      {
        key: 'server-authoritative-movement',
        label: '이동 판정',
        desc: '서버 판정은 이동 핵을 막아 줘요. 렉이 심하면 클라이언트 판정으로 바꾸세요.',
        type: 'select',
        def: 'server-auth',
        options: [sel('server-auth', '서버 판정'), sel('server-auth-with-rewind', '서버 판정 (되감기)'), sel('client-auth', '클라이언트 판정')]
      }
    ]
  }
]

// 배드락 서버 설정: server.properties의 자주 쓰는 항목, 서버 업데이트, 자동 동작 (월드 가져오기·리셋·게임 규칙은 맵 탭)
export default function BedrockSettingsDialog({
  folderPath,
  serverOn,
  onChanged,
  onClose
}: {
  folderPath: string
  serverOn: boolean
  onChanged: () => void
  onClose: () => void
}) {
  const toast = useToast()
  const { runJob } = useTasks()
  const [saved, setSaved] = useState<Record<string, string> | null>(null)
  const [edit, setEdit] = useState<Record<string, string>>({})
  const [automation, setAutomation] = useState<ServerAutomation>(DEFAULT_AUTOMATION)
  const [autoEdit, setAutoEdit] = useState<Partial<ServerAutomation>>({})
  const [autoRestart, setAutoRestart] = useState<boolean | null>(null)
  const [savedRestart, setSavedRestart] = useState(true)
  const [askUpdate, setAskUpdate] = useState(false)
  const [update, setUpdate] = useState<BedrockUpdateInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState('버전')

  const load = () =>
    window.api
      .getSettings(folderPath)
      .then((s) => {
        setSaved(s.properties)
        setAutomation(s.automation)
        setSavedRestart(s.autoRestart)
      })
      .catch((e) => toast(cleanError(e), 'error'))

  useEffect(() => {
    load()
    window.api
      .checkBedrockUpdate(folderPath)
      .then(setUpdate)
      .catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderPath])

  const set = (k: string, v: string): void =>
    setEdit((cur) => {
      const next = { ...cur, [k]: v }
      if ((saved?.[k] ?? '') === v) delete next[k]
      return next
    })
  const auto = { ...automation, ...autoEdit }
  const setAuto = (patch: Partial<ServerAutomation>): void =>
    setAutoEdit((cur) => {
      const next = { ...cur, ...patch }
      for (const k of Object.keys(next) as (keyof ServerAutomation)[]) if (next[k] === automation[k]) delete next[k]
      return next
    })
  const dirty = Object.keys(edit).length > 0 || Object.keys(autoEdit).length > 0 || autoRestart != null

  async function save() {
    setBusy(true)
    try {
      await window.api.saveSettings(folderPath, {
        ...(Object.keys(edit).length && { properties: edit }),
        ...(Object.keys(autoEdit).length && { automation: autoEdit as ServerAutomation }),
        ...(autoRestart != null && { autoRestart })
      })
      toast(serverOn ? '저장했어요. 서버를 다시 켜면 적용돼요' : '저장했어요')
      onClose()
    } catch (e) {
      toast(cleanError(e), 'error')
      setBusy(false)
    }
  }

  async function runUpdate() {
    setAskUpdate(false)
    try {
      const info = await runJob(folderPath, '서버 업데이트', '업데이트했어요', () => window.api.updateBedrock(folderPath))
      toast(`${info.mcVersion} 버전으로 업데이트했어요`)
      setUpdate({ current: info.mcVersion, latest: info.mcVersion, available: false })
      onChanged()
    } catch (e) {
      toast(cleanError(e), 'error')
    }
  }

  const tabFields = TABS.find((t) => t.title === tab)?.fields ?? []
  const changedIn = (title: string): boolean =>
    (TABS.find((t) => t.title === title)?.fields ?? []).some((f) => f.key in edit) ||
    (title === '자동' && (Object.keys(autoEdit).length > 0 || autoRestart != null))

  const autoRow = (key: string, label: string, control: ReactNode, desc?: string, col?: boolean) => (
    <div className={`setting-row ${col ? 'col' : ''} ${key in autoEdit || (key === 'autoRestart' && autoRestart != null) ? 'changed' : ''}`}>
      <div className="setting-text">
        <div className="setting-label">{label}</div>
        {desc && <div className="setting-desc">{desc}</div>}
      </div>
      {control}
    </div>
  )

  let content: ReactNode = null
  if (!saved) content = <p className="hint">불러오는 중…</p>
  else if (tab === '버전') {
    content = (
      <div className="setting-row">
        <div className="setting-text">
          <div className="setting-label">서버 버전</div>
          <div className="setting-desc">
            {update
              ? update.available
                ? `${update.current} → 새 버전 ${update.latest}이 나왔어요. 폰의 게임이 먼저 올라가면 접속이 안 돼요`
                : `${update.current} · 최신 버전이에요`
              : '확인하는 중…'}
          </div>
        </div>
        <button
          type="button"
          className={`btn ${update?.available ? 'primary' : ''}`}
          disabled={serverOn || !update?.available}
          onClick={() => setAskUpdate(true)}
          title={serverOn ? '서버를 끈 다음에 할 수 있어요' : undefined}
        >
          <RefreshCw size={16} />
          업데이트
        </button>
      </div>
    )
  } else if (tab === '자동') {
    content = (
      <>
        {autoRow(
          'autoRestart',
          '튕기면 자동으로 다시 켜기',
          <label className="switch">
            <input
              type="checkbox"
              checked={autoRestart ?? savedRestart}
              onChange={(e) => setAutoRestart(e.target.checked === savedRestart ? null : e.target.checked)}
            />
            <span />
          </label>,
          '5초 뒤에 다시 켜요. 10분 안에 3번 넘게 튕기면 멈춰요.'
        )}
        {autoRow(
          'autoStart',
          '앱을 켜면 서버도 켜기',
          <label className="switch">
            <input type="checkbox" checked={auto.autoStart} onChange={(e) => setAuto({ autoStart: e.target.checked })} />
            <span />
          </label>
        )}
        {autoRow(
          'emptyStopMin',
          '아무도 없으면 끄기',
          <div className="num-input">
            <input
              type="number"
              className="input"
              value={auto.emptyStopMin}
              min={0}
              max={1440}
              onChange={(e) => setAuto({ emptyStopMin: Math.max(0, Math.min(1440, Math.round(Number(e.target.value) || 0))) })}
            />
            <span>분</span>
          </div>,
          '0이면 끄지 않아요.'
        )}
        {autoRow(
          'welcome',
          '환영 메시지',
          <input
            className="input"
            style={{ width: 260 }}
            value={auto.welcome}
            maxLength={200}
            onChange={(e) => setAuto({ welcome: e.target.value })}
            placeholder="어서 와요, {name}!"
          />,
          '{name}은 들어온 사람의 이름으로 바뀌어요.'
        )}
      </>
    )
  } else {
    content = (
      <>
        {tabFields.map((f) => (
          <FieldRow key={f.key} field={f} value={edit[f.key] ?? valueOf(f, saved)} changed={f.key in edit} onChange={(v) => set(f.key, v)} />
        ))}
      </>
    )
  }

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="settings-modal" role="dialog" aria-modal="true">
        <nav className="settings-nav">
          <h2>서버 설정</h2>
          {TABS.map((t) => (
            <button key={t.title} className={tab === t.title ? 'active' : ''} onClick={() => setTab(t.title)}>
              <t.icon size={18} />
              {t.title}
              {changedIn(t.title) && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <section className="settings-body">
          <header>
            <h3>{tab}</h3>
            <button className="btn icon sm ghost" onClick={onClose} aria-label="닫기">
              <X size={18} />
            </button>
          </header>
          <div className="settings-content">{content}</div>
          <footer>
            <span className="hint">{dirty ? (serverOn ? '바뀐 설정은 서버를 다시 켜면 적용돼요' : '바뀐 설정이 있어요') : ''}</span>
            <button className="btn primary" onClick={save} disabled={!dirty || busy}>
              {busy ? <span className="spinner" /> : <Save size={16} />}
              저장하기
            </button>
          </footer>
        </section>
      </div>
      {askUpdate && update?.latest && (
        <Confirm
          title={`${update.latest} 버전으로 업데이트할까요?`}
          body="월드를 먼저 백업하고, 서버 프로그램 파일만 새 버전으로 바꿔요. 설정·월드·허용 목록·애드온은 그대로예요."
          confirmText="업데이트"
          onConfirm={runUpdate}
          onCancel={() => setAskUpdate(false)}
        />
      )}
    </div>
  )
}
