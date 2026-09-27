import { FileArchive, Package, PackageOpen, SearchX, Share2, ArrowUpCircle, Check, Download, History, Lock, RefreshCw, Search, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { InstalledMod, ModKindInfo, ModSearchHit, SearchSite } from '../../shared-types'
import DropZone from './DropZone'
import InstalledFilter, { matchesFilter } from './InstalledFilter'
import ModVersionDialog from './ModVersionDialog'
import SourceBadge from './SourceBadge'
import { Confirm, Empty, Loading, Modal, Skeleton, useToast } from './ui'
import { appendHits, cleanError, identifyWithRetry, josa, useStored } from './util'
import { checkOffSuggestions } from './OffSuggestDialog'
import SiteSwitch from './SiteSwitch'
import { useDelayedRemove } from './undo'
import { useTasks } from './tasks'

interface Props {
  folderPath: string
  kind: ModKindInfo
  serverOn: boolean
}

const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n))

export default function ModsTab({ folderPath, kind, serverOn }: Props) {
  const toast = useToast()
  const { runJob } = useTasks() // 오래 걸리는 작업은 타이틀바 작업 목록에도 보여 준다
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ModSearchHit[]>([])
  const [more, setMore] = useState(false) // 더 불러올 결과가 있는지
  const [searching, setSearching] = useState(false)
  const [installedRaw, setInstalled] = useState<InstalledMod[]>([])
  const { hidden, schedule, cancelAll } = useDelayedRemove() // 지운 직후 되돌리기
  const installed = installedRaw.filter((m) => !hidden.has(m.fileName))
  const [installedLoaded, setInstalledLoaded] = useState(false) // 처음 읽기 전에 "없어요"가 번쩍이지 않게
  const [fresh, setFresh] = useState(true) // 첫 페이지를 새로 찾는 중 (이전 결과 대신 자리 표시를 보여 준다)
  const [working, setWorking] = useState('') // 설치/삭제 중인 항목 (projectId 또는 파일 이름)
  const [error, setError] = useState('')
  const [page, setPage] = useState(0) // 다음에 불러올 페이지
  const [updates, setUpdates] = useState<Record<string, string> | null>(null) // 파일 이름 -> 새 버전 (확인 전이면 null)
  const [checking, setChecking] = useState(false)
  const [versionOf, setVersionOf] = useState<InstalledMod | null>(null)
  const [identifyFailing, setIdentifyFailing] = useState(false) // 사이트 오류로 직접 넣은 파일을 아직 못 알아봄
  const [site, setSite] = useStored<SearchSite>('searchSite', 'all') // 고른 사이트는 다음에도 기억한다
  const [dupAsk, setDupAsk] = useState<ModSearchHit | null>(null) // 같은 이름이 이미 있을 때 설치할지 묻기
  const [filter, setFilter] = useState('') // 설치된 목록 거르기
  const [view, setView] = useState<'all' | 'client' | 'off'>('all') // 플레이어도 설치해야 하는 것 / 앱이 꺼 둔 것만 보기
  const [exporting, setExporting] = useState(false)
  const [askExport, setAskExport] = useState(false)
  async function exportPack(format: 'mrpack' | 'zip') {
    setExporting(true)
    try {
      const file = await runJob(folderPath, '플레이어용 모드팩 내보내기', (f) => (f ? '저장했어요' : null), () => window.api.exportClientPack(folderPath, format))
      if (file) {
        setAskExport(false)
        toast(
          format === 'zip'
            ? '모드 묶음을 저장했어요. 플레이어는 풀어서 mods 폴더에 넣으면 돼요'
            : '플레이어용 모드팩을 저장했어요. 이 파일을 플레이어에게 보내 주세요'
        )
      }
    } catch (e) {
      toast(cleanError(e), 'error')
    } finally {
      setExporting(false)
    }
  }

  const refreshInstalled = useCallback(
    () =>
      window.api
        .listMods(folderPath)
        .then(setInstalled)
        .finally(() => setInstalledLoaded(true)),
    [folderPath]
  )

  const seq = useRef(0) // 늦게 온 이전 검색 결과는 버린다
  const runSearch = useCallback(
    async (q: string, offset = 0) => {
      const my = ++seq.current
      setSearching(true)
      setFresh(offset === 0)
      setError('')
      try {
        // offset은 이미 불러온 페이지 수 (0이면 새로 찾기)
        const res = await window.api.searchMods(folderPath, q, offset, site)
        if (my !== seq.current) return
        setPage(offset + 1)
        setMore(res.more)
        setHits((prev) => appendHits(offset ? prev : [], res.hits))
      } catch (e) {
        if (my !== seq.current) return
        setError(cleanError(e))
        // 새로 찾다 실패하면 이전 결과(다른 사이트 결과일 수 있다)를 남기지 않는다
        if (!offset) {
          setHits([])
          setMore(false)
        }
      } finally {
        if (my === seq.current) setSearching(false)
      }
    },
    [folderPath, site]
  )

  // 사이트를 바꾸면 지금 검색어로 다시 찾는다
  const siteChanged = useRef(false)
  useEffect(() => {
    if (siteChanged.current) runSearch(query)
    siteChanged.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site])

  // 검색어를 입력하면 멈춘 뒤 잠깐 있다가 알아서 찾는다 (엔터를 누르면 바로)
  const typed = useRef(false)
  useEffect(() => {
    if (!typed.current) return
    const t = setTimeout(() => runSearch(query), 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  // 서버가 켜지면(자동 재시작 등) 켜진 서버의 모드는 지울 수 없으니, 기다리던 지우기를 취소하고 알린다
  useEffect(() => {
    if (serverOn && cancelAll()) toast(`서버가 켜져서 지우지 않았어요. 서버를 끈 뒤 다시 지워 주세요.`, 'error')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverOn])

  // 켜기 전 점검 창의 "찾기": 그 모드 ID로 검색한다
  const presetSearch = useRef(false)
  useEffect(() => {
    const on = (): void => {
      const id = sessionStorage.getItem('modsSearch')
      if (!id) return
      sessionStorage.removeItem('modsSearch')
      presetSearch.current = true
      const q = id.replace(/[-_]/g, ' ').replace(/\d+$/, '').trim() // 끝에 붙은 숫자는 버전 구분이라 뺀다
      setQuery(q)
      runSearch(q)
    }
    on() // 이 탭이 방금 열렸으면 저장해 둔 검색어부터
    window.addEventListener('mods-search', on)
    return () => window.removeEventListener('mods-search', on)
  }, [runSearch])

  // 끌지 묻는 창에서 모드를 끄면 목록을 다시 읽는다
  useEffect(() => {
    window.addEventListener('mods-changed', refreshInstalled)
    return () => window.removeEventListener('mods-changed', refreshInstalled)
  }, [refreshInstalled])

  // 처음 열면 인기순 목록과 설치된 목록을 보여 준다.
  // 사이트를 바꿔도 다시 돌지 않게 검색 함수는 최신 것을 ref로 쓴다 (다시 돌면 검색어가 지워진 채로 검색된다)
  const latest = useRef({ runSearch, query })
  latest.current = { runSearch, query }
  useEffect(() => {
    refreshInstalled()
    if (!presetSearch.current) latest.current.runSearch('') // 켜기 전 점검에서 "찾기"로 왔으면 그 검색이 먼저
    return identifyWithRetry(
      () => window.api.identifyMods(folderPath),
      () => {
        refreshInstalled()
        latest.current.runSearch(latest.current.query) // 보고 있던 검색 결과의 "설치됨" 표시만 갱신
      },
      setIdentifyFailing
    )
  }, [refreshInstalled, folderPath])

  async function install(hit: ModSearchHit) {
    setWorking(hit.projectId)
    try {
      const r = await window.api.installMod(folderPath, hit.projectId)
      toast(r.dependencies.length ? `${hit.title}와(과) 필요한 ${kind.kind} ${r.dependencies.length}개를 설치했어요` : `${hit.title}을(를) 설치했어요`)
      if (r.failed.length) toast(`일부 필수 ${josa(kind.kind, '을/를')} 설치하지 못했어요: ${r.failed.join(' / ')}`, 'error')
      setHits((list) => list.map((h) => (h.projectId === hit.projectId ? { ...h, installed: true } : h)))
      checkOffSuggestions()
      await refreshInstalled()
    } catch (e) {
      toast(cleanError(e), 'error')
    } finally {
      setWorking('')
    }
  }

  // 목록에서 먼저 빼고 6초 동안 되돌릴 수 있게 한 뒤 실제로 지운다
  function remove(mod: InstalledMod) {
    schedule(mod.fileName, `${mod.title}을(를) 지웠어요`, async () => {
      try {
        const removed = await window.api.removeMod(folderPath, mod.fileName)
        if (removed.length > 1) toast(`같이 설치됐던 ${removed.length - 1}개도 이제 필요 없어서 지웠어요`)
        await refreshInstalled()
        runSearch(query) // "설치됨" 표시 갱신
      } catch (e) {
        toast(cleanError(e), 'error')
      }
    })
  }

  async function checkUpdates() {
    setChecking(true)
    try {
      const u = await window.api.checkModUpdates(folderPath)
      setUpdates(u)
      const n = Object.keys(u).filter((f) => installed.some((m) => m.fileName === f)).length
      toast(n ? `새 버전이 있는 ${josa(kind.kind, '이/가')} ${n}개 있어요` : `모든 ${josa(kind.kind, '이/가')} 최신이에요`)
    } catch (e) {
      toast(cleanError(e), 'error')
    } finally {
      setChecking(false)
    }
  }

  async function update(fileNames: string[]) {
    setWorking(fileNames.length === 1 ? fileNames[0] : 'update-all')
    try {
      const r = await runJob(folderPath, fileNames.length === 1 ? `${kind.kind} 업데이트` : `${kind.kind} 모두 업데이트`, '업데이트했어요', () => window.api.updateMods(folderPath, fileNames))
      if (r.installed.length) toast(`${r.installed.length}개를 업데이트했어요`)
      if (r.failed.length) toast(`업데이트하지 못한 것이 있어요: ${r.failed.join(' / ')}`, 'error')
      setUpdates((u) => {
        if (!u) return u
        const next = { ...u }
        for (const f of fileNames.length ? fileNames : Object.keys(u)) delete next[f]
        return next
      })
      await refreshInstalled()
    } catch (e) {
      toast(cleanError(e), 'error')
    } finally {
      setWorking('')
    }
  }

  async function toggle(mod: InstalledMod) {
    try {
      await window.api.setModEnabled(folderPath, mod.fileName, !mod.enabled)
      await refreshInstalled()
    } catch (e) {
      toast(cleanError(e), 'error')
    }
  }

  const locked = serverOn || !!working
  // 흐린 버튼에 마우스를 올리면 왜 안 되는지 보여 준다
  const lockedWhy = serverOn ? `서버가 켜져 있어서 ${josa(kind.kind, '을/를')} 바꿀 수 없어요` : working ? '다른 작업이 끝나면 할 수 있어요' : undefined

  async function addFiles(files: FileList) {
    // 여러 개를 넣으면 알림을 하나로 모은다
    const added: string[] = []
    for (const f of Array.from(files)) {
      try {
        added.push(await window.api.addModFile(folderPath, f))
      } catch (e) {
        toast(files.length > 1 ? `${f.name}: ${cleanError(e)}` : cleanError(e), 'error')
      }
    }
    if (added.length) toast(added.length > 1 ? `${added.length}개를 넣었어요` : `${added[0]}을(를) 넣었어요`)
    checkOffSuggestions() // 서버에 맞지 않아 보이는 것이 있으면 끌지 물어본다
    await refreshInstalled()
    // 넣은 파일이 어떤 모드인지 바로 알아본다 (찾으면 아이콘·이름이 생긴다)
    if (await window.api.identifyMods(folderPath)) {
      refreshInstalled()
      runSearch(query)
    }
  }

  return (
    <DropZone className="mods" label={`놓으면 ${josa(kind.kind, '을/를')} 추가해요 (jar 파일)`} onFiles={addFiles} disabled={serverOn}>
      <div className="mods-col">
        {serverOn && (
          <div className="banner">
            <Lock size={16} />
            서버가 켜져 있어서 {josa(kind.kind, '을/를')} 바꿀 수 없어요. 먼저 서버를 꺼 주세요.
          </div>
        )}
        <div className="search-row">
          <form
            className="search-box"
            onSubmit={(e) => {
              e.preventDefault()
              runSearch(query)
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
              placeholder={`${kind.kind} 이름으로 검색해 보세요`}
            />
          </form>
        </div>
        <SiteSwitch value={site} onChange={setSite} />
        <p className="hint">필요한 {josa(kind.kind, '은/는')} 같이 설치돼요.</p>
        {error && <p className="error-text">{error}</p>}

        <div
          className="mods-scroll"
          onScroll={(e) => {
            const el = e.currentTarget
            if (!searching && more && el.scrollHeight - el.scrollTop - el.clientHeight < 150) runSearch(query, page)
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
                  {h.clientSide === 'required' && kind.kind === '모드' && (
                    <span className="mini-tag" title="서버에 들어오는 플레이어도 자기 컴퓨터에 설치해야 해요">
                      플레이어도 설치
                    </span>
                  )}
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
                <button className={`btn sm ${h.sameNameInstalled ? '' : 'primary'}`} onClick={() => (h.sameNameInstalled ? setDupAsk(h) : install(h))} disabled={locked} title={lockedWhy}>
                  {working === h.projectId ? <span className="spinner" /> : <Download size={15} />}
                  설치
                </button>
              )}
            </div>
          ))}
          {searching && !fresh && <Loading small text="더 불러오고 있어요" />}
          {!searching && hits.length === 0 && !error && <Empty icon={<SearchX size={22} />} title="검색 결과가 없어요" hint="다른 이름으로 찾아보세요." />}
        </div>
      </div>

      <div className="mods-col">
        <div className="installed-head">
          <h3>설치된 {kind.kind}</h3>
          <span className="hint">{installed.length}개</span>
          {kind.kind === '모드' && installed.some((m) => m.clientRequired) && (
            <button
              className={`console-chip ${view === 'client' ? 'on' : ''}`}
              onClick={() => setView((v) => (v === 'client' ? 'all' : 'client'))}
              title="서버에 들어오는 플레이어도 자기 컴퓨터에 설치해야 하는 모드만 보여 줘요"
            >
              플레이어 설치 필요 {installed.filter((m) => m.clientRequired).length}
            </button>
          )}
          {kind.kind === '모드' && installed.some((m) => m.offReason) && (
            <button
              className={`console-chip ${view === 'off' ? 'on' : ''}`}
              onClick={() => setView((v) => (v === 'off' ? 'all' : 'off'))}
              title="클라이언트 전용이거나 서버에서 튕겨서 앱이 꺼 둔 모드만 보여 줘요"
            >
              앱이 꺼 둔 모드 {installed.filter((m) => m.offReason).length}
            </button>
          )}
          <span style={{ flex: 1 }} />
          {updates && installed.some((m) => updates[m.fileName]) ? (
            <button className="btn sm primary" onClick={() => update([])} disabled={locked} title={lockedWhy}>
              {working === 'update-all' ? <span className="spinner" /> : <ArrowUpCircle size={15} />}
              모두 업데이트
            </button>
          ) : (
            <button className="btn sm" onClick={checkUpdates} disabled={checking || !installed.length} title="Modrinth·CurseForge에서 새 버전을 찾아봐요">
              {checking ? <span className="spinner" /> : <RefreshCw size={14} />}
              업데이트 확인
            </button>
          )}
        </div>
        {kind.kind === '모드' && installed.length > 0 && (
          <button className="btn block share-pack" onClick={() => setAskExport(true)}>
            <Share2 size={16} />
            플레이어용 모드팩 내보내기
          </button>
        )}
        {installed.length > 0 && <InstalledFilter value={filter} onChange={setFilter} placeholder={`설치된 ${kind.kind} 찾기`} />}
        {identifyFailing && installed.some((m) => !m.tracked) && (
          <p className="hint">Modrinth가 지금 응답하지 않아서 일부 아이콘·이름을 못 불러왔어요. 30초마다 다시 해 볼게요.</p>
        )}
        <div className="mods-scroll">
          {!installedLoaded && <Skeleton small count={4} />}
          {installedLoaded && installed.length === 0 && (
            <Empty icon={<PackageOpen size={22} />} title={`아직 설치한 ${josa(kind.kind, '이/가')} 없어요`} hint={`왼쪽에서 찾아 설치하거나, jar 파일을 여기로 끌어다 놓아요.`} />
          )}
          {installed.length > 0 && filter && !installed.some((m) => matchesFilter(filter, m.title, m.fileName)) && (
            <Empty icon={<SearchX size={22} />} title={`'${filter}'에 맞는 ${josa(kind.kind, '이/가')} 없어요`} />
          )}
          {installed
            .filter((m) => (view === 'client' ? m.clientRequired : view === 'off' ? !!m.offReason : true))
            .filter((m) => matchesFilter(filter, m.title, m.fileName))
            .map((m) => (
              <div key={m.fileName} className={`mod-card small ${m.enabled ? '' : 'off'}`}>
                {m.iconUrl ? <img src={m.iconUrl} alt="" loading="lazy" /> : <div className="ph" />}
                <div className="body">
                  <div className="t-row">
                    <span className="t" style={{ fontSize: 14 }}>
                      {m.title}
                    </span>
                    {m.offReason === 'client' && (
                      <span className="mini-tag" title="게임 화면용 모드라서 서버에서는 필요 없어요. 앱이 꺼 뒀어요.">
                        클라이언트 전용
                      </span>
                    )}
                    {m.offReason === 'clientMixin' && (
                      <span className="mini-tag" title="이 버전은 서버에서 켜면 튕겨요 (모드 쪽 버그). 게임에서는 문제없어요. 앱이 꺼 뒀어요.">
                        서버에서 튕김
                      </span>
                    )}
                    {m.clientRequired && kind.kind === '모드' && (
                      <span className="mini-tag" title="서버에 들어오는 플레이어도 자기 컴퓨터에 설치해야 해요">
                        플레이어도 설치
                      </span>
                    )}
                  </div>
                  <div className="hint">
                    {m.versionNumber}
                    {m.requiredBy.length > 0 && ` · ${m.requiredBy.join(', ')}에 필요`}
                  </div>
                  {updates?.[m.fileName] && (
                    <button className="chip update" onClick={() => update([m.fileName])} disabled={locked} title={lockedWhy ?? '이것만 업데이트'}>
                      {working === m.fileName ? '업데이트 중…' : `새 버전 ${updates[m.fileName]} ↑`}
                    </button>
                  )}
                </div>
                <label className="switch" title={lockedWhy ?? (m.enabled ? '끄면 파일은 남기고 서버가 불러오지 않아요' : '다시 켜기')}>
                  <input type="checkbox" checked={m.enabled} onChange={() => toggle(m)} disabled={locked} />
                  <span />
                </label>
                <button
                  className="btn icon sm ghost"
                  onClick={() => setVersionOf(m)}
                  disabled={locked || !m.tracked}
                  title={!m.tracked ? '직접 넣은 파일이라 버전을 바꿀 수 없어요' : (lockedWhy ?? '버전 바꾸기')}
                >
                  <History size={16} />
                </button>
                <button className="btn icon sm ghost" onClick={() => remove(m)} disabled={locked} title={lockedWhy ?? '삭제'}>
                  {working === m.fileName ? <span className="spinner" /> : <Trash2 size={16} />}
                </button>
              </div>
            ))}
        </div>
      </div>
      {versionOf && (
        <ModVersionDialog
          title={versionOf.title}
          load={() => window.api.modVersions(folderPath, versionOf.fileName)}
          apply={async (id) => (await window.api.setModVersion(folderPath, versionOf.fileName, id)).failed}
          onClose={() => setVersionOf(null)}
          onDone={() => {
            setVersionOf(null)
            setUpdates((u) => {
              if (!u) return u
              const next = { ...u }
              delete next[versionOf.fileName]
              return next
            })
            refreshInstalled()
          }}
        />
      )}
      {askExport && (
        <Modal onClose={exporting ? undefined : () => setAskExport(false)}>
          <h2>플레이어용 모드팩 내보내기</h2>
          <p className="body">플레이어 컴퓨터에 필요한 모드만 담아요. 서버 전용 모드와 꺼 둔 모드는 빠져요.</p>
          <div className="mp-choices" style={{ marginTop: 16 }}>
            <button className="mp-choice" onClick={() => exportPack('mrpack')} disabled={exporting}>
              <Package size={26} />
              <b>.mrpack</b>
              <span className="hint">Modrinth App·Prism Launcher에 넣으면 버전·로더·모드가 한 번에 깔려요 (파일이 작아요)</span>
            </button>
            <button className="mp-choice" onClick={() => exportPack('zip')} disabled={exporting}>
              <FileArchive size={26} />
              <b>.zip</b>
              <span className="hint">모드 파일 묶음이에요. 플레이어가 풀어서 mods 폴더에 직접 넣어요 (어떤 런처든 돼요)</span>
            </button>
          </div>
          {exporting && (
            <p className="hint" style={{ marginTop: 12 }}>
              만드는 중…
            </p>
          )}
          <div className="actions">
            <button className="btn" onClick={() => setAskExport(false)} disabled={exporting}>
              닫기
            </button>
          </div>
        </Modal>
      )}
      {dupAsk && (
        <Confirm
          title="같은 이름이 이미 설치돼 있어요"
          body={`'${dupAsk.title}'과(와) 이름이 같은 ${josa(kind.kind, '이/가')} 다른 사이트에서 받아져 있어요. 같은 것을 두 번 넣으면 서버가 켜지지 않아요. 다른 것이 확실할 때만 설치해 주세요.`}
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
