import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLeaveAnimation } from './leave'

export interface MenuItem {
  label: string
  icon?: ReactNode
  danger?: boolean
  disabled?: boolean
  onClick: () => void
}

// 우클릭 메뉴: 누른 자리에 뜨고, 바깥을 누르거나 Esc·스크롤·창 크기 변경이면 닫힌다
export default function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: (MenuItem | 'sep')[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useLeaveAnimation(ref) // 닫힐 때도 부드럽게
  const [pos, setPos] = useState({ x, y })

  // 화면 밖으로 넘치면 안쪽으로 옮긴다
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({ x: Math.min(x, window.innerWidth - r.width - 8), y: Math.min(y, window.innerHeight - r.height - 8) })
  }, [x, y])

  useEffect(() => {
    const close = (e: Event) => {
      if (e.type === 'mousedown' && ref.current?.contains(e.target as Node)) return
      onClose()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    window.addEventListener('wheel', close, { passive: true })
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('wheel', close)
      window.removeEventListener('keydown', key)
    }
  }, [onClose])

  return createPortal(
    <div className="ctx-menu" ref={ref} style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) =>
        it === 'sep' ? (
          <div className="ctx-sep" key={i} />
        ) : (
          <button
            key={i}
            className={it.danger ? 'danger' : ''}
            disabled={it.disabled}
            onClick={() => {
              onClose()
              it.onClick()
            }}
          >
            {it.icon}
            {it.label}
          </button>
        )
      )}
    </div>,
    document.body
  )
}
