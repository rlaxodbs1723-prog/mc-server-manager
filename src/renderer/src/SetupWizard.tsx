import { AlertCircle, ArrowLeft, Check } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useMouseBack } from './mouseback'
import { SOFTWARE_INFO, type LoaderVersion, type McVersion, type SaveWorld, type Software } from '../../shared-types'
import Select from './Select'
import { WorldSource } from './ImportWorldDialog'
import { useTasks } from './tasks'
import { Modal, SoftwareBadge } from './ui'
import { cleanError } from './util'

interface Props {
  software: Software
  existingNames: string[] // 이름이 겹치지 않게
  onClose: () => void
}

const GAMEMODES = [
  { value: 'survival', label: '서바이벌', emoji: '⛏️', desc: '자원을 모으고 살아남아요' },
  { value: 'creative', label: '크리에이티브', emoji: '🧱', desc: '블록 무한, 날 수 있어요' },
  { value: 'adventure', label: '모험', emoji: '🗺️', desc: '블록을 부술 수 없어요' },
  { value: 'spectator', label: '관전', emoji: '👻', desc: '구경만 해요' }
]
const DIFFICULTIES = [
  { value: 'peaceful', label: '평화로움' },
  { value: 'easy', label: '쉬움' },
  { value: 'normal', label: '보통' },
  { value: 'hard', label: '어려움' }
]
const LEVEL_TYPES = [
  { value: 'minecraft:normal', label: '기본' },
  { value: 'minecraft:flat', label: '평지' },
  { value: 'minecraft:large_biomes', label: '큰 바이옴' },
  { value: 'minecraft:amplified', label: '증폭 (높은 산)' }
]

const STEPS = ['기본 정보', '게임 방식', '월드', '접속']

// 폴더 이름으로 쓸 때 겹치는지 보기 위해 대소문자·앞뒤 공백을 무시한다
const norm = (s: string) => s.trim().toLowerCase()

function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <label className="reset-row">
      <span>
        <b>{title}</b>
        {hint && <span className="hint">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <span className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      <span />
    </span>
  )
}

// 서버 종류를 고르면 뜨는 창. 기본 정보 → 게임 방식 → 월드 → 접속 순서로 정하고 서버를 만든다.
export default function SetupWizard({ software, existingNames, onClose }: Props) {
  const info = SOFTWARE_INFO[software]
  const isBuild = software === 'paper' || software === 'purpur'
  const [step, setStep] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  // 마우스 뒤로 버튼: 이전 단계로, 첫 단계면 닫기
  useMouseBack(rootRef, () => (step > 0 ? setStep(step - 1) : onClose()))

  // 1단계: 기본 정보
  const [versions, setVersions] = useState<McVersion[]>([])
  const [includeSnapshots, setIncludeSnapshots] = useState(false)
  const [version, setVersion] = useState('')
  const [loaderVersions, setLoaderVersions] = useState<LoaderVersion[] | null>(null) // null이면 불러오는 중
  const [loaderVersion, setLoaderVersion] = useState('')
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false) // 직접 고쳤으면 버전을 바꿔도 이름을 덮어쓰지 않는다
  const [loadError, setLoadError] = useState('')

  // 2~4단계
  const [gamemode, setGamemode] = useState('survival')
  const [difficulty, setDifficulty] = useState('easy')
  const [hardcore, setHardcore] = useState(false)
  const [levelType, setLevelType] = useState('minecraft:normal')
  const [structures, setStructures] = useState(true)
  const [seed, setSeed] = useState('')
  const [maxPlayers, setMaxPlayers] = useState('10')
  const [motd, setMotd] = useState('')
  const [onlineMode, setOnlineMode] = useState(true)
  const [whitelist, setWhitelist] = useState(false)

  const { tasks, startCreate } = useTasks()
  const [importWorld, setImportWorld] = useState<SaveWorld | null>(null)

  const taken = new Set([...existingNames, ...tasks.filter((t) => t.status === 'running').map((t) => t.options?.name ?? '')].map(norm))
  const uniqueName = (base: string) => {
    if (!taken.has(norm(base))) return base
    for (let i = 2; ; i++) if (!taken.has(norm(`${base} (${i})`))) return `${base} (${i})`
  }

  useEffect(() => {
    setLoadError('')
    window.api
      .getVersions(includeSnapshots)
      .then((list) => {
        setVersions(list)
        setVersion((v) => (list.some((x) => x.id === v) ? v : (list[0]?.id ?? '')))
      })
      .catch((e) => setLoadError(`버전 목록을 불러오지 못했어요. 인터넷 연결을 확인해 주세요. (${cleanError(e)})`))
  }, [includeSnapshots])

  // 버전이 바뀌면 이름을 따라 바꾸고, 그 버전의 로더/빌드 목록을 불러온다
  useEffect(() => {
    if (!version) return
    if (!nameTouched) setName(uniqueName(`${info.label} ${version}`))
    if (software === 'vanilla') return
    let alive = true
    setLoaderVersions(null)
    setLoaderVersion('')
    window.api
      .getLoaderVersions(software, version)
      .then((list) => {
        if (!alive) return
        setLoaderVersions(list)
        setLoaderVersion(list[0]?.version ?? '')
      })
      .catch((e) => {
        if (!alive) return
        setLoaderVersions([])
        setLoadError(`${info.label} 정보를 불러오지 못했어요. (${cleanError(e)})`)
      })
    return () => {
      alive = false
    }
  }, [software, version]) // eslint-disable-line react-hooks/exhaustive-deps

  const unsupported = software !== 'vanilla' && loaderVersions !== null && loaderVersions.length === 0
  const nameTaken = taken.has(norm(name))
  const step1Ok = !!name.trim() && !nameTaken && !!version && !unsupported && (software === 'vanilla' || !!loaderVersion)
  const last = step === STEPS.length - 1

  // 서버 만들기는 뒤에서 진행하고(오른쪽 위 팝업), 이 창은 바로 닫는다
  function create() {
    const serverName = name.trim()
    startCreate({
      name: serverName,
      software,
      mcVersion: version,
      loaderVersion: software === 'vanilla' ? undefined : loaderVersion,
      properties: {
        gamemode,
        difficulty: hardcore ? 'hard' : difficulty, // 하드코어는 어려움으로 고정된다
        hardcore: String(hardcore),
        'level-type': levelType,
        'generate-structures': String(structures),
        'level-seed': seed.trim(),
        'max-players': String(Math.min(500, Math.max(1, Math.round(Number(maxPlayers) || 10)))),
        motd: motd.trim() || serverName,
        'online-mode': String(onlineMode),
        'white-list': String(whitelist)
      },
      importWorldFrom: importWorld?.path
    })
    onClose()
  }

  return (
    <Modal onClose={onClose}>
      <div ref={rootRef} style={{ display: 'contents' }}>
      <div className="wizard-steps">
        {STEPS.map((s, i) => (
          <div key={s} className={`wizard-step ${i === step ? 'active' : i < step ? 'done' : ''}`}>
            <span className="num">{i < step ? <Check size={13} strokeWidth={3} /> : i + 1}</span>
            {s}
          </div>
        ))}
      </div>

      {step === 0 && (
        <>
          <div className="wizard-title">
            <SoftwareBadge software={software} size={44} name={name} />
            <div>
              {/* 입력하는 이름을 바로 보여 준다. 비어 있으면 종류 이름으로 */}
              <h2 className="wizard-name">{name.trim() || `${info.label} 서버`}</h2>
              <p className="hint">
                {info.label} · {info.description}
              </p>
            </div>
          </div>
          <div className="reset-fields">
            <div>
              <div className="label">서버 이름</div>
              <input
                className="input"
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setNameTouched(true)
                }}
                maxLength={60}
                placeholder="예: 야생 서버"
                autoFocus
              />
              {/* 다음 버튼이 왜 안 눌리는지 알 수 있게 이유를 보여 준다 */}
              {nameTouched && !name.trim() && <p className="error-text" style={{ marginTop: 6 }}>서버 이름을 입력해 주세요.</p>}
              {nameTaken && <p className="error-text" style={{ marginTop: 6 }}>같은 이름의 서버가 이미 있어요. 다른 이름을 써 주세요.</p>}
            </div>
            <div>
              <div className="label">마인크래프트 버전</div>
              <Select
                value={version}
                onChange={setVersion}
                disabled={!versions.length}
                placeholder="불러오는 중…"
                searchPlaceholder="버전 검색 (예: 1.20)"
                options={versions.map((v, i) => ({
                  value: v.id,
                  label: v.id,
                  tag: v.type === 'snapshot' ? '스냅샷' : i === 0 ? '최신' : undefined
                }))}
              />
            </div>
            {software !== 'vanilla' && (
              <div>
                <div className="label">{isBuild ? `${info.label} 빌드` : `${info.label} 버전`}</div>
                <Select
                  value={loaderVersion}
                  onChange={setLoaderVersion}
                  disabled={!loaderVersions?.length}
                  placeholder={loaderVersions === null ? '불러오는 중…' : '지원하는 버전이 없어요'}
                  searchPlaceholder="버전 검색"
                  options={(loaderVersions ?? []).map((l, i) => ({
                    value: l.version,
                    label: isBuild ? `#${l.version}` : l.version,
                    tag: !l.stable ? '베타' : i === 0 ? '추천' : undefined
                  }))}
                />
              </div>
            )}
            <label className="check-row">
              <span className="switch">
                <input type="checkbox" checked={includeSnapshots} onChange={(e) => setIncludeSnapshots(e.target.checked)} />
                <span />
              </span>
              스냅샷(개발 중인 버전)도 보여 주기
            </label>
            {unsupported && (
              <div className="notice-box">
                <AlertCircle size={18} />
                {info.label}은(는) 마인크래프트 {version}을(를) 아직 지원하지 않아요. 다른 버전을 골라 주세요.
              </div>
            )}
            {loadError && <p className="error-text">{loadError}</p>}
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <h2>어떻게 플레이할까요?</h2>
          <div className="mode-grid" style={{ marginTop: 14 }}>
            {GAMEMODES.map((g) => (
              <button key={g.value} className={`mode-card ${gamemode === g.value ? 'active' : ''}`} onClick={() => setGamemode(g.value)}>
                <span className="mode-emoji">{g.emoji}</span>
                <b>{g.label}</b>
                <span className="hint">{g.desc}</span>
              </button>
            ))}
          </div>
          <div className="reset-fields">
            <div>
              <div className="label">난이도</div>
              <div className="seg">
                {DIFFICULTIES.map((d) => (
                  <button key={d.value} className={difficulty === d.value && !hardcore ? 'active' : ''} onClick={() => setDifficulty(d.value)} disabled={hardcore}>
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
            <Row title="하드코어" hint="죽으면 다시 살아날 수 없어요 (난이도는 어려움)">
              <Switch checked={hardcore} onChange={setHardcore} />
            </Row>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <h2>어떤 월드로 시작할까요?</h2>
          <WorldSource serverVersion={version} picked={importWorld} onChange={setImportWorld}>
          <div className="reset-fields">
            <div>
              <div className="label">월드 종류</div>
              <Select value={levelType} onChange={setLevelType} options={LEVEL_TYPES} />
            </div>
            <Row title="구조물 만들기" hint="마을, 신전 같은 구조물이 생겨요">
              <Switch checked={structures} onChange={setStructures} />
            </Row>
            <div>
              <div className="label">시드</div>
              <input className="input" value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="비워 두면 무작위" maxLength={64} />
            </div>
          </div>
          </WorldSource>
        </>
      )}

      {step === 3 && (
        <>
          <h2>누가 들어올 수 있나요?</h2>
          <div className="reset-fields">
            <div className="form-row">
              <div>
                <div className="label">
                  최대 인원 <span className="muted">{'1 ~ 500'}</span>
                </div>
                <div className="num-input">
                  <input type="number" className="input" style={{ width: '100%' }} value={maxPlayers} min={1} max={500} onChange={(e) => setMaxPlayers(e.target.value)} onBlur={() => setMaxPlayers(String(Math.min(500, Math.max(1, Math.round(Number(maxPlayers) || 10)))))} />
                  <span>명</span>
                </div>
              </div>
              <div>
                <div className="label">서버 설명</div>
                <input className="input" style={{ height: 42 }} value={motd} placeholder={name.trim()} onChange={(e) => setMotd(e.target.value)} maxLength={60} />
              </div>
            </div>
            <Row title="정품 인증" hint="끄면 정품이 아닌 계정도 들어올 수 있지만 위험해요">
              <Switch checked={onlineMode} onChange={setOnlineMode} />
            </Row>
            <Row title="화이트리스트" hint="허락한 사람만 들어오게 해요. 목록은 서버 설정에서 관리해요">
              <Switch checked={whitelist} onChange={setWhitelist} />
            </Row>
          </div>
        </>
      )}

      <div className="actions">
        {step === 0 ? (
          <button className="btn" onClick={onClose}>
            취소
          </button>
        ) : (
          <button className="btn" onClick={() => setStep(step - 1)}>
            <ArrowLeft size={16} />
            이전
          </button>
        )}
        <button className="btn primary" onClick={() => (last ? create() : setStep(step + 1))} disabled={step === 0 && !step1Ok}>
          {last ? '서버 만들기' : '다음'}
        </button>
      </div>
      </div>
    </Modal>
  )
}
