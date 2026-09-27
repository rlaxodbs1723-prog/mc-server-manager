import { Check, Download, History, PackageOpen, Search, SearchX, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { InstalledDatapack, ModSearchHit, SearchSite } from '../../shared-types'
import DropZone from './DropZone'
import InstalledFilter, { matchesFilter } from './InstalledFilter'
import ModVersionDialog from './ModVersionDialog'
import SourceBadge from './SourceBadge'
import { Confirm, Empty, Loading, Skeleton, useToast } from './ui'
import SiteSwitch from './SiteSwitch'
import { useDelayedRemove } from './undo'
import { appendHits, cleanError, identifyWithRetry, useStored } from './util'

const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n))

// 데이터팩 탭: 왼쪽은 Modrinth·CurseForge 검색, 오른쪽은 설치된 데이터팩 (끌어다 놓아서 넣기도 된다)
export default function DatapacksTab({ folderPath, serverOn }: { folderPath: string; serverOn: boolean }) {
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ModSearchHit[]>([])
  const [more, setMore] = useState(false) // 더 불러올 결과가 있는지
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [page, setPage] = useState(0)
  const [identifyFailing, setIdentifyFailing] = useState(false) // 사이트 오류로 직접 넣은 파일을 아직 못 알아봄
  const [site, setSite] = useStored<SearchSite>('searchSite', 'all') // 고른 사이트는 다음에도 기억한다
  const [dupAsk, setDupAsk] = useState<ModSearchHit | null>(null) // 같은 이름이 이미 있을 때 설치할지 묻기
  const [filter, setFilter] = useState('')
  const [installedRaw, setInstalled] = useState<InstalledDatapack[]>([])
  const { hidden, schedule } = useDelayedRemove() // 지운 직후 되돌리기
  const installed = installedRaw.filter((d) => !hidden.has(d.name))
  const [installedLoaded, setInstalledLoaded] = useState(false)
  const [fresh, setFresh] = useState(true)
  const [working, setWorking] = useState('')
  const [versionOf, setVersionOf] = useState<InstalledDatapack | null>(null)

  const refresh = useCallback(
    () =>
      window.api
        .listDatapacks(folderPath)
        .then(setInstalled)
        .catch(() => setInstalled([]))
        .finally(() => setInstalledLoaded(true)),
    [folderPath]
  )

  const seq = useRef(0) // 늦게 온 이전 검색 결과는 버린다
  const run = useCallback(
    async (q: string, offset = 0) => {
      const my = ++seq.current
      setSearching(true)
      setFresh(offset === 0)
      setError('')
      try {
        const res = await window.api.searchDatapacks(folderPath, q, offset, site)
        if (my !== seq.current) return
        setPage(offset + 1)
        setMore(res.more)
        setHits((prev) => appendHits(offset ? prev : [], res.hits))
      } catch (e) {
        if (my === seq.current) setError(cleanError(e))
      } finally {
        if (my === seq.current) setSearching(false)
      }
    },
    [folderPath, site]
  )

  // 사이트를 바꾸면 지금 검색어로 다시 찾는다
  const siteChanged = useRef(false)
  useEffect(() => {
    if (siteChanged.current) run(query)
    siteChanged.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site])

  // 직접 넣은 데이터팩이 무엇인지 Modrinth에서 알아보고, 찾으면 목록과 검색 결과를 다시 읽는다
  const identify = useCallback(
    async (q: string) => {
      if (await window.api.identifyDatapacks(folderPath).catch(() => false)) {
        refresh()
        run(q)
      }
    },
    [folderPath, refresh, run]
  )

  // 처음 열면 한 번. 사이트를 바꿔도 다시 돌지 않게 검색 함수는 최신 것을 ref로 쓴다 (다시 돌면 검색어가 지워진다)
  const latest = useRef({ run, query })
  latest.current = { run, query }
  useEffect(() => {
    refresh()
    latest.current.run('')
    return identifyWithRetry(
      () => window.api.identifyDatapacks(folderPath),
      () => {
        refresh()
        latest.current.run(latest.current.query)
      },
      setIdentifyFailing
    )
  }, [refresh, folderPath])

  const typed = useRef(false)
  useEffect(() => {
    if (!typed.current) return
    const t = setTimeout(() => run(query), 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const applied = serverOn ? ' (바로 적용했어요)' : ''

  async function install(h: ModSearchHit) {
    setWorking(h.projectId)
    try {
      const title = await window.api.installDatapack(folderPath, h.projectId)
      toast(`${title}을(를) 설치했어요${applied}`)
      setHits((list) => list.map((x) => (x.projectId === h.projectId ? { ...x, installed: true } : x)))
      await refresh()
    } catch (e) {
      toast(cleanError(e), 'error')
    } finally {
      setWorking('')
    }
  }

  async function toggle(d: InstalledDatapack) {
    setWorking(d.name)
    try {
      await window.api.setDatapackEnabled(folderPath, d.name, !d.enabled)
      await refresh()
      if (serverOn) toast(`${d.title}을(를) ${d.enabled ? '껐어요' : '켰어요'}${applied}`)
    } catch (e) {
      toast(cleanError(e), 'error')
    } finally {
      setWorking('')
    }
  }

  // 목록에서 먼저 빼고 6초 동안 되돌릴 수 있게 한 뒤 실제로 지운다 (휴지통으로)
  function remove(d: InstalledDatapack) {
    schedule(d.name, `${d.title}을(를) 지웠어요`, async () => {
      try {
        await window.api.removeDatapack(folderPath, d.name)
        setHits((list) => list.map((x) => (x.title === d.title ? { ...x, installed: false } : x)))
        await refresh()
      } catch (e) {
        toast(cleanError(e), 'error')
      }
    })
  }

  async function addFiles(files: FileList) {
    // 여러 개를 넣으면 알림을 하나로 모은다
    const added: string[] = []
    for (const f of Array.from(files)) {
      try {
        added.push(await window.api.addDatapackFile(folderPath, f))
      } catch (e) {
        toast(files.length > 1 ? `${f.name}: ${cleanError(e)}` : cleanError(e), 'error')
      }
    }
    if (added.length) toast(`${added.length > 1 ? `${added.length}개를` : `${added[0]}을(를)`} 넣었어요${applied}`)
    await refresh()
    identify(query)
  }

  return (
    <DropZone className="mods" label="놓으면 데이터팩을 추가해요" onFiles={addFiles}>
      <div className="mods-col">
        <form
          className="search-box"
          onSubmit={(e) => {
            e.preventDefault()
            run(query)
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
            placeholder="데이터팩 이름으로 검색해 보세요"
          />
        </form>
        <SiteSwitch value={site} onChange={setSite} />
        <p className="hint">
          이 서버 버전에 맞는 데이터팩만 보여 드려요.
          {serverOn && ' 켜져 있어도 바로 적용돼요.'}
        </p>
        {error && <p className="error-text">{error}</p>}
        <div
          className="mods-scroll"
          onScroll={(e) => {
            const el = e.currentTarget
            if (!searching && more && el.scrollHeight - el.scrollTop - el.clientHeight < 150) run(query, page)
          }}
        >
          {searching && fresh && <Skeleton />}
          {!(searching && fresh) &&
            hits.map((h) => (
            <div key={h.projectId} className="mod-card">
              {h.iconUrl ? <img src={h.iconUrl} alt="" loading="lazy" /> : <div className="ph" />}
              <div className="body">
                <div className="t-row">
                  <SourceBadge source={h.source} />
                  <span className="t">{h.title}</span>
                  {h.sameNameInstalled && (
                    <span className="mini-tag" title="다른 사이트에서 받은 같은 이름이 이미 설치돼 있어요">
                      같은 이름 설치됨
                    </span>
                  )}
                  <span className="by">
                    {h.author} · 다운로드 {compact(h.downloads)}
                  </span>
                </div>
                <p className="desc">{h.description}</p>
              </div>
              {h.installed ? (
                <button className="btn sm" disabled>
                  <Check size={15} />
                  설치됨
                </button>
              ) : (
                <button className={`btn sm ${h.sameNameInstalled ? '' : 'primary'}`} onClick={() => (h.sameNameInstalled ? setDupAsk(h) : install(h))} disabled={!!working}>
                  {working === h.projectId ? <span className="spinner" /> : <Download size={15} />}
                  설치
                </button>
              )}
            </div>
          ))}
          {searching && !fresh && <Loading small text="더 불러오고 있어요" />}
          {!searching && hits.length === 0 && !error && <Empty icon={<SearchX size={22} />} title="이 버전에 맞는 데이터팩이 없어요" hint="다른 이름으로 찾아보세요." />}
        </div>
      </div>

      <div className="mods-col">
        <div className="installed-head">
          <h3>설치된 데이터팩</h3>
          <span className="hint">{installed.length}개</span>
        </div>
        {installed.length > 0 && <InstalledFilter value={filter} onChange={setFilter} placeholder="설치된 데이터팩 찾기" />}
        {identifyFailing && installed.some((m) => !m.tracked) && (
          <p className="hint">Modrinth가 지금 응답하지 않아서 일부 아이콘·이름을 못 불러왔어요. 30초마다 다시 해 볼게요.</p>
        )}
        <div className="mods-scroll">
          {!installedLoaded && <Skeleton small count={4} />}
          {installedLoaded && installed.length === 0 && (
            <Empty icon={<PackageOpen size={22} />} title="아직 데이터팩이 없어요" hint="왼쪽에서 찾아 설치하거나, zip 파일을 여기로 끌어다 놓아요." />
          )}
          {installed.length > 0 && filter && !installed.some((d) => matchesFilter(filter, d.title, d.name)) && (
            <Empty icon={<SearchX size={22} />} title={`'${filter}'에 맞는 데이터팩이 없어요`} />
          )}
          {installed
            .filter((d) => matchesFilter(filter, d.title, d.name))
            .map((d) => (
              <div key={d.name} className={`mod-card small ${d.enabled ? '' : 'off'}`}>
                {d.iconUrl ? <img src={d.iconUrl} alt="" loading="lazy" /> : <div className="ph" />}
                <div className="body">
                  <div className="t" style={{ fontSize: 14 }}>
                    {d.title}
                  </div>
                  <div className="hint">{d.versionNumber || d.description || d.name}</div>
                </div>
                <label className="switch" title={d.enabled ? '끄기 (지우지 않고 빼 둬요)' : '다시 켜기'}>
                  <input type="checkbox" checked={d.enabled} onChange={() => toggle(d)} disabled={!!working} />
                  <span />
                </label>
                <button
                  className="btn icon sm ghost"
                  onClick={() => setVersionOf(d)}
                  disabled={!!working || !d.tracked}
                  title={d.tracked ? '버전 바꾸기' : '직접 넣은 데이터팩이라 버전을 바꿀 수 없어요'}
                >
                  <History size={16} />
                </button>
                <button className="btn icon sm ghost" onClick={() => remove(d)} disabled={!!working} title="삭제">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
        </div>
      </div>

      {versionOf && (
        <ModVersionDialog
          title={versionOf.title}
          load={() => window.api.datapackVersions(folderPath, versionOf.name)}
          apply={(id) => window.api.setDatapackVersion(folderPath, versionOf.name, id)}
          onClose={() => setVersionOf(null)}
          onDone={() => {
            setVersionOf(null)
            refresh()
          }}
        />
      )}
      {dupAsk && (
        <Confirm
          title="같은 이름이 이미 설치돼 있어요"
          body={`'${dupAsk.title}'과(와) 이름이 같은 데이터팩이 다른 사이트에서 받아져 있어요. 같은 것을 두 번 넣으면 서버가 켜지지 않아요. 다른 것이 확실할 때만 설치해 주세요.`}
          confirmText="그래도 설치"
          onConfirm={() => {
            install(dupAsk)
            setDupAsk(null)
          }}
          onCancel={() => setDupAsk(null)}
        />
      )}
    </DropZone>
  )
}
