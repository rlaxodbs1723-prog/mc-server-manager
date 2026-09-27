// 여러 화면에서 같이 쓰는 작은 UI 조각들
import { SOFTWARE_ICONS } from './softwareIcons'
import { CheckCircle2, AlertCircle } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { SOFTWARE_INFO, type Progress, type Software } from '../../shared-types'
import { progressPercent, progressText } from './util'
import { useLeaveAnimation } from './leave'

// ---------- 서버 종류 배지 ----------
const SW_COLOR: Record<Software, string> = {
  vanilla: '#5dbb63',
  paper: '#6aa7ff',
  purpur: '#b98cff',
  fabric: '#dcc7a1',
  quilt: '#c490ff',
  forge: '#f29a55',
  neoforge: '#ff7a45'
}

// name을 주면 그 이름의 첫 글자를, 없으면 서버 종류의 첫 글자를 보여 준다. 색은 서버 종류를 따른다.
export function SoftwareBadge({ software, size = 40, name, icon }: { software: Software; size?: number; name?: string; icon?: string | null }) {
  // 서버 아이콘을 정했으면 글자 대신 그 그림을 보여 준다
  if (icon) return <img className="sw-badge sw-icon" src={icon} alt="" style={{ width: size, height: size, borderRadius: size * 0.3 }} />
  const color = SW_COLOR[software] ?? SW_COLOR.vanilla
  const letter = [...(name?.trim() ?? '')][0]?.toUpperCase() ?? SOFTWARE_INFO[software]?.label[0] ?? '?'
  // 이름이 없으면(서버 종류 고르기 화면) 글자 대신 그 종류의 아이콘을 보여 준다
  const svg = name == null ? SOFTWARE_ICONS[software] : undefined
  if (svg)
    return (
      <span
        className="sw-badge sw-logo"
        style={{ width: size, height: size, color, background: `${color}24`, borderRadius: size * 0.3, ['--logo' as string]: `${Math.round(size * 0.56)}px` }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    )
  return (
    <span
      className="sw-badge"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        color,
        background: `${color}24`,
        borderRadius: size * 0.3
      }}
    >
      {letter}
    </span>
  )
}

// ---------- 진행 표시 ----------
export function ProgressView({ progress }: { progress: Progress | null }) {
  const percent = progressPercent(progress)
  return (
    <div className="progress-card">
      <div className="row">
        <span className="spinner" />
        {progress ? progressText(progress) : '준비하고 있어요'}
      </div>
      <div className={`bar ${percent == null ? 'indeterminate' : ''}`}>
        <i style={percent == null ? undefined : { width: `${percent}%` }} />
      </div>
    </div>
  )
}

// ---------- 불러오는 중 · 빈 화면 · 자리 표시 ----------
// 모든 화면에서 같은 모양으로 보이도록 여기 것만 쓴다
export function Loading({ text = '불러오고 있어요', small }: { text?: string; small?: boolean }) {
  return (
    <div className={`state-loading ${small ? 'small' : ''}`}>
      <span className="spinner" />
      {text}
    </div>
  )
}

export function Empty({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: ReactNode }) {
  return (
    <div className="state-empty">
      {icon && <div className="state-icon">{icon}</div>}
      <div className="state-title">{title}</div>
      {hint && <div className="state-hint">{hint}</div>}
    </div>
  )
}

// 목록을 처음 불러오는 동안 카드 모양만 먼저 보여 준다 (다 불러와도 높이가 덜 흔들린다)
export function Skeleton({ count = 5, small }: { count?: number; small?: boolean }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`skel-card ${small ? 'small' : ''}`} style={{ animationDelay: `${i * 80}ms` }}>
          <div className="skel skel-icon" />
          <div className="skel-lines">
            <div className="skel" style={{ width: `${45 + ((i * 17) % 30)}%` }} />
            {!small && <div className="skel" style={{ width: `${70 + ((i * 11) % 25)}%` }} />}
          </div>
        </div>
      ))}
    </>
  )
}

// ---------- 모달 ----------
const modalStack: object[] = [] // 열린 순서 (맨 뒤가 맨 위 창)
// 지금 열려 있는 드롭다운 수. 드롭다운이 열려 있으면 Esc는 드롭다운을 닫는 데만 쓴다
export const overlay = { dropdowns: 0 }
export function Modal({ children, onClose }: { children: ReactNode; onClose?: () => void }) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  // 창이 여러 개 겹쳐 있으면 맨 위 창만 Esc를 받는다. 열릴 때 한 번만 쌓아야 순서가 섞이지 않는다.
  // 캡처 단계에서 처리 표시(preventDefault)를 해 두면 뒤에 깔린 설정 창 같은 것도 이 Esc를 무시한다.
  useEffect(() => {
    const token = {}
    modalStack.push(token)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || overlay.dropdowns > 0 || modalStack[modalStack.length - 1] !== token) return
      e.preventDefault() // 닫을 수 없는 창(onClose 없음)이어도 뒤 창으로 넘기지 않는다
      closeRef.current?.()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      modalStack.splice(modalStack.indexOf(token), 1)
    }
  }, [])
  const boxRef = useRef<HTMLDivElement>(null)
  useLeaveAnimation(boxRef)
  return (
    <div className="backdrop" ref={boxRef} onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  )
}

interface ConfirmProps {
  title: string
  body: ReactNode
  confirmText: string
  cancelText?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
  onDismiss?: () => void // Esc·바깥 클릭 (없으면 onCancel과 같다)
}

export function Confirm({ title, body, confirmText, cancelText = '취소', danger, onConfirm, onCancel, onDismiss }: ConfirmProps) {
  return (
    <Modal onClose={onDismiss ?? onCancel}>
      <h2>{title}</h2>
      <div className="body">{body}</div>
      <div className="actions">
        {/* Enter를 누르면 포커스된 버튼이 눌린다: 위험한 동작은 취소가, 아니면 확인이 먼저 */}
        <button className="btn" onClick={onCancel} autoFocus={danger}>
          {cancelText}
        </button>
        <button className={`btn ${danger ? 'danger' : 'primary'}`} onClick={onConfirm} autoFocus={!danger}>
          {confirmText}
        </button>
      </div>
    </Modal>
  )
}

// ---------- 토스트 ----------
type ToastKind = 'success' | 'error' | 'info'
// 알림에 붙는 버튼 (예: 되돌리기). 누르면 알림이 바로 닫힌다
export interface ToastAction {
  label: string
  onClick: () => void
}
interface ToastItem {
  id: number
  kind: ToastKind
  text: string
  action?: ToastAction
}

const ToastContext = createContext<(text: string, kind?: ToastKind, action?: ToastAction) => void>(() => {})
export const useToast = () => useContext(ToastContext)

let nextId = 1
export const UNDO_MS = 6000 // 되돌리기 버튼이 떠 있는 시간

// 닫힐 때 부드럽게 사라지는 상자 (작업 목록 같은 펼침 창에 쓴다)
export function LeaveBox({ className, children }: { className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useLeaveAnimation(ref)
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  )
}

function ToastBox({ kind, children }: { kind: ToastKind; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useLeaveAnimation(ref)
  return (
    <div ref={ref} className={`toast ${kind}`} role="status">
      {children}
    </div>
  )
}

// 알림은 한 번에 하나만 보인다. 새 알림이 오면 떠 있던 것의 내용을 바꾸고 사라지는 시간을 다시 센다.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const show = useCallback((text: string, kind: ToastKind = 'success', action?: ToastAction) => {
    const id = nextId++
    setToast((cur) => ({ id: cur?.id ?? id, kind, text, action })) // 같은 id를 유지해 새로 튀어나오지 않고 내용만 바뀐다
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), action ? UNDO_MS : kind === 'error' ? 5000 : 2600)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts">
        {toast && (
          <ToastBox key={toast.id} kind={toast.kind}>
            {toast.kind === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
            {toast.text}
            {toast.action && (
              <button
                className="toast-action"
                onClick={() => {
                  toast.action?.onClick()
                  clearTimeout(timer.current)
                  setToast(null)
                }}
              >
                {toast.action.label}
              </button>
            )}
          </ToastBox>
        )}
      </div>
    </ToastContext.Provider>
  )
}
