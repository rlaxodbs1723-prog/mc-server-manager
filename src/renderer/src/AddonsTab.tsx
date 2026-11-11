import { Download, PackageOpen, Plus, Search, SearchX, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { BedrockHit, InstalledAddon } from '../../shared-types'
import DropZone from './DropZone'
import { useTasks } from './tasks'
import { Empty, Loading, Skeleton, useToast } from './ui'
import { useDelayedRemove } from './undo'
import { cleanError } from './util'

const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n))

// 이 탭이 다루는 종류 (월드·맵은 BedrockWorldTab)
type AddonKind = 'addon' | 'resource' | 'script'

const TEXT: Record<AddonKind, { drop: string; installed: string; empty: string }> = {
  addon: { drop: '놓으면 애드온을 추가해요', installed: '설치된 애드온', empty: '아직 애드온이 없어요' },
  resource: { drop: '놓으면 리소스 팩을 추가해요', installed: '설치된 리소스 팩', empty: '아직 리소스 팩이 없어요' },
  script: { drop: '놓으면 스크립트를 추가해요', installed: '설치된 스크립트', empty: '아직 스크립트가 없어요' }
}
// 설치된 것 중 이 탭에 보일 것: 애드온 = 스크립트가 아닌 비헤이비어 팩, 스크립트 = 스크립트 팩, 리소스 팩 = 리소스 팩
const belongs = (a: InstalledAddon, kind: AddonKind): boolean =>
  kind === 'resource' ? a.kind === 'resource' : kind === 'script' ? a.kind === 'behavior' && a.script : a.kind === 'behavior' && !a.script

// 배드락 서버의 애드온·리소스 팩·스크립트 탭(kind): 왼쪽은 CurseForge 검색, 오른쪽은 설치된 것.
// .mcaddon / .mcpack / .zip을 끌어다 놓거나 골라서 넣을 수도 있다
export default function AddonsTab({ folderPath, serverOn, kind }: { folderPath: string; serverOn: boolean; kind: AddonKind }) {
  const toast = useToast()
  const { runJob } = useTasks()
  const picker = useRef<HTMLInputElement>(null)
  const [listRaw, setList] = useState<InstalledAddon[]>([])
  const [loaded, setLoaded] = useState(false)
  const [working, setWorking] = useState('')
  const { hidden, schedule } = useDelayedRemove() // 지운 직후 되돌리기
  const list = listRaw.filter((a) => !hidden.has(a.id) && belongs(a, kind))
  const applied = serverOn ? ' 서버를 껐다 켜야 적용돼요' : ''

  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<BedrockHit[]>([])
  const [more, setMore] = useState(false)
  const [searching, setSearching] = useState(false)
  const [fresh, setFresh] = useState(true)
  const [page, setPage] = useState(0)
  const [error, setError] = useState('')

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

  const seq = useRef(0) // 늦게 온 이전 검색 결과는 버린다
  const run = useCallback(async (k: AddonKind, q: string, offset = 0) => {
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
      const title = await runJob(folderPath, '애드온 설치', '설치했어요', () => window.api.installBedrockHit(folderPath, h.id, kind))
      toast(`${title}을(를) 설치했어요${applied}`)
      await refresh()
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
          파일(.mcaddon · .mcpack · .zip)을 끌어다 놓거나{' '}
          <button type="button" className="linkish" onClick={() => picker.current?.click()}>
            <Plus size={13} /> 파일 고르기
          </button>
          {serverOn && ' · 켜 둔 서버는 다시 켜야 적용돼요'}
        </p>
        <input
          ref={picker}
          type="file"
          multiple
          accept=".mcaddon,.mcpack,.zip"
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
                <button className="btn sm primary" onClick={() => install(h)} disabled={!!working}>
                  {working === String(h.id) ? <span className="spinner" /> : <Download size={15} />}
                  설치
                </button>
              </div>
            ))}
          {searching && !fresh && <Loading small text="더 불러오고 있어요" />}
          {!searching && hits.length === 0 && !error && <Empty icon={<SearchX size={22} />} title="찾은 게 없어요" hint="다른 이름으로 찾아보세요." />}
        </div>
      </div>

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
    </DropZone>
  )
}
