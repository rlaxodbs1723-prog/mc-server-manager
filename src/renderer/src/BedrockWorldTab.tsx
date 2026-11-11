import { Download, FolderInput, Globe2, ListChecks, RotateCcw, Search, SearchX } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { BedrockExperiment, BedrockHit, GameRule } from '../../shared-types'
import { labelOf } from './gameruleLabels'
import DropZone from './DropZone'
import GameRulesDialog from './GameRulesDialog'
import { useTasks } from './tasks'
import { Empty, Loading, Modal, Skeleton, useToast } from './ui'
import { cleanError } from './util'

const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n))

// 배드락에서 자주 쓰는 게임 규칙 (이름은 대소문자를 가리지 않는다). 서버가 켜져 있을 때 스위치로 바로 바꾼다
// 위쪽 셋은 자바 월드 탭과 같은 순서로 맨 위에 둔다 (배드락에는 네더 허용 규칙이 없다)
const TOP_RULES = ['pvp', 'domobspawning', 'commandblocksenabled']
const QUICK_RULES = [...TOP_RULES, 'mobgriefing', 'keepinventory', 'dodaylightcycle']
// 스위치 하나로 여러 규칙을 같이 바꾼다: 몹 생성은 팬텀(doInsomnia)까지 한꺼번에 꺼지게 한다 (그 서버에 있는 규칙만)
const GROUP: Record<string, string[]> = { domobspawning: ['domobspawning', 'doinsomnia'] }
const QUICK_TEXT: Record<string, { label: string; desc: string }> = {
  domobspawning: { label: '몹 생성', desc: '끄면 몬스터·동물 등 모든 몹이 자연스럽게 생기지 않아요' },
  commandblocksenabled: { label: '명령 블록 사용', desc: '명령 블록을 설치하고 작동시킬 수 있어요.' }
}

// 실험적 기능 이름과 설명 (모르는 이름은 그대로 보여 준다)
const EXPERIMENT_INFO: Record<string, { label: string; desc: string }> = {
  gametest: { label: '베타 API', desc: '스크립트를 쓰는 애드온 대부분이 이걸 켜야 작동해요.' },
  upcoming_creator_features: { label: '예정된 제작자 기능', desc: '아직 정식으로 나오지 않은 애드온 기능을 써요.' },
  experimental_creator_cameras: { label: '실험적 카메라', desc: '애드온이 카메라 시점을 바꾸는 기능을 써요.' },
  villager_trades_rebalance: { label: '주민 거래 개편', desc: '바뀔 예정인 주민 거래 방식을 미리 써요.' },
  jigsaw_structures: { label: '직소 구조물', desc: '애드온이 새 구조물을 만드는 기능을 써요.' }
}

// 배드락 월드 탭: 자바 월드 탭과 같은 짜임. 왼쪽은 지금 월드·월드 리셋(새 월드·내 월드·맵 다운로드)·실험적 기능, 오른쪽은 월드 설정(게임 규칙).
// 월드 파일(.mcworld/.zip)을 탭에 끌어다 놓아도 가져온다
export default function BedrockWorldTab({ folderPath, serverOn }: { folderPath: string; serverOn: boolean }) {
  const toast = useToast()
  const { runJob } = useTasks()
  const [worldName, setWorldName] = useState('')
  const [worldExists, setWorldExists] = useState(false)
  const [seed, setSeed] = useState('')
  const [showReset, setShowReset] = useState(false)
  const [showRules, setShowRules] = useState(false)
  const [rules, setRules] = useState<GameRule[] | null>(null)
  const [experiments, setExperiments] = useState<{ ready: boolean; items: BedrockExperiment[]; hardcore: boolean } | null>(null)
  const [expBusy, setExpBusy] = useState('')

  const loadWorld = useCallback(() => {
    window.api
      .getSettings(folderPath)
      .then((s) => {
        setWorldName(s.properties['level-name'] || 'Bedrock level')
        setWorldExists(s.worldExists)
        setSeed(s.properties['level-seed'] ?? '')
      })
      .catch(() => undefined)
    window.api.getBedrockExperiments(folderPath).then(setExperiments, () => setExperiments(null))
  }, [folderPath])
  useEffect(() => {
    loadWorld()
  }, [loadWorld])

  // 서버가 켜져 있으면 규칙을 읽어 자주 쓰는 것을 스위치로 보여 준다. 막 켜져서 아직 못 읽으면 몇 번 다시 해 본다
  useEffect(() => {
    if (!serverOn) return setRules(null)
    let alive = true
    let tries = 0
    const attempt = (): void => {
      window.api
        .listGameRules(folderPath)
        .then((list) => alive && setRules(list))
        .catch(() => {
          if (alive && ++tries < 12) setTimeout(attempt, 4000)
        })
    }
    attempt()
    return () => {
      alive = false
    }
  }, [serverOn, folderPath])
  // 서버를 끄면 서버가 저장한 level.dat를 다시 읽는다 (실험 기능 스위치가 실제 값과 맞게)
  useEffect(() => {
    if (!serverOn) loadWorld()
  }, [serverOn, loadWorld])

  const lower = (r: GameRule): string => r.name.toLowerCase()
  const quick = (rules ?? []).filter((r) => r.type === 'bool' && QUICK_RULES.includes(lower(r)))
  const topRules = TOP_RULES.flatMap((n) => quick.filter((r) => lower(r) === n)) // 순서는 TOP_RULES대로
  const sideRules = quick.filter((r) => !TOP_RULES.includes(lower(r)))
  const membersOf = (r: GameRule): GameRule[] => {
    const names = GROUP[lower(r)] ?? [lower(r)]
    return (rules ?? []).filter((x) => x.type === 'bool' && names.includes(lower(x)))
  }
  async function setRule(r: GameRule, on: boolean): Promise<void> {
    const members = membersOf(r)
    const before = new Map(members.map((x) => [x.name, x.value]))
    setRules((list) => list?.map((x) => (before.has(x.name) ? { ...x, value: String(on) } : x)) ?? null)
    try {
      for (const x of members) await window.api.setGameRule(folderPath, x.name, String(on))
    } catch (e) {
      setRules((list) => list?.map((x) => (before.has(x.name) ? { ...x, value: before.get(x.name) as string } : x)) ?? null) // 되돌리기
      toast(cleanError(e), 'error')
    }
  }
  const ruleRow = (r: GameRule): React.ReactNode => {
    const l = QUICK_TEXT[lower(r)] ?? labelOf(r.name)
    const on = membersOf(r).every((x) => x.value === 'true') // 하나라도 꺼져 있으면 꺼진 것으로 보인다
    return (
      <div className="setting-row" key={r.name}>
        <div className="setting-text">
          <div className="setting-label">{l.label}</div>
          <div className="setting-desc">{l.desc}</div>
        </div>
        <label className="switch">
          <input type="checkbox" checked={on} onChange={(e) => setRule(r, e.target.checked)} />
          <span />
        </label>
      </div>
    )
  }

  async function toggleExperiment(id: string, on: boolean) {
    setExpBusy(id)
    try {
      await window.api.setBedrockExperiment(folderPath, id, on)
      setExperiments((d) => d && { ...d, items: d.items.map((x) => (x.id === id ? { ...x, on } : x)) })
      toast(on ? '켰어요. 다음에 서버를 켜면 적용돼요' : '껐어요. 다음에 서버를 켜면 적용돼요')
    } catch (e) {
      toast(cleanError(e), 'error')
    } finally {
      setExpBusy('')
    }
  }

  async function toggleHardcore(on: boolean) {
    setExpBusy('hardcore')
    try {
      await window.api.setBedrockHardcore(folderPath, on)
      setExperiments((d) => d && { ...d, hardcore: on })
      toast(on ? '하드코어를 켰어요. 다음에 서버를 켜면 적용돼요' : '하드코어를 껐어요. 다음에 서버를 켜면 적용돼요')
    } catch (e) {
      toast(cleanError(e), 'error')
    } finally {
      setExpBusy('')
    }
  }

  // 탭에 월드 파일을 끌어다 놓으면 가져온다 (하나만. 지금 월드는 백업해 둔다)
  async function dropWorld(files: FileList) {
    if (serverOn) return toast('서버를 끈 다음에 월드를 바꿀 수 있어요', 'error')
    const f = files[0]
    try {
      await runJob(folderPath, '월드 가져오기', '가져왔어요', () => window.api.importBedrockWorldFile(folderPath, f))
      toast(`${f.name} 월드를 가져왔어요. 서버를 켜면 이 월드로 시작해요`)
      loadWorld()
    } catch (e) {
      toast(cleanError(e), 'error')
    }
  }

  return (
    <DropZone className="mods" label="놓으면 월드를 가져와요" onFiles={dropWorld}>
      <div className="mods-col">
        <div className="installed-head">
          <h3>지금 월드</h3>
        </div>
        <div className="mods-scroll">
          <div className="mod-card small">
            <span className="sw-badge" style={{ width: 40, height: 40, borderRadius: 12, color: '#3fc1a5', background: '#3fc1a524' }}>
              <Globe2 size={20} />
            </span>
            <div className="body">
              <div className="t" style={{ fontSize: 14 }}>
                {worldName || '…'}
              </div>
              <div className="hint">{worldExists ? '월드 있음' : '아직 월드가 없어요. 서버를 처음 켜면 만들어져요'}</div>
            </div>
          </div>

          <div className="setting-row" style={{ marginTop: 10 }}>
            <div className="setting-text">
              <div className="setting-label">하드코어</div>
              <div className="setting-desc">
                {!experiments?.ready ? '서버를 한 번 켜서 월드를 만든 다음에 바꿀 수 있어요.' : serverOn ? '서버를 끈 다음에 바꿀 수 있어요.' : '죽으면 다시 살아날 수 없어요.'}
              </div>
            </div>
            <label className="switch">
              <input type="checkbox" checked={!!experiments?.hardcore} disabled={!experiments?.ready || serverOn || !!expBusy} onChange={(e) => toggleHardcore(e.target.checked)} />
              <span />
            </label>
          </div>

          <div className="setting-row">
            <div className="setting-text">
              <div className="setting-label">{worldExists ? '월드 리셋' : '새 월드 설정'}</div>
              <div className="setting-desc">시드로 새로 만들거나, 내 월드(.mcworld), CurseForge 맵으로 바꿔요.</div>
            </div>
            <button
              className={`btn ${worldExists ? 'danger' : ''}`}
              onClick={() => setShowReset(true)}
              disabled={serverOn}
              title={serverOn ? '서버를 끈 다음에 할 수 있어요' : undefined}
            >
              <RotateCcw size={16} />
              {worldExists ? '월드 리셋' : '설정하기'}
            </button>
          </div>

          <div className="installed-head" style={{ marginTop: 14 }}>
            <h3>실험적 기능</h3>
          </div>
          <p className="hint">
            {!experiments?.ready
              ? '서버를 한 번 켜서 월드를 만든 다음에 바꿀 수 있어요.'
              : serverOn
                ? '서버를 끈 다음에 바꿀 수 있어요.'
                : '월드에 바로 저장돼요. 한 번 켠 실험 기능은 끄더라도 월드에 "실험 기능을 쓴 월드"로 남아요.'}
          </p>
          {(experiments?.items ?? []).map((x) => (
            <div className="setting-row" key={x.id}>
              <div className="setting-text">
                <div className="setting-label">{EXPERIMENT_INFO[x.id]?.label ?? x.id}</div>
                <div className="setting-desc">{EXPERIMENT_INFO[x.id]?.desc ?? '이 월드에 들어 있는 실험 기능이에요.'}</div>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={x.on}
                  disabled={!experiments?.ready || serverOn || !!expBusy}
                  onChange={(e) => toggleExperiment(x.id, e.target.checked)}
                />
                <span />
              </label>
            </div>
          ))}
        </div>
      </div>

      <div className="mods-col">
        <div className="installed-head">
          <h3>월드 설정</h3>
        </div>
        <div className="mods-scroll">
          <div className="setting-row">
            <div className="setting-text">
              <div className="setting-label">게임 규칙</div>
              <div className="setting-desc">죽어도 아이템 유지, PvP 등. 서버가 켜져 있을 때 바꿀 수 있어요.</div>
            </div>
            <button className="btn" onClick={() => setShowRules(true)} disabled={!serverOn} title={serverOn ? undefined : '서버가 켜져 있을 때 할 수 있어요'}>
              <ListChecks size={16} />
              열기
            </button>
          </div>
          {topRules.map(ruleRow)}
          {sideRules.map(ruleRow)}
          {serverOn && rules == null && <p className="hint">자주 쓰는 규칙을 불러오고 있어요…</p>}
          {!serverOn && <p className="hint">서버가 켜져 있으면 PvP·몹 생성 같은 규칙을 여기서 바로 바꿀 수 있어요.</p>}
        </div>
      </div>

      {showRules && <GameRulesDialog folderPath={folderPath} onClose={() => setShowRules(false)} />}
      {showReset && (
        <BedrockResetDialog
          folderPath={folderPath}
          worldExists={worldExists}
          seed={seed}
          onClose={() => setShowReset(false)}
          onDone={() => {
            setShowReset(false)
            loadWorld()
          }}
        />
      )}
    </DropZone>
  )
}

type Mode = 'new' | 'mine' | 'map'

// 월드 리셋 창: 새 월드 만들기(시드) / 내 월드(.mcworld) / 맵 다운로드(CurseForge). 어느 쪽이든 지금 월드는 먼저 백업한다
function BedrockResetDialog({
  folderPath,
  worldExists,
  seed: savedSeed,
  onClose,
  onDone
}: {
  folderPath: string
  worldExists: boolean
  seed: string
  onClose: () => void
  onDone: () => void
}) {
  const toast = useToast()
  const { runJob } = useTasks()
  const [mode, setMode] = useState<Mode>('new')
  const [seed, setSeed] = useState(savedSeed)
  const [keepAddons, setKeepAddons] = useState(true)
  const [busy, setBusy] = useState(false)

  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<BedrockHit[]>([])
  const [more, setMore] = useState(false)
  const [page, setPage] = useState(0)
  const [searching, setSearching] = useState(false)
  const [fresh, setFresh] = useState(true)
  const [error, setError] = useState('')
  const seq = useRef(0) // 늦게 온 이전 검색 결과는 버린다

  const run = useCallback(async (q: string, offset = 0) => {
    const my = ++seq.current
    setSearching(true)
    setFresh(offset === 0)
    setError('')
    try {
      const res = await window.api.searchBedrock('map', q, offset)
      if (my !== seq.current) return
      setPage(offset + 20)
      setMore(res.more)
      setHits((prev) => (offset ? [...prev, ...res.hits.filter((h) => !prev.some((p) => p.id === h.id))] : res.hits))
    } catch (e) {
      if (my !== seq.current) return
      setError(cleanError(e))
      if (!offset) {
        setHits([])
        setMore(false)
      }
    } finally {
      if (my === seq.current) setSearching(false)
    }
  }, [])
  // 맵 다운로드를 처음 고르면 인기순을 보여 주고, 검색어를 쓰다 멈추면 다시 찾는다
  const started = useRef(false)
  useEffect(() => {
    if (mode !== 'map') return
    if (!started.current) {
      started.current = true
      run(query)
      return
    }
    const t = setTimeout(() => run(query), 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, query])

  async function resetNew() {
    setBusy(true)
    try {
      await window.api.saveSettings(folderPath, { properties: { 'level-seed': seed.trim() } })
      if (worldExists) await runJob(folderPath, '월드 리셋', '리셋했어요', () => window.api.resetWorld(folderPath, keepAddons))
      toast(worldExists ? '월드를 리셋했어요. 서버를 켜면 새 월드가 만들어져요' : '새 월드 설정을 저장했어요')
      onDone()
    } catch (e) {
      toast(cleanError(e), 'error')
      setBusy(false)
    }
  }

  async function importMine() {
    const file = await window.api.pickBedrockWorld().catch(() => null)
    if (!file) return
    setBusy(true)
    try {
      await runJob(folderPath, '월드 가져오기', '가져왔어요', () => window.api.importBedrockWorld(folderPath, file))
      toast('월드를 가져왔어요. 서버를 켜면 이 월드로 시작해요')
      onDone()
    } catch (e) {
      toast(cleanError(e), 'error')
      setBusy(false)
    }
  }

  async function installMap(h: BedrockHit) {
    setBusy(true)
    try {
      const title = await runJob(folderPath, '월드 가져오기', '가져왔어요', () => window.api.installBedrockHit(folderPath, h.id, 'map'))
      toast(`${title} 맵을 가져왔어요. 서버를 켜면 이 월드로 시작해요`)
      onDone()
    } catch (e) {
      toast(cleanError(e), 'error')
      setBusy(false)
    }
  }

  return (
    <Modal onClose={busy ? undefined : onClose}>
      <h2>{worldExists ? '월드 리셋' : '새 월드 설정'}</h2>
      <p className="body">{worldExists ? '지금 월드는 백업해 두고 바꿔요.' : '서버를 처음 켤 때 이 월드로 시작해요.'}</p>
      <div className="world-source">
        <div className="seg">
          <button className={mode === 'new' ? 'active' : ''} onClick={() => setMode('new')} disabled={busy}>
            새 월드 만들기
          </button>
          <button className={mode === 'mine' ? 'active' : ''} onClick={() => setMode('mine')} disabled={busy}>
            내 월드
          </button>
          <button className={mode === 'map' ? 'active' : ''} onClick={() => setMode('map')} disabled={busy}>
            맵 다운로드
          </button>
        </div>

        {mode === 'new' && (
          <div className="reset-fields">
            {worldExists && (
              <label className="reset-row">
                <span>
                  <b>애드온 유지</b>
                  <span className="hint">지금 켜 둔 애드온·리소스 팩을 새 월드에도 그대로 켜요</span>
                </span>
                <span className="switch">
                  <input type="checkbox" checked={keepAddons} onChange={(e) => setKeepAddons(e.target.checked)} />
                  <span />
                </span>
              </label>
            )}
            <div>
              <div className="label">시드</div>
              <input className="input" value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="비워 두면 무작위" maxLength={64} />
            </div>
          </div>
        )}

        {mode === 'mine' && (
          <>
            <p className="hint">마인크래프트에서 내보낸 월드 파일(.mcworld)이나 월드 .zip을 골라요.</p>
            <button className="btn" onClick={importMine} disabled={busy}>
              {busy ? <span className="spinner" /> : <FolderInput size={16} />}
              월드 파일 고르기
            </button>
          </>
        )}

        {mode === 'map' && (
          <>
            <form
              className="search-box"
              onSubmit={(e) => {
                e.preventDefault()
                run(query)
              }}
            >
              <Search size={18} />
              <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="CurseForge에서 찾기" />
            </form>
            {error && <p className="error-text">{error}</p>}
            <div
              className="mods-scroll"
              style={{ maxHeight: 360 }}
              onScroll={(e) => {
                const el = e.currentTarget
                if (!searching && more && el.scrollHeight - el.scrollTop - el.clientHeight < 150) run(query, page)
              }}
            >
              {searching && fresh && <Skeleton />}
              {!(searching && fresh) &&
                hits.map((h) => (
                  <div key={h.id} className="mod-card">
                    {h.iconUrl ? <img src={h.iconUrl} alt="" loading="lazy" /> : <div className="ph" />}
                    <div className="body">
                      <div className="t-row">
                        <span className="t">{h.title}</span>
                        <span className="by">
                          {h.author} · 다운로드 {compact(h.downloads)}
                        </span>
                      </div>
                      <p className="desc">{h.summary}</p>
                    </div>
                    <button className="btn sm primary" onClick={() => installMap(h)} disabled={busy}>
                      <Download size={15} />
                      넣기
                    </button>
                  </div>
                ))}
              {searching && !fresh && <Loading small text="더 불러오고 있어요" />}
              {!searching && hits.length === 0 && !error && <Empty icon={<SearchX size={22} />} title="찾은 게 없어요" hint="다른 이름으로 찾아보세요." />}
            </div>
          </>
        )}
      </div>

      <div className="actions">
        <button className="btn" onClick={onClose} disabled={busy}>
          취소
        </button>
        {mode === 'new' && (
          <button className={`btn ${worldExists ? 'danger' : 'primary'}`} onClick={resetNew} disabled={busy}>
            {busy ? <span className="spinner" /> : worldExists ? '리셋하기' : '저장하기'}
          </button>
        )}
      </div>
    </Modal>
  )
}
