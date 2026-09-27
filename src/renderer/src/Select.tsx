import { Check, ChevronDown, Search } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { overlay } from './ui'

export interface Option {
  value: string
  label: string
  tag?: string // 오른쪽에 작게 붙는 표시 (추천, 베타 등)
}

interface Props {
  value: string
  options: Option[]
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  searchPlaceholder?: string
}

const SEARCH_THRESHOLD = 10 // 항목이 이보다 많으면 검색 칸을 보여 준다

// 윈도우 기본 드롭다운 대신 쓰는 선택 상자
export default function Select({ value, options, onChange, disabled, placeholder, searchPlaceholder }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0) // 키보드로 가리키는 항목
  const [pos, setPos] = useState<React.CSSProperties>({})
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const current = options.find((o) => o.value === value)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options
  }, [options, query])

  // 열 때: 검색어 초기화, 고른 항목을 가리키고, 목록 위치를 정한다.
  // 목록은 화면 맨 위 층(body)에 그려서 스크롤 영역·창에 잘리지 않게 하고, 아래 공간이 모자라면 위로 연다.
  useLayoutEffect(() => {
    if (!open) return
    setQuery('')
    setActive(Math.max(0, options.findIndex((o) => o.value === value)))
    const rect = rootRef.current?.getBoundingClientRect()
    if (rect) {
      const below = window.innerHeight - rect.bottom
      const up = below < 320 && rect.top > below
      setPos(
        up
          ? { left: rect.left, width: rect.width, bottom: window.innerHeight - rect.top + 8 }
          : { left: rect.left, width: rect.width, top: rect.bottom + 8 }
      )
    }
    setTimeout(() => searchRef.current?.focus(), 0)
    overlay.dropdowns++
    return () => {
      overlay.dropdowns--
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // 바깥을 누르거나, 뒤쪽이 스크롤되거나, 창 크기가 바뀌면 닫는다 (목록 위치가 어긋나므로)
  useEffect(() => {
    if (!open) return
    const inside = (t: EventTarget | null) => rootRef.current?.contains(t as Node) || menuRef.current?.contains(t as Node)
    const onDown = (e: MouseEvent) => !inside(e.target) && setOpen(false)
    const onScroll = (e: Event) => !inside(e.target) && setOpen(false)
    const onResize = () => setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  // 가리키는 항목이 보이도록 스크롤
  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  function pick(o: Option) {
    onChange(o.value)
    setOpen(false)
  }

  function onKey(e: React.KeyboardEvent) {
    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault()
        setOpen(true)
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered[active]) pick(filtered[active])
    }
  }

  return (
    <div className={`dropdown ${open ? 'open' : ''}`} ref={rootRef} onKeyDown={onKey}>
      <button type="button" className="dropdown-trigger" onClick={() => setOpen((o) => !o)} disabled={disabled}>
        <span className={current ? '' : 'muted'}>{current?.label ?? placeholder ?? '선택해 주세요'}</span>
        {current?.tag && <span className="chip blue">{current.tag}</span>}
        <ChevronDown size={18} className="chev" />
      </button>

      {open &&
        createPortal(
        <div className="dropdown-menu floating" style={pos} ref={menuRef}>
          {options.length > SEARCH_THRESHOLD && (
            <div className="dropdown-search">
              <Search size={16} />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setActive(0)
                }}
                placeholder={searchPlaceholder ?? '검색'}
              />
            </div>
          )}
          <div className="dropdown-list" ref={listRef} role="listbox">
            {filtered.length === 0 && <div className="dropdown-empty">찾는 항목이 없어요</div>}
            {filtered.map((o, i) => (
              <button
                type="button"
                key={o.value}
                data-i={i}
                role="option"
                aria-selected={o.value === value}
                className={`dropdown-item ${i === active ? 'active' : ''} ${o.value === value ? 'selected' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o)}
              >
                <span className="label-text">{o.label}</span>
                {o.tag && <span className={`chip ${o.tag === '베타' || o.tag === '스냅샷' ? 'warn' : 'blue'}`}>{o.tag}</span>}
                {o.value === value && <Check size={16} className="check" />}
              </button>
            ))}
          </div>
        </div>,
          document.body
        )}
    </div>
  )
}
