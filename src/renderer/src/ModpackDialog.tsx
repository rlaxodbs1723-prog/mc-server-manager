import { ArrowLeft, Download, FileArchive, Heart, History, Package, Search, Upload, SearchX } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { SOFTWARE_INFO, type ModpackBrowseHit, type ModpackInfo, type ModpackSort, type ModpackVersion, type SearchSite } from '../../shared-types'
import SourceBadge from './SourceBadge'
import Select from './Select'
import { useTasks } from './tasks'
import { Empty, Loading, Modal, Skeleton, useToast } from './ui'
import SiteSwitch from './SiteSwitch'
import { useMouseBack } from './mouseback'
import { appendHits, cleanError, useStored } from './util'

const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n))
const LOADERS = [
  { id: 'fabric', label: 'Fabric' },
  { id: 'forge', label: 'Forge' },
  { id: 'neoforge', label: 'NeoForge' },
  { id: 'quilt', label: 'Quilt' }
]
const LOADER_NAME: Record<string, string> = Object.fromEntries(LOADERS.map((l) => [l.id, l.label]))
const SORTS: { value: ModpackSort; label: string }[] = [
  { value: 'relevance', label: '관련도' },
  { value: 'downloads', label: '다운로드' },
  { value: 'follows', label: '팔로우' },
  { value: 'newest', label: '최신' },
  { value: 'updated', label: '업데이트' }
]
// Modrinth 분류 이름 → 한국어
const TAG_KO: Record<string, string> = {
  adventure: '모험', challenging: '도전', combat: '전투', kitchen_sink: '종합', lightweight: '가벼움', magic: '마법',
  multiplayer: '멀티플레이', optimization: '최적화', quests: '퀘스트', technology: '기술', 'kitchen-sink': '종합', utility: '편의'
}

function ago(t: number): string {
  const d = Math.floor((Date.now() - t) / 86400000)
  if (d < 1) return '오늘'
  if (d < 30) return `${d}일 전`
  if (d < 365) return `${Math.floor(d / 30)}달 전`
  return `${Math.floor(d / 365)}년 전`
}

type View = 'browse' | 'versions' | 'confirm'

// 모드팩으로 서버 만들기: 올리기(zip/mrpack) 또는 Modrinth에서 찾기 → 확인 → 만들기
export default function ModpackDialog({ existingNames, onClose }: { existingNames: string[]; onClose: () => void }) {
  const toast = useToast()
  const { tasks, startCreate } = useTasks()
  const [view, setView] = useState<View>('browse')
  const [busy, setBusy] = useState('')
  const [info, setInfo] = useState<ModpackInfo | null>(null)
  const [pack, setPack] = useState<ModpackBrowseHit | null>(null)
  const [versions, setVersions] = useState<ModpackVersion[] | null>(null)
  const [name, setName] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  // 마우스 뒤로 버튼: 확인 → 버전 → 목록 → 닫기 (받는 중에는 멈춘다)
  useMouseBack(rootRef, busy ? () => undefined : () => (view === 'confirm' ? setView(pack ? 'versions' : 'browse') : view === 'versions' ? setView('browse') : onClose()))

  const norm = (s: string) => s.trim().toLowerCase()
  const taken = new Set([...existingNames, ...tasks.filter((t) => t.status === 'running').map((t) => t.options?.name ?? '')].map(norm))
  const uniqueName = (base: string) => {
    const b = base.replace(/[<>:"/\\|?*]/g, '').slice(0, 50).trim() || '모드팩 서버'
    if (!taken.has(norm(b))) return b
    for (let i = 2; ; i++) if (!taken.has(norm(`${b} (${i})`))) return `${b} (${i})`
  }

  // 모드팩을 풀어서 계획을 받으면 확인 화면으로
  async function prepare(key: string, job: () => Promise<ModpackInfo | null>) {
    setBusy(key)
    try {
      const i = await job()
      if (!i) return
      setInfo(i)
      setName(uniqueName(pack?.title ?? i.name))
      setView('confirm')
    } catch (e) {
      toast(cleanError(e), 'error')
    } finally {
      setBusy('')
    }
  }

  async function openPack(h: ModpackBrowseHit) {
    setPack(h)
    setVersions(null)
    setView('versions')
    try {
      setVersions(await window.api.modpackVersions(h.projectId, h.source ?? 'modrinth'))
    } catch (e) {
      toast(cleanError(e), 'error')
      setView('browse')
    }
  }

  function create() {
    if (!info) return
    const serverName = name.trim()
    startCreate({ name: serverName, software: info.software, mcVersion: info.mcVersion, loaderVersion: info.loaderVersion, modpackId: info.packId, properties: { motd: serverName } })
    onClose()
  }

  const wide = view === 'browse'
  const isCf = pack?.source === 'curseforge'

  return (
    <Modal onClose={busy ? undefined : onClose}>
      <div className={`modpack ${wide ? 'wide' : ''}`} ref={rootRef}>
        {view === 'browse' && (
          <Browser
            onBack={onClose}
            onOpen={openPack}
            uploading={busy === 'file'}
            onPickFile={() => prepare('file', () => window.api.pickModpackFile())}
            onDropFile={(f) => prepare('file', () => window.api.prepareModpackFile(f))}
          />
        )}

        {view === 'versions' && pack && (
          <>
            <button className="btn ghost sm mp-back" onClick={() => setView('browse')} disabled={!!busy}>
              <ArrowLeft size={15} />
              목록으로
            </button>
            <div className="map-head">
              {pack.iconUrl ? <img src={pack.iconUrl} alt="" /> : <div className="save-ph"><Package size={22} /></div>}
              <div>
                <h2>{pack.title}</h2>
                <span className="hint">
                  {pack.author} · 다운로드 {compact(pack.downloads)}
                </span>
              </div>
            </div>
            <p className="body">{pack.description}</p>
            {versions === null ? (
              <Loading text="버전을 불러오고 있어요" />
            ) : versions.length === 0 ? (
              <Empty title="받을 수 있는 버전이 없어요" />
            ) : (
              <div className="save-list">
                {versions.map((v) => {
                  const loader = v.loaders.map((l) => LOADER_NAME[l]).find(Boolean)
                  return (
                    <div className="map-file" key={v.id}>
                      <div className="save-text">
                        <b>{v.versionNumber}</b>
                        <span className="hint">
                          {v.gameVersions.slice(0, 3).join(', ')}
                          {loader ? ` · ${loader}` : ''} · {new Date(v.date).toLocaleDateString('ko-KR')}
                          {v.type !== 'release' ? ` · ${v.type === 'beta' ? '베타' : '알파'}` : ''}
                        </span>
                      </div>
                      <button className="btn sm primary" onClick={() => prepare(v.id, () => (isCf ? window.api.prepareCurseForgeModpack(pack.projectId, v.id) : window.api.prepareModpack(v.id)))} disabled={!!busy || (!isCf && !loader)}>
                        {busy === v.id && <span className="spinner" />}
                        {busy === v.id ? '받는 중…' : loader || isCf ? '고르기' : '지원 안 함'}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {view === 'confirm' && info && (
          <>
            <button className="btn ghost sm mp-back" onClick={() => setView(pack ? 'versions' : 'browse')}>
              <ArrowLeft size={15} />
              다시 고르기
            </button>
            <h2>{pack?.title ?? info.name} 서버 만들기</h2>
            <div className="pd-stats">
              <div>
                <span>마인크래프트</span>
                <b>{info.mcVersion}</b>
              </div>
              <div>
                <span>로더</span>
                <b>
                  {SOFTWARE_INFO[info.software].label} {info.loaderVersion}
                </b>
              </div>
              <div>
                <span>서버에 받을 파일</span>
                <b>{info.modCount}개</b>
              </div>
            </div>
            {info.skipped > 0 && <p className="hint">게임하는 사람 컴퓨터에만 필요한 {info.skipped}개(미니맵·셰이더 등)는 빼고 받아요.</p>}
            {info.manual.length > 0 && (
              <p className="warn-text">
                ⚠ 제작자가 다른 앱에서 받는 것을 막아 둔 모드 {info.manual.length}개는 받을 수 없어요. 서버를 만든 뒤 mods 폴더에 직접 넣어 주세요: {info.manual.slice(0, 8).join(', ')}
                {info.manual.length > 8 ? ` 외 ${info.manual.length - 8}개` : ''}
              </p>
            )}
            <div>
              <div className="label">서버 이름</div>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus />
              {!name.trim() && <p className="error-text">서버 이름을 입력해 주세요.</p>}
              {taken.has(norm(name)) && <p className="error-text">같은 이름의 서버가 있어요</p>}
            </div>
            <p className="hint">플레이어들도 같은 모드팩을 설치해야 들어올 수 있어요.</p>
            <div className="actions">
              <button className="btn" onClick={onClose}>
                취소
              </button>
              <button className="btn primary" onClick={create} disabled={!name.trim() || taken.has(norm(name))}>
                서버 만들기
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

// ---------- Modrinth 사이트처럼 찾아보기 ----------
interface BrowserProps {
  onBack: () => void
  onOpen: (h: ModpackBrowseHit) => void
  uploading: boolean
  onPickFile: () => void
  onDropFile: (f: File) => void
}

function Browser({ onBack, onOpen, uploading, onPickFile, onDropFile }: BrowserProps) {
  const [fresh, setFresh] = useState(true) // 첫 페이지를 새로 찾는 중
  const [page, setPage] = useState(0) // 다음에 불러올 페이지 (Modrinth·CurseForge를 같이 찾는다)
  const [over, setOver] = useState(false)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<ModpackSort>('relevance')
  const [gameVersion, setGameVersion] = useState('')
  const [loaders, setLoaders] = useState<string[]>([])
  const [site, setSite] = useStored<SearchSite>('searchSite', 'all') // 고른 사이트는 다음에도 기억한다
  const [versionsList, setVersionsList] = useState<string[]>([])
  const [hits, setHits] = useState<ModpackBrowseHit[]>([])
  const [more, setMore] = useState(false) // 더 불러올 결과가 있는지
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const seq = useRef(0)

  useEffect(() => {
    window.api.gameVersions().then(setVersionsList).catch(() => undefined)
  }, [])

  const run = useCallback(
    async (offset = 0) => {
      const my = ++seq.current // 늦게 온 예전 검색 결과는 버린다
      setLoading(true)
      setFresh(offset === 0)
      setError('')
      try {
        const res = await window.api.browseModpacks({ query, sort, gameVersion: gameVersion || null, loaders, offset, site })
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
        if (my === seq.current) setLoading(false)
      }
    },
    [query, sort, gameVersion, loaders, site]
  )

  // 검색어는 잠깐 멈췄을 때, 나머지 필터는 바로 다시 찾는다
  useEffect(() => {
    const t = setTimeout(() => run(0), 300)
    return () => clearTimeout(t)
  }, [run])

  const toggleLoader = (id: string) => setLoaders((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]))

  return (
    <div className={`mp-browser ${uploading ? "locked" : ""}`} aria-busy={uploading}>
      <div className="mp-main">
        <div className="mp-top">
          <button className="btn icon ghost" onClick={onBack} disabled={uploading} title="뒤로">
            <ArrowLeft size={18} />
          </button>
          <div className="console-search mp-search">
            <Search size={16} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="모드팩 검색" autoFocus />
          </div>
          <div className="mp-sort">
            <Select value={sort} onChange={(v) => setSort(v as ModpackSort)} options={SORTS.map((s) => ({ value: s.value, label: `정렬: ${s.label}` }))} />
          </div>
        </div>
        {error && <p className="error-text">{error}</p>}
        <div
          className="mp-list"
          onScroll={(e) => {
            const el = e.currentTarget
            if (!loading && more && el.scrollHeight - el.scrollTop - el.clientHeight < 200) run(page)
          }}
        >
          {loading && fresh && <Skeleton count={4} />}
          {!(loading && fresh) &&
            hits.map((h) => (
            <div className="mp-card" key={h.projectId}>
              {h.iconUrl ? <img className="mp-icon" src={h.iconUrl} alt="" loading="lazy" /> : <div className="mp-icon save-ph"><Package size={28} /></div>}
              <div className="mp-body">
                <div className="mp-title">
                  <SourceBadge source={h.source} />
                  <b>{h.title}</b>
                  <span className="hint">by {h.author}</span>
                </div>
                <p className="mp-desc">{h.description}</p>
                <div className="mp-tags">
                  <span className="chip">{h.clientAndServer ? '🌐 클라이언트·서버' : '🖥 서버'}</span>
                  {h.tags.map((t) => (
                    <span className="chip" key={t}>
                      {TAG_KO[t] ?? t}
                    </span>
                  ))}
                  {h.loaders.map((l) => (
                    <span className="chip blue" key={l}>
                      {LOADER_NAME[l] ?? l}
                    </span>
                  ))}
                </div>
              </div>
              <div className="mp-side">
                <button className="btn sm primary" onClick={() => onOpen(h)} disabled={uploading}>
                  <FileArchive size={15} />
                  설치
                </button>
                <span className="hint">
                  <Download size={13} /> {compact(h.downloads)}
                </span>
                {h.source !== 'curseforge' && (
                  <span className="hint">
                    <Heart size={13} /> {compact(h.follows)}
                  </span>
                )}
                <span className="hint">
                  <History size={13} /> {ago(h.updated)}
                </span>
              </div>
            </div>
          ))}
          {loading && !fresh && <Loading small text="더 불러오고 있어요" />}
          {!loading && hits.length === 0 && !error && <Empty icon={<SearchX size={22} />} title="조건에 맞는 모드팩이 없어요" hint="검색어나 필터를 바꿔 보세요." />}
        </div>
      </div>

      <aside className="mp-filters">
        <div className="mp-filter">
          <div className="label">사이트</div>
          <SiteSwitch value={site} onChange={setSite} />
        </div>
        <div className="mp-filter">
          <div className="label">게임 버전</div>
          <Select value={gameVersion} onChange={setGameVersion} options={[{ value: '', label: '모든 버전' }, ...versionsList.slice(0, 80).map((v) => ({ value: v, label: v }))]} />
        </div>
        <div className="mp-filter">
          <div className="label">로더</div>
          {LOADERS.map((l) => (
            <label className="mp-check" key={l.id}>
              <input type="checkbox" checked={loaders.includes(l.id)} onChange={() => toggleLoader(l.id)} disabled={uploading} />
              {l.label}
            </label>
          ))}
        </div>
        <p className="hint">
          Modrinth는 서버에서 돌아가는 모드팩만 보여 드려요.
        </p>
        <button
          className={`mp-choice mp-import ${over ? 'over' : ''}`}
          disabled={uploading}
          onClick={onPickFile}
          onDragOver={(e) => {
            e.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setOver(false)
            const f = e.dataTransfer.files[0]
            if (f) onDropFile(f)
          }}
        >
          {uploading ? <span className="spinner" /> : <Upload size={24} />}
          <b>{uploading ? '모드팩을 읽는 중…' : '모드팩 가져오기'}</b>
          <span className="hint">.mrpack이나 CurseForge 모드팩 .zip을 고르거나 끌어다 놓으세요</span>
        </button>
      </aside>
    </div>
  )
}
