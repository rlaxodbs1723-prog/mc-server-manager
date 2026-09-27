import { ArrowLeft, Download, ExternalLink, FileArchive, Globe, Search } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { MapFile, MapHit, MapSort, SaveWorld } from '../../shared-types'
import Select from './Select'
import { Empty, Loading, Skeleton, useToast } from './ui'
import { cleanError } from './util'
import { useMouseBack } from './mouseback'

const WorldIcon = ({ w }: { w: SaveWorld }) =>
  w.icon ? (
    <img src={w.icon} alt="" />
  ) : (
    <div className="save-ph">
      <Globe size={22} />
    </div>
  )

const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n))
const mb = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)}GB` : `${Math.max(1, Math.round(b / 1024 ** 2))}MB`)

// ---------- 내 월드: zip 파일이나 월드 폴더를 끌어다 놓기 (누르면 파일 고르기) ----------
function SavePicker({ onPick }: { onPick: (w: SaveWorld) => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)

  async function run(get: () => Promise<SaveWorld | null>) {
    setBusy(true)
    try {
      const w = await get()
      if (w) onPick(w)
    } catch (e) {
      toast(cleanError(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      className={`drop-box ${over ? 'over' : ''}`}
      disabled={busy}
      onClick={() => run(() => window.api.pickWorldZip())}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const file = e.dataTransfer.files[0]
        if (file) run(() => window.api.openDroppedWorld(file))
      }}
    >
      {busy ? <span className="spinner" /> : <FileArchive size={30} />}
      <b>{busy ? '압축을 푸는 중…' : '맵 zip 파일이나 월드 폴더를 여기에 끌어다 놓으세요'}</b>
      <span className="hint">누르면 zip 파일을 고를 수 있어요</span>
    </button>
  )
}

// ---------- 맵 다운로드: CurseForge ----------
const SORTS: { value: MapSort; label: string }[] = [
  { value: 'popular', label: '인기순' },
  { value: 'newest', label: '최신순' },
  { value: 'updated', label: '업데이트순' },
  { value: 'downloads', label: '다운로드순' },
  { value: 'name', label: '이름순' }
]
export function KeySetup({ onDone }: { onDone: () => void }) {
  const toast = useToast()
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    try {
      await window.api.setCurseForgeKey(key)
      toast('CurseForge에 연결했어요')
      onDone()
    } catch (e) {
      toast(cleanError(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="cf-key">
      <p className="body">
        CurseForge 맵을 받으려면 <b>API 키</b>가 한 번 필요해요. console.curseforge.com에 로그인해서 <b>API Keys</b>에 있는 키를 붙여 넣어 주세요.
      </p>
      <button className="btn ghost" onClick={() => window.api.openExternal('https://console.curseforge.com/')}>
        <ExternalLink size={15} />
        CurseForge 콘솔 열기
      </button>
      <div className="say-form">
        <input className="input" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="API 키 붙여 넣기" />
        <button className="btn primary" onClick={save} disabled={busy || key.trim().length < 20}>
          {busy ? <span className="spinner" /> : '연결'}
        </button>
      </div>
    </div>
  )
}

function MapBrowser({ serverVersion, onPick }: { serverVersion: string; onPick: (w: SaveWorld) => void }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const toast = useToast()
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<MapSort>('popular')
  const [hits, setHits] = useState<MapHit[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<MapHit | null>(null)
  const [files, setFiles] = useState<MapFile[] | null>(null)
  const [downloading, setDownloading] = useState<{
    done: number
    total?: number
  } | null>(null)

  useEffect(() => {
    window.api.hasCurseForgeKey().then(setHasKey)
  }, [])

  const seq = useRef(0) // 늦게 온 이전 검색 결과는 버린다
  const run = useCallback(
    async (q: string, offset = 0) => {
      const my = ++seq.current
      setLoading(true)
      setError('')
      try {
        const res = await window.api.searchMaps(q, sort, offset)
        if (my !== seq.current) return
        setTotal(res.total)
        setHits((prev) => (offset ? [...prev, ...res.hits] : res.hits))
      } catch (e) {
        if (my !== seq.current) return
        setError(cleanError(e))
        if (!offset) {
          setHits([]) // 새로 찾다 실패하면 이전 결과를 남기지 않는다
          setTotal(0)
        }
      } finally {
        if (my === seq.current) setLoading(false)
      }
    },
    [sort]
  )

  useEffect(() => {
    if (hasKey) run(query)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasKey, sort])

  const typed = useRef(false)
  useEffect(() => {
    if (!typed.current || !hasKey) return
    const t = setTimeout(() => run(query), 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  async function openMap(h: MapHit) {
    setOpen(h)
    setFiles(null)
    try {
      setFiles(await window.api.mapFiles(h.id))
    } catch (e) {
      toast(cleanError(e), 'error')
      setOpen(null)
    }
  }

  async function download(f: MapFile) {
    if (!open) return
    setDownloading({ done: 0 })
    const off = window.api.onMapProgress(setDownloading)
    try {
      onPick(await window.api.prepareMap(open.id, f.id, open.title))
    } catch (e) {
      const msg = cleanError(e)
      toast(msg.includes('취소') ? '맵 받기를 취소했어요' : msg, msg.includes('취소') ? 'success' : 'error')
    } finally {
      off()
      setDownloading(null)
    }
  }

  // 마우스 뒤로 버튼: 맵 보기 → 맵 목록 (받는 중에는 멈춘다)
  useMouseBack(rootRef, open ? () => !downloading && setOpen(null) : null)

  const pct = downloading?.total ? Math.round((downloading.done / downloading.total) * 100) : null

  return (
    <div className="map-browser" ref={rootRef}>
      {open ? (
        <>
          <button className="btn ghost sm" onClick={() => setOpen(null)} disabled={!!downloading}>
            <ArrowLeft size={15} />
            목록으로
          </button>
          <div className="map-head">
            {open.iconUrl ? (
              <img src={open.iconUrl} alt="" />
            ) : (
              <div className="save-ph">
                <Globe size={22} />
              </div>
            )}
            <div>
              <h2>{open.title}</h2>
              <span className="hint">
                {open.author} · 다운로드 {compact(open.downloads)}
              </span>
            </div>
          </div>
          <p className="body">{open.summary}</p>
          {downloading ? (
            <div className="map-progress">
              <div className={`bar ${pct == null ? 'indeterminate' : ''}`}>
                <i style={pct == null ? undefined : { width: `${pct}%` }} />
              </div>
              <span className="hint">{downloading.total ? `${mb(downloading.done)} / ${mb(downloading.total)}` : '받는 중…'} · 다 받으면 압축을 풀어요</span>
              <button className="btn sm ghost" onClick={() => window.api.cancelMap()}>
                취소
              </button>
            </div>
          ) : files === null ? (
            <Loading text="파일 목록을 불러오고 있어요" />
          ) : files.length === 0 ? (
            <Empty title="받을 수 있는 zip 파일이 없어요" />
          ) : (
            <div className="save-list">
              {files.map((f) => {
                // 버전 정보가 있는데 서버 버전이 없으면 노란색으로 알려 준다
                const mismatch = f.versions.length > 0 && !f.versions.includes(serverVersion)
                return (
                  <div className={`map-file ${mismatch ? 'mismatch' : ''}`} key={f.id}>
                    <div className="save-text">
                      <b>{f.name}</b>
                      <span className="hint">
                        {f.versions.slice(0, 4).join(', ') || '버전 정보 없음'} · {mb(f.size)} · {new Date(f.date).toLocaleDateString('ko-KR')}
                      </span>
                      {mismatch && <span className="map-warn">⚠ 서버({serverVersion})와 버전이 달라요</span>}
                    </div>
                    <button className="btn primary sm" onClick={() => download(f)}>
                      <Download size={15} />
                      받기
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </>
      ) : (
        <>
          {hasKey === null ? (
            <Loading />
          ) : !hasKey ? (
            <KeySetup onDone={() => setHasKey(true)} />
          ) : (
            <>
              <form
                className="map-search"
                onSubmit={(e) => {
                  e.preventDefault()
                  run(query)
                }}
              >
                <div className="console-search" style={{ maxWidth: 'none', height: 40 }}>
                  <Search size={15} />
                  <input
                    value={query}
                    onChange={(e) => {
                      typed.current = true
                      setQuery(e.target.value)
                    }}
                    placeholder="맵 검색 (예: parkour, 탈출, skyblock)"
                  />
                </div>
                <div className="map-sort">
                  <Select value={sort} onChange={(v) => setSort(v as MapSort)} options={SORTS} />
                </div>
              </form>
              {error && <p className="error-text">{error}</p>}
              <div
                className="save-list map-list"
                onScroll={(e) => {
                  const el = e.currentTarget
                  if (!loading && hits.length < total && el.scrollHeight - el.scrollTop - el.clientHeight < 120) run(query, hits.length)
                }}
              >
                {hits.map((h) => (
                  <button key={h.id} className="save-item" onClick={() => openMap(h)}>
                    {h.iconUrl ? (
                      <img src={h.iconUrl} alt="" loading="lazy" />
                    ) : (
                      <div className="save-ph">
                        <Globe size={22} />
                      </div>
                    )}
                    <div className="save-text">
                      <b>{h.title}</b>
                      <span className="hint map-summary">{h.summary}</span>
                      <span className="hint">
                        ⬇ {compact(h.downloads)}
                        {h.versions.length > 0 && ` · ${h.versions.slice(0, 3).join(', ')}`}
                      </span>
                    </div>
                  </button>
                ))}
                {!loading && hits.length === 0 && !error && <Empty title="찾는 맵이 없어요" hint="다른 이름으로 찾아보세요." />}
                {loading && (hits.length ? <Loading small text="더 불러오고 있어요" /> : <Skeleton count={4} />)}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

// ---------- 월드 만들기/리셋 화면의 "새 월드 / 내 월드 / 맵 다운로드" ----------
type Mode = 'new' | 'mine' | 'map'

export function WorldSource({
  serverVersion,
  picked,
  onChange,
  children
}: {
  serverVersion: string
  picked: SaveWorld | null
  onChange: (w: SaveWorld | null) => void
  children: React.ReactNode // 새 월드 만들기 설정
}) {
  const [mode, setMode] = useState<Mode>(picked ? 'mine' : 'new')
  const mismatch = picked?.version && serverVersion && picked.version !== serverVersion

  const choose = (m: Mode) => {
    if (m !== mode) onChange(null)
    setMode(m)
  }

  return (
    <div className="world-source">
      <div className="seg">
        <button className={mode === 'new' ? 'active' : ''} onClick={() => choose('new')}>
          새 월드 만들기
        </button>
        <button className={mode === 'mine' ? 'active' : ''} onClick={() => choose('mine')}>
          내 월드·zip
        </button>
        <button className={mode === 'map' ? 'active' : ''} onClick={() => choose('map')}>
          맵 다운로드
        </button>
      </div>
      {mode === 'new' && children}
      {mode === 'mine' && !picked && <SavePicker onPick={onChange} />}
      {mode === 'map' && !picked && <MapBrowser serverVersion={serverVersion} onPick={onChange} />}
      {mode !== 'new' &&
        (picked ? (
          <button className="save-item" onClick={() => onChange(null)} title="다른 월드 고르기">
            <WorldIcon w={picked} />
            <div className="save-text">
              <b>{picked.name}</b>
              <span className="hint">{picked.version ?? picked.folder} · 눌러서 바꾸기</span>
            </div>
          </button>
        ) : null)}
      {mismatch && (
        <p className="warn-text">
          이 월드는 {picked!.version}용이에요. 서버({serverVersion})보다 새 버전의 월드는 열리지 않을 수 있어요.
        </p>
      )}
    </div>
  )
}
