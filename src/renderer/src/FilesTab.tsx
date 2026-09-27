import {
  Box,
  Braces,
  Camera,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileJson,
  FilePlus,
  FileText,
  FileWarning,
  Folder,
  FolderCog,
  FolderOpen,
  FolderPlus,
  Glasses,
  Globe,
  House,
  MoreHorizontal,
  Paintbrush,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ScrollText,
  Search,
  Trash2,
  X
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { DirEntry } from '../../shared-types'
import ContextMenu, { type MenuItem } from './ContextMenu'
import InstalledFilter, { matchesFilter } from './InstalledFilter'
import { Confirm, Empty, Modal, Skeleton, useToast } from './ui'
import { cleanError } from './util'
import { useMouseBack } from './mouseback'

// 폴더·파일 모양에 맞는 아이콘
const FOLDER_ICON: Record<string, ReactNode> = {
  config: <FolderCog size={18} />,
  mods: <Box size={18} />,
  plugins: <Plug size={18} />,
  datapacks: <Braces size={18} />,
  resourcepacks: <Paintbrush size={18} />,
  shaderpacks: <Glasses size={18} />,
  saves: <Globe size={18} />,
  world: <Globe size={18} />,
  world_nether: <Globe size={18} />,
  world_the_end: <Globe size={18} />,
  logs: <ScrollText size={18} />,
  'crash-reports': <FileWarning size={18} />,
  screenshots: <Camera size={18} />
}
function iconOf(e: DirEntry): ReactNode {
  if (e.dir) return FOLDER_ICON[e.name.toLowerCase()] ?? <Folder size={18} />
  if (/\.json5?$/i.test(e.name)) return <FileJson size={18} />
  if (/\.(ya?ml|toml|properties|cfg|conf|ini|mcfunction|js|zs)$/i.test(e.name)) return <FileCode size={18} />
  if (/\.(txt|md|log|csv|lang|list)$/i.test(e.name)) return <FileText size={18} />
  if (/\.(jar|zip|gz|mrpack|disabled)$/i.test(e.name)) return <FileArchive size={18} />
  if (/\.(png|jpe?g|gif|webp)$/i.test(e.name)) return <FileImage size={18} />
  return <File size={18} />
}

const size = (b: number): string => (b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)}MB` : b >= 1024 ? `${Math.round(b / 1024)}KB` : `${b}B`)
const when = (t: number): string => new Date(t).toLocaleString('ko-KR', { year: '2-digit', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const join = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name)

// 서버 폴더 파일 탐색기: 폴더를 오가며 보고, 설정 파일은 눌러서 고친다
export default function FilesTab({ folderPath, serverOn }: { folderPath: string; serverOn: boolean }) {
  const toast = useToast()
  const [cwd, setCwd] = useState('') // 지금 보고 있는 폴더 (서버 폴더 기준)
  const [entries, setEntries] = useState<DirEntry[] | null>(null)
  const [filter, setFilter] = useState('')
  const [desc, setDesc] = useState(false) // 이름 거꾸로
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<{ x: number; y: number; items: (MenuItem | 'sep')[] } | null>(null)
  const [naming, setNaming] = useState<{ title: string; initial: string; confirm: string; run: (name: string) => Promise<void> } | null>(null)
  const [askTrash, setAskTrash] = useState<string[] | null>(null)
  const [editing, setEditing] = useState<string | null>(null) // 오른쪽 편집기에 연 파일
  const rootRef = useRef<HTMLDivElement>(null)
  // 마우스 뒤로 버튼: 한 단계 위 폴더로
  useMouseBack(rootRef, cwd ? () => setCwd(cwd.includes('/') ? cwd.slice(0, cwd.lastIndexOf('/')) : '') : null)
  const editorDirty = useRef(false) // 편집기에 저장 안 한 내용이 있는지
  const [askSwitch, setAskSwitch] = useState<{ to: string | null } | null>(null) // 저장 안 한 채 다른 파일을 열거나 닫으려 함
  // 편집기에 파일을 연다 (null이면 닫는다). 저장 안 한 내용이 있으면 먼저 묻는다
  const requestOpen = (rel: string | null): void => {
    if (rel === editing) return
    if (editorDirty.current) setAskSwitch({ to: rel })
    else setEditing(rel)
  }

  const load = useCallback(
    (dir: string) => {
      setEntries(null)
      window.api
        .listDir(folderPath, dir)
        .then(setEntries)
        .catch((e) => {
          toast(cleanError(e), 'error')
          setEntries([])
        })
    },
    [folderPath, toast]
  )

  useEffect(() => {
    setCwd('')
    setEditing(null)
  }, [folderPath])

  useEffect(() => {
    setSelected(new Set())
    setFilter('')
    load(cwd)
  }, [cwd, load])

  const shown = useMemo(() => {
    const list = (entries ?? []).filter((e) => matchesFilter(filter, e.name))
    // 폴더 먼저, 그다음 이름 순
    list.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, 'ko', { numeric: true }) * (desc ? -1 : 1))
    return list
  }, [entries, filter, desc])

  const openEntry = (e: DirEntry): void => {
    const rel = join(cwd, e.name)
    if (e.dir) setCwd(rel)
    else if (e.editable) requestOpen(rel)
    else void window.api.revealEntry(folderPath, rel)
  }

  const act = async (work: () => Promise<unknown>, done?: string): Promise<void> => {
    try {
      await work()
      if (done) toast(done)
      load(cwd)
    } catch (e) {
      toast(cleanError(e), 'error')
    }
  }

  const rowMenu = (e: DirEntry, x: number, y: number): void => {
    const rel = join(cwd, e.name)
    const lockedWhy = serverOn ? '서버를 끈 다음에 할 수 있어요' : undefined
    setMenu({
      x,
      y,
      items: [
        e.dir
          ? { label: '열기', icon: <FolderOpen size={15} />, onClick: () => setCwd(rel) }
          : e.editable
            ? { label: '편집하기', icon: <Pencil size={15} />, onClick: () => requestOpen(rel) }
            : { label: '탐색기에서 보기', icon: <FolderOpen size={15} />, onClick: () => void window.api.revealEntry(folderPath, rel) },
        ...(e.dir || e.editable ? [{ label: '탐색기에서 보기', icon: <FolderOpen size={15} />, onClick: () => void window.api.revealEntry(folderPath, rel) }] : []),
        'sep',
        {
          label: lockedWhy ? '이름 바꾸기 (서버를 끈 뒤에)' : '이름 바꾸기',
          icon: <Pencil size={15} />,
          disabled: serverOn,
          onClick: () => setNaming({ title: '이름 바꾸기', initial: e.name, confirm: '바꾸기', run: (name) => act(() => window.api.renameEntry(folderPath, rel, name), '이름을 바꿨어요') })
        },
        { label: lockedWhy ? '휴지통으로 (서버를 끈 뒤에)' : '휴지통으로', icon: <Trash2 size={15} />, danger: true, disabled: serverOn, onClick: () => setAskTrash([rel]) }
      ]
    })
  }

  const addMenu = (x: number, y: number): void =>
    setMenu({
      x,
      y,
      items: [
        { label: '새 폴더', icon: <FolderPlus size={15} />, onClick: () => setNaming({ title: '새 폴더', initial: '', confirm: '만들기', run: (name) => act(() => window.api.createEntry(folderPath, cwd, name, 'dir'), '폴더를 만들었어요') }) },
        {
          label: '새 파일',
          icon: <FilePlus size={15} />,
          onClick: () =>
            setNaming({
              title: '새 파일',
              initial: '.yml',
              confirm: '만들기',
              run: async (name) => {
                try {
                  const rel = await window.api.createEntry(folderPath, cwd, name, 'file')
                  load(cwd)
                  requestOpen(rel) // 만들고 바로 연다
                } catch (e) {
                  toast(cleanError(e), 'error')
                }
              }
            })
        },
        'sep',
        { label: '탐색기에서 이 폴더 열기', icon: <FolderOpen size={15} />, onClick: () => void window.api.revealEntry(folderPath, cwd) }
      ]
    })

  const allChecked = shown.length > 0 && shown.every((e) => selected.has(e.name))
  return (
    <div className="files-split" ref={rootRef}>
    <div className="files-tab">
      <div className="files-top">
        <Crumbs path={cwd} onGo={setCwd} />
        <div className="files-actions">
          <InstalledFilter value={filter} onChange={setFilter} placeholder="이 폴더에서 찾기" />
          <button className="btn" onClick={() => load(cwd)} title="새로고침">
            <RefreshCw size={15} />
            새로고침
          </button>
          <button
            className="btn"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              addMenu(r.left, r.bottom + 4)
            }}
            title="새로 만들기"
          >
            <Plus size={16} />
            <ChevronDown size={14} />
          </button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="files-selbar">
          <b>{selected.size}개 골랐어요</b>
          <span style={{ flex: 1 }} />
          <button className="btn sm ghost" onClick={() => setSelected(new Set())}>
            고르기 풀기
          </button>
          <button className="btn sm danger" disabled={serverOn} title={serverOn ? '서버를 끈 다음에 할 수 있어요' : undefined} onClick={() => setAskTrash([...selected].map((n) => join(cwd, n)))}>
            <Trash2 size={14} />
            휴지통으로
          </button>
        </div>
      )}

      <div className="files-table">
        <div className="files-row head">
          <input type="checkbox" checked={allChecked} onChange={(e) => setSelected(e.target.checked ? new Set(shown.map((x) => x.name)) : new Set())} aria-label="모두 고르기" />
          <button className="files-sort" onClick={() => setDesc((v) => !v)}>
            이름 {desc ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          <span className="files-col-size">크기</span>
          <span className="files-col-date">바꾼 날짜</span>
          <span className="files-col-act">메뉴</span>
        </div>
        <div className="files-body">
          {entries === null && <Skeleton small count={6} />}
          {entries && shown.length === 0 && <Empty icon={<Folder size={22} />} title={filter ? `'${filter}'에 맞는 것이 없어요` : '빈 폴더예요'} />}
          {shown.map((e) => (
            <div
              key={e.name}
              className={`files-row ${selected.has(e.name) ? 'checked' : ''} ${editing === join(cwd, e.name) ? 'editing' : ''}`}
              onDoubleClick={() => openEntry(e)}
              onContextMenu={(ev) => {
                ev.preventDefault()
                rowMenu(e, ev.clientX, ev.clientY)
              }}
            >
              <input
                type="checkbox"
                checked={selected.has(e.name)}
                onChange={(ev) =>
                  setSelected((cur) => {
                    const n = new Set(cur)
                    if (ev.target.checked) n.add(e.name)
                    else n.delete(e.name)
                    return n
                  })
                }
                aria-label={`${e.name} 고르기`}
              />
              <button className={`files-name ${e.dir ? 'is-dir' : e.editable ? 'is-text' : ''}`} onClick={() => openEntry(e)} title={e.dir ? '열기' : e.editable ? '편집하기' : '탐색기에서 보기'}>
                <span className="files-icon">{iconOf(e)}</span>
                <span className="files-label">{e.name}</span>
              </button>
              <span className="files-col-size">{e.dir ? '' : size(e.size)}</span>
              <span className="files-col-date">{when(e.modified)}</span>
              <button
                className="btn icon sm ghost files-col-act"
                aria-label="메뉴"
                onClick={(ev) => {
                  const r = ev.currentTarget.getBoundingClientRect()
                  rowMenu(e, r.right - 170, r.bottom + 4)
                }}
              >
                <MoreHorizontal size={16} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {naming && <NameDialog {...naming} onCancel={() => setNaming(null)} onDone={() => setNaming(null)} />}
      {askTrash && (
        <Confirm
          title={askTrash.length > 1 ? `${askTrash.length}개를 휴지통으로 옮길까요?` : `${askTrash[0].split('/').pop()}을(를) 휴지통으로 옮길까요?`}
          body="휴지통에서 되살릴 수 있어요. 모드·월드 파일을 지우면 서버가 켜지지 않을 수 있어요."
          confirmText="휴지통으로"
          danger
          onCancel={() => setAskTrash(null)}
          onConfirm={() => {
            const rels = askTrash
            setAskTrash(null)
            void act(() => window.api.trashEntries(folderPath, rels), '휴지통으로 옮겼어요')
          }}
        />
      )}
    </div>

    <div className="files-right">
      {editing ? (
        <FileEditor
          key={editing}
          folderPath={folderPath}
          rel={editing}
          serverOn={serverOn}
          onDirty={(d) => (editorDirty.current = d)}
          onClose={() => requestOpen(null)}
          onFailed={() => {
            editorDirty.current = false
            setEditing(null)
          }}
        />
      ) : (
        <Empty icon={<FileText size={22} />} title="왼쪽에서 고칠 파일을 눌러 주세요" hint="yml·json·toml·properties 같은 설정 파일이 여기서 열려요. 모드·플러그인 설정은 config·plugins 폴더에 있어요." />
      )}
    </div>

    {askSwitch && (
      <Confirm
        title="저장하지 않았어요"
        body={`${editing?.split('/').pop()}에서 고친 내용을 저장하지 않고 ${askSwitch.to ? '다른 파일을 열까요' : '닫을까요'}?`}
        confirmText={askSwitch.to ? '저장 안 하고 열기' : '저장 안 하고 닫기'}
        danger
        onCancel={() => setAskSwitch(null)}
        onConfirm={() => {
          editorDirty.current = false
          setEditing(askSwitch.to)
          setAskSwitch(null)
        }}
      />
    )}
    </div>
  )
}

// 🏠 › config › 폴더 (누르면 그 폴더로)
function Crumbs({ path, onGo }: { path: string; onGo: (p: string) => void }) {
  const parts = path ? path.split('/') : []
  return (
    <nav className="files-crumbs">
      <button className="crumb-home" onClick={() => onGo('')} title="서버 폴더 맨 위">
        <House size={16} />
      </button>
      {parts.map((p, i) => (
        <span key={i} className="crumb">
          <ChevronRight size={14} />
          <button onClick={() => onGo(parts.slice(0, i + 1).join('/'))} disabled={i === parts.length - 1}>
            {p}
          </button>
        </span>
      ))}
    </nav>
  )
}

function NameDialog({ title, initial, confirm, run, onCancel, onDone }: { title: string; initial: string; confirm: string; run: (name: string) => Promise<void>; onCancel: () => void; onDone: () => void }) {
  const [name, setName] = useState(initial)
  const [busy, setBusy] = useState(false)
  return (
    <Modal onClose={busy ? undefined : onCancel}>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          if (!name.trim() || busy) return
          setBusy(true)
          await run(name.trim())
          onDone()
        }}
      >
        <h2>{title}</h2>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          maxLength={120}
          onFocus={(e) => {
            // 확장자 앞까지만 골라 둔다 (이름만 바로 고치게)
            const dot = e.target.value.lastIndexOf('.')
            e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length)
          }}
        />
        <div className="actions">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            취소
          </button>
          <button type="submit" className="btn primary" disabled={busy || !name.trim()}>
            {busy && <span className="spinner" />}
            {confirm}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ---------- 편집기 ----------
function FileEditor({ folderPath, rel, serverOn, onDirty, onClose, onFailed }: { folderPath: string; rel: string; serverOn: boolean; onDirty: (dirty: boolean) => void; onClose: () => void; onFailed: () => void }) {
  const toast = useToast()
  const [open, setOpen] = useState<{ text: string; modified: number } | null>(null)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [askBadJson, setAskBadJson] = useState<string | null>(null)
  const [find, setFind] = useState('')
  const editor = useRef<HTMLTextAreaElement>(null)
  const gutter = useRef<HTMLDivElement>(null)
  const findBox = useRef<HTMLInputElement>(null)
  const dirty = !!open && text !== open.text

  useEffect(() => {
    window.api
      .readConfigFile(folderPath, rel)
      .then((f) => {
        setOpen(f)
        setText(f.text)
      })
      .catch((e) => {
        toast(cleanError(e), 'error')
        onFailed()
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderPath, rel])

  // 저장 안 한 내용이 있는지 부모에게 알린다 (중괄호: 돌려준 값을 React가 정리 함수로 착각하지 않게)
  useEffect(() => {
    onDirty(dirty)
  }, [dirty, onDirty])

  // JSON 파일은 저장 전에 형식이 맞는지 본다 (틀리면 모드가 설정을 못 읽고 기본값으로 덮어쓸 수 있다)
  function jsonProblem(): string | null {
    if (!/\.json$/i.test(rel)) return null
    try {
      JSON.parse(text)
      return null
    } catch (e) {
      const m = /position (\d+)/.exec(String((e as Error).message))
      return m ? `${text.slice(0, Number(m[1])).split('\n').length}번째 줄 근처에 틀린 곳이 있어요.` : 'JSON 형식이 맞지 않아요.'
    }
  }

  async function save(force = false) {
    if (!open || !dirty || saving) return
    const problem = force ? null : jsonProblem()
    if (problem) return setAskBadJson(problem)
    setSaving(true)
    try {
      const modified = await window.api.writeConfigFile(folderPath, rel, text, open.modified)
      setOpen({ text, modified })
      toast(serverOn ? '저장했어요. 서버를 다시 켜면 적용돼요' : '저장했어요')
    } catch (e) {
      toast(cleanError(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  function findNext() {
    const el = editor.current
    if (!el || !find) return
    const hay = text.toLowerCase()
    const needle = find.toLowerCase()
    let at = hay.indexOf(needle, el.selectionEnd)
    if (at === -1) at = hay.indexOf(needle)
    if (at === -1) return toast(`'${find}'을(를) 찾지 못했어요`, 'error')
    el.focus()
    el.setSelectionRange(at, at + find.length)
    el.scrollTop = Math.max(0, (text.slice(0, at).split('\n').length - 5) * 20) // 줄 높이 20px
  }

  // Ctrl+S 저장, Ctrl+F 찾기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.defaultPrevented) return
      const k = e.key.toLowerCase()
      if (k === 's') {
        e.preventDefault()
        void save()
      }
      if (k === 'f') {
        e.preventDefault()
        findBox.current?.focus()
        findBox.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="files-editor-pane">
      <div className="editor-head">
        <span className="files-icon">
          <FileText size={16} />
        </span>
        <b className="editor-path" title={rel}>
          <span className="editor-file">{rel.split('/').pop()}</span>
          {rel.includes('/') && <span className="editor-dir">{rel.slice(0, rel.lastIndexOf('/'))}</span>}
        </b>
        {dirty && <span className="dirty-dot" title="저장 안 한 내용이 있어요" />}
        <span style={{ flex: 1 }} />
        <div className="editor-find">
          <Search size={14} />
          <input ref={findBox} value={find} onChange={(e) => setFind(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), findNext())} placeholder="찾기 (Enter)" />
        </div>
        <button className="btn sm ghost" onClick={() => open && setText(open.text)} disabled={!dirty || saving} title="저장하지 않은 고친 내용을 버려요">
          <RotateCcw size={15} />
          되돌리기
        </button>
        <button className="btn sm primary" onClick={() => save()} disabled={!dirty || saving} title="Ctrl+S">
          {saving ? <span className="spinner" /> : <Save size={15} />}
          저장
        </button>
        <button className="btn icon sm ghost" onClick={onClose} title="닫기" aria-label="닫기">
          <X size={16} />
        </button>
      </div>
      {serverOn && <div className="banner">서버가 켜져 있어요. 저장한 내용은 서버를 다시 켜야 적용되고, 어떤 파일은 서버가 꺼질 때 다시 덮어써요.</div>}
      <div className="files-editor">
        {!open ? (
          <Skeleton small count={4} />
        ) : (
          <div className="editor-body">
            <div className="editor-gutter" ref={gutter} aria-hidden>
              {Array.from({ length: text.split('\n').length }, (_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
            <textarea
              ref={editor}
              className="editor-text"
              value={text}
              spellCheck={false}
              wrap="off"
              autoFocus
              onChange={(e) => setText(e.target.value)}
              onScroll={(e) => gutter.current && (gutter.current.scrollTop = e.currentTarget.scrollTop)}
              onKeyDown={(e) => {
                // Tab은 칸 이동 대신 공백 2칸 (yml은 탭 문자를 못 읽는다)
                if (e.key !== 'Tab') return
                e.preventDefault()
                const el = e.currentTarget
                const { selectionStart: a, selectionEnd: b } = el
                setText(text.slice(0, a) + '  ' + text.slice(b))
                requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2))
              }}
            />
          </div>
        )}
      </div>

      {askBadJson && (
        <Confirm
          title="형식이 맞지 않아요"
          body={`${askBadJson} 이대로 저장하면 모드가 설정을 읽지 못하고 기본값으로 되돌릴 수 있어요. 그래도 저장할까요?`}
          confirmText="그래도 저장"
          danger
          onCancel={() => setAskBadJson(null)}
          onConfirm={() => {
            setAskBadJson(null)
            void save(true)
          }}
        />
      )}
    </div>
  )
}
