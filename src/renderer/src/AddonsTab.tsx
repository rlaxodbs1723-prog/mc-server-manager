import { Download, FolderInput, Globe2, ListChecks, PackageOpen, Plus, RotateCcw, Search, SearchX, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { BedrockHit, BedrockKind, GameRule, InstalledAddon } from '../../shared-types'
import { labelOf } from './gameruleLabels'
import DropZone from './DropZone'
import GameRulesDialog from './GameRulesDialog'
import { useTasks } from './tasks'
import { Confirm, Empty, Loading, Skeleton, useToast } from './ui'
import { useDelayedRemove } from './undo'
import { cleanError } from './util'

const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n))

// 배드락에서 자주 쓰는 게임 규칙 (이름은 대소문자를 가리지 않는다). 서버가 켜져 있을 때 스위치로 바로 바꾼다
// 위쪽 셋은 자바 맵 탭과 같은 순서로 맨 위에 둔다 (배드락에는 네더 허용 규칙이 없다)
const TOP_RULES = ['pvp', 'domobspawning', 'commandblocksenabled']
const QUICK_RULES = [...TOP_RULES, 'mobgriefing', 'keepinventory', 'dodaylightcycle']
// 스위치 하나로 여러 규칙을 같이 바꾼다: 몹 생성은 팬텀(doInsomnia)까지 한꺼번에 꺼지게 한다 (그 서버에 있는 규칙만)
const GROUP: Record<string, string[]> = { domobspawning: ['domobspawning', 'doinsomnia'] }
const QUICK_TEXT: Record<string, { label: string; desc: string }> = {
  domobspawning: { label: '몹 생성', desc: '끄면 몬스터·동물 등 모든 몹이 자연스럽게 생기지 않아요' },
  commandblocksenabled: { label: '명령 블록 사용', desc: '명령 블록을 설치하고 작동시킬 수 있어요.' }
}

const TEXT: Record<BedrockKind, { drop: string; installed: string; empty: string }> = {
  addon: { drop: '놓으면 애드온을 추가해요', installed: '설치된 애드온', empty: '아직 애드온이 없어요' },
  resource: { drop: '놓으면 리소스 팩을 추가해요', installed: '설치된 리소스 팩', empty: '아직 리소스 팩이 없어요' },
  script: { drop: '놓으면 스크립트를 추가해요', installed: '설치된 스크립트', empty: '아직 스크립트가 없어요' },
  map: { drop: '놓으면 월드를 가져와요', installed: '지금 월드', empty: '' }
}
// 설치된 것 중 이 탭에 보일 것: 애드온 = 스크립트가 아닌 비헤이비어 팩, 스크립트 = 스크립트 팩, 리소스 팩 = 리소스 팩
const belongs = (a: InstalledAddon, kind: BedrockKind): boolean =>
  kind === 'resource'
    ? a.kind === 'resource'
    : kind === 'script'
      ? a.kind === 'behavior' && a.script
      : kind === 'addon'
        ? a.kind === 'behavior' && !a.script
        : false

// 배드락 서버의 애드온·리소스 팩·스크립트·맵 탭(kind): 왼쪽은 CurseForge 검색, 오른쪽은 설치된 것(맵은 지금 월드).
// .mcaddon / .mcpack / .zip(맵은 .mcworld)을 끌어다 놓거나 골라서 넣을 수도 있다
export default function AddonsTab({ folderPath, serverOn, kind }: { folderPath: string; serverOn: boolean; kind: BedrockKind }) {
  const toast = useToast()
  const { runJob } = useTasks()
  const picker = useRef<HTMLInputElement>(null)
  const [listRaw, setList] = useState<InstalledAddon[]>([])
  const [loaded, setLoaded] = useState(false)
  const [working, setWorking] = useState('')
  const { hidden, schedule } = useDelayedRemove() // 지운 직후 되돌리기
  const list = listRaw.filter((a) => !hidden.has(a.id) && belongs(a, kind))
  const [worldName, setWorldName] = useState('')
  const [worldExists, setWorldExists] = useState(false)
  const applied = serverOn ? ' 서버를 다시 켜면 적용돼요' : ''

  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<BedrockHit[]>([])
  const [more, setMore] = useState(false)
  const [searching, setSearching] = useState(false)
  const [fresh, setFresh] = useState(true)
  const [page, setPage] = useState(0)
  const [error, setError] = useState('')
  const [askMap, setAskMap] = useState<BedrockHit | null>(null)
  const [askReset, setAskReset] = useState(false)
  const [showRules, setShowRules] = useState(false)
  const [rules, setRules] = useState<GameRule[] | null>(null)

  const refresh = useCallback(
    () =>
      window.api
        .listAddons(folderPath)
        .then(setList)
        .catch(() => setList([]))
        .finally(() => setLoaded(true)),
    [folderPath]
  )
  useEffect(() => {
    refresh()
  }, [refresh])
  const loadWorld = useCallback(() => {
    window.api
      .getSettings(folderPath)
      .then((s) => {
        setWorldName(s.properties['level-name'] || 'Bedrock level')
        setWorldExists(s.worldExists)
      })
      .catch(() => undefined)
  }, [folderPath])
  useEffect(() => {
    if (kind === 'map') loadWorld()
  }, [kind, loadWorld])

  // 월드 탭: 서버가 켜져 있으면 규칙을 읽어 자주 쓰는 것을 스위치로 보여 준다. 막 켜져서 아직 못 읽으면 몇 번 다시 해 본다
  useEffect(() => {
    if (kind !== 'map' || !serverOn) return setRules(null)
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
  }, [kind, serverOn, folderPath])
  const lower = (r: GameRule): string => r.name.toLowerCase()
  const quick = (rules ?? []).filter((r) => r.type === 'bool' && QUICK_RULES.includes(lower(r)))
  const topRules = TOP_RULES.flatMap((n) => quick.filter((r) => lower(r) === n)) // 순서는 TOP_RULES대로
  const sideRules = quick.filter((r) => !TOP_RULES.includes(lower(r)))
  // 이 스위치가 바꾸는 규칙들 (켜진 서버에 실제로 있는 것만)
  const membersOf = (r: GameRule): GameRule[] => {
    const names = GROUP[lower(r)] ?? [lower(r)]
    return (rules ?? []).filter((x) => x.type === 'bool' && names.includes(lower(x)))
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

  const seq = useRef(0) // 늦게 온 이전 검색 결과는 버린다
  const run = useCallback(async (k: BedrockKind, q: string, offset = 0) => {
    const my = ++seq.current
    setSearching(true)
    setFresh(offset === 0)
    setError('')
    try {
      const res = await window.api.searchBedrock(k, q, offset)
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

  // 종류를 바꾸면 지금 검색어로 다시 찾는다. 처음에는 인기순을 보여 준다
  useEffect(() => {
    run(kind, query)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])

  const typed = useRef(false)
  useEffect(() => {
    if (!typed.current) return
    const t = setTimeout(() => run(kind, query), 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  async function addFiles(files: FileList) {
    if (kind === 'map') {
      // 월드 파일(.mcworld/.zip)은 하나만 넣을 수 있다 (지금 월드는 백업해 둔다)
      if (serverOn) return toast('서버를 끈 다음에 월드를 바꿀 수 있어요', 'error')
      const f = files[0]
      try {
        await runJob(folderPath, '월드 가져오기', '가져왔어요', () => window.api.importBedrockWorldFile(folderPath, f))
        toast(`${f.name} 월드를 가져왔어요. 서버를 켜면 이 월드로 시작해요`)
        loadWorld()
      } catch (e) {
        toast(cleanError(e), 'error')
      }
      return
    }
    const added: string[] = []
    for (const f of Array.from(files)) {
      try {
        added.push(...(await window.api.addAddonFile(folderPath, f)))
      } catch (e) {
        toast(files.length > 1 ? `${f.name}: ${cleanError(e)}` : cleanError(e), 'error')
      }
    }
    if (added.length) toast(`${added.length > 1 ? `${added.length}개를` : `${added[0]}을(를)`} 넣었어요${applied}`)
    await refresh()
  }

  async function install(h: BedrockHit) {
    setWorking(String(h.id))
    try {
      const isMap = kind === 'map'
      const title = await runJob(folderPath, isMap ? '월드 가져오기' : '애드온 설치', isMap ? '가져왔어요' : '설치했어요', () =>
        window.api.installBedrockHit(folderPath, h.id, kind)
      )
      toast(isMap ? `${title} 맵을 가져왔어요. 서버를 켜면 이 월드로 시작해요` : `${title}을(를) 설치했어요${applied}`)
      await refresh()
      if (isMap) loadWorld()
    } catch (e) {
      toast(cleanError(e), 'error')
    } finally {
      setWorking('')
    }
  }

  async function toggle(a: InstalledAddon) {
    setWorking(a.id)
    try {
      await window.api.setAddonEnabled(folderPath, a.id, !a.enabled)
      await refresh()
      if (serverOn) toast(`${a.title}을(를) ${a.enabled ? '껐어요' : '켰어요'}${applied}`)
    } catch (e) {
      toast(cleanError(e), 'error')
    } finally {
      setWorking('')
    }
  }

  function remove(a: InstalledAddon) {
    schedule(a.id, `${a.title}을(를) 지웠어요`, async () => {
      try {
        await window.api.removeAddon(folderPath, a.id)
        await refresh()
      } catch (e) {
        toast(cleanError(e), 'error')
      }
    })
  }

  return (
    <DropZone className="mods" label={TEXT[kind].drop} onFiles={addFiles}>
      <div className="mods-col">
        <form
          className="search-box"
          onSubmit={(e) => {
            e.preventDefault()
            run(kind, query)
          }}
        >
          <Search size={18} />
          <input
            className="input"
            value={query}
            onChange={(e) => {
              typed.current = true
              setQuery(e.target.value)
            }}
            placeholder="CurseForge에서 찾기"
          />
        </form>
        <p className="hint">
          {kind === 'map'
            ? '맵을 설치하면 지금 월드는 백업해 두고 이 맵으로 바뀌어요. 서버를 끈 다음에 할 수 있어요.'
            : '파일(.mcaddon · .mcpack · .zip)을 끌어다 놓거나'}
          {kind !== 'map' && (
            <>
              {' '}
              <button type="button" className="linkish" onClick={() => picker.current?.click()}>
                <Plus size={13} /> 파일 고르기
              </button>
              {serverOn && ' · 켜 둔 서버는 다시 켜야 적용돼요'}
            </>
          )}
        </p>
        <input
          ref={picker}
          type="file"
          multiple={kind !== 'map'}
          accept={kind === 'map' ? '.mcworld,.zip' : '.mcaddon,.mcpack,.zip'}
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files)
            e.target.value = ''
          }}
        />
        {error && <p className="error-text">{error}</p>}
        <div
          className="mods-scroll"
          onScroll={(e) => {
            const el = e.currentTarget
            if (!searching && more && el.scrollHeight - el.scrollTop - el.clientHeight < 150) run(kind, query, page)
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
                <button
                  className="btn sm primary"
                  onClick={() => (kind === 'map' ? setAskMap(h) : install(h))}
                  disabled={!!working || (kind === 'map' && serverOn)}
                  title={kind === 'map' && serverOn ? '서버를 끈 다음에 넣을 수 있어요' : undefined}
                >
                  {working === String(h.id) ? <span className="spinner" /> : <Download size={15} />}
                  설치
                </button>
              </div>
            ))}
          {searching && !fresh && <Loading small text="더 불러오고 있어요" />}
          {!searching && hits.length === 0 && !error && <Empty icon={<SearchX size={22} />} title="찾은 게 없어요" hint="다른 이름으로 찾아보세요." />}
        </div>
      </div>

      {kind === 'map' ? (
        <div className="mods-col">
          <div className="installed-head">
            <h3>지금 월드</h3>
          </div>
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
          <p className="hint">내 월드(.mcworld 파일)는 여기로 끌어다 놓거나 아래 버튼으로 골라요. 지금 월드는 백업해 둬요.</p>
          <button
            className="btn"
            disabled={serverOn}
            title={serverOn ? '서버를 끈 다음에 할 수 있어요' : undefined}
            onClick={async () => {
              const file = await window.api.pickBedrockWorld().catch(() => null)
              if (!file) return
              try {
                await runJob(folderPath, '월드 가져오기', '가져왔어요', () => window.api.importBedrockWorld(folderPath, file))
                toast('월드를 가져왔어요. 서버를 켜면 이 월드로 시작해요')
                loadWorld()
              } catch (e) {
                toast(cleanError(e), 'error')
              }
            }}
          >
            <FolderInput size={16} />내 월드 가져오기
          </button>
          <div className="setting-row" style={{ marginTop: 10 }}>
            <div className="setting-text">
              <div className="setting-label">월드 리셋</div>
              <div className="setting-desc">월드를 새로 만들어요. 지금 월드는 백업해 둬요.</div>
            </div>
            <button
              className="btn danger"
              disabled={serverOn || !worldExists}
              onClick={() => setAskReset(true)}
              title={serverOn ? '서버를 끈 다음에 할 수 있어요' : undefined}
            >
              <RotateCcw size={16} />
              월드 리셋
            </button>
          </div>
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
          {(topRules.length > 0 || sideRules.length > 0) && (
            <div className="installed-head" style={{ marginTop: 14 }}>
              <h3>월드 설정</h3>
            </div>
          )}
          {topRules.map(ruleRow)}
          {sideRules.map(ruleRow)}
          {serverOn && rules == null && <p className="hint">자주 쓰는 규칙을 불러오고 있어요…</p>}
        </div>
      ) : (
        <div className="mods-col">
          <div className="installed-head">
            <h3>{TEXT[kind].installed}</h3>
            <span className="hint">{list.length}개</span>
          </div>
          <div className="mods-scroll">
            {!loaded && <Skeleton small count={3} />}
            {loaded && list.length === 0 && (
              <Empty icon={<PackageOpen size={22} />} title={TEXT[kind].empty} hint="왼쪽에서 찾아 설치하거나, 파일을 여기로 끌어다 놓아요." />
            )}
            {list.map((a) => (
              <div key={a.id} className={`mod-card small ${a.enabled ? '' : 'off'}`}>
                {a.iconUrl ? <img src={a.iconUrl} alt="" loading="lazy" /> : <div className="ph" />}
                <div className="body">
                  <div className="t" style={{ fontSize: 14 }}>
                    {a.title}
                  </div>
                  <div className="hint">
                    {a.kind === 'behavior' ? '비헤이비어 팩' : '리소스 팩'} · {a.version}
                  </div>
                </div>
                <label className="switch" title={a.enabled ? '끄기 (지우지 않고 빼 둬요)' : '다시 켜기'}>
                  <input type="checkbox" checked={a.enabled} onChange={() => toggle(a)} disabled={!!working} />
                  <span />
                </label>
                <button className="btn icon sm ghost" onClick={() => remove(a)} disabled={!!working} title="삭제">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {showRules && <GameRulesDialog folderPath={folderPath} onClose={() => setShowRules(false)} />}
      {askReset && (
        <Confirm
          title="월드를 리셋할까요?"
          body="지금 월드를 백업한 뒤 지우고, 다음에 켤 때 새 월드를 만들어요."
          confirmText="리셋"
          danger
          onConfirm={async () => {
            setAskReset(false)
            try {
              await runJob(folderPath, '월드 리셋', '리셋했어요', () => window.api.resetWorld(folderPath))
              toast('월드를 리셋했어요. 서버를 켜면 새 월드가 만들어져요')
              loadWorld()
            } catch (e) {
              toast(cleanError(e), 'error')
            }
          }}
          onCancel={() => setAskReset(false)}
        />
      )}
      {askMap && (
        <Confirm
          title={`${askMap.title} 맵을 넣을까요?`}
          body="지금 월드는 백업해 두고, 이 맵으로 바뀌어요. 다음에 켤 때 이 맵으로 시작해요."
          confirmText="넣기"
          onConfirm={() => {
            install(askMap)
            setAskMap(null)
          }}
          onCancel={() => setAskMap(null)}
        />
      )}
    </DropZone>
  )
}
