import { Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLeaveAnimation } from './leave'
import type { GameRule } from '../../shared-types'
import { CATEGORIES, labelOf, type Category } from './gameruleLabels'
import { Empty, Loading, useToast } from './ui'
import { cleanError } from './util'

// 게임 규칙 창. 켜진 서버에 물어서 목록과 값을 가져오고, 바꾸면 바로 적용한다.
export default function GameRulesDialog({ folderPath, onClose }: { folderPath: string; onClose: () => void }) {
  const leaveRef = useRef<HTMLDivElement>(null)
  useLeaveAnimation(leaveRef) // 닫힐 때도 부드럽게 사라지게
  const toast = useToast()
  const [rules, setRules] = useState<GameRule[] | null>(null)
  const [error, setError] = useState('')
  const [cat, setCat] = useState<Category | '전체'>('전체')
  const [query, setQuery] = useState('')
  const [lang, setLang] = useState<Record<string, string>>({}) // 게임과 같은 이름을 위한 공식 번역

  useEffect(() => {
    window.api
      .listGameRules(folderPath)
      .then(setRules)
      .catch((e) => setError(cleanError(e)))
    window.api.getGameRuleLang(folderPath).then(setLang)
  }, [folderPath])

  // Esc·바깥 클릭으로 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const items = useMemo(
    () =>
      (rules ?? [])
        .map((r) => ({ ...r, ...labelOf(r.name, lang) }))
        .sort((a, b) => a.label.localeCompare(b.label, 'ko')),
    [rules, lang]
  )
  const q = query.trim().toLowerCase()
  const shown = items.filter(
    (r) => (cat === '전체' || r.category === cat) && (!q || r.label.toLowerCase().includes(q) || r.name.toLowerCase().includes(q) || r.desc.includes(q))
  )

  async function change(rule: GameRule, value: string) {
    if (value === rule.value) return
    setRules((list) => list?.map((r) => (r.name === rule.name ? { ...r, value } : r)) ?? null)
    try {
      await window.api.setGameRule(folderPath, rule.name, value)
      toast(`${labelOf(rule.name, lang).label}: ${value === 'true' ? '켜짐' : value === 'false' ? '꺼짐' : value}`)
    } catch (e) {
      setRules((list) => list?.map((r) => (r.name === rule.name ? { ...r, value: rule.value } : r)) ?? null) // 되돌리기
      toast(cleanError(e), 'error')
    }
  }

  return (
    <div className="backdrop" ref={leaveRef} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="settings-modal" role="dialog" aria-modal="true">
        <nav className="settings-nav">
          <h2>게임 규칙</h2>
          {(['전체', ...CATEGORIES] as const).map((c) => (
            <button key={c} className={cat === c ? 'active' : ''} onClick={() => setCat(c)}>
              {c}
              <span className="nav-count">{c === '전체' ? items.length : items.filter((r) => r.category === c).length}</span>
            </button>
          ))}
        </nav>
        <section className="settings-body">
          <header>
            <div className="search-box" style={{ flex: 1, marginRight: 12 }}>
              <Search size={18} />
              <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="규칙 이름으로 찾기" autoFocus />
            </div>
            <button className="btn icon sm ghost" onClick={onClose} aria-label="닫기">
              <X size={18} />
            </button>
          </header>
          <div className="settings-content">
            {error && <p className="error-text">{error}</p>}
            {!error && !rules && <Loading text="서버에 물어보고 있어요" />}
            {rules && shown.length === 0 && <Empty title="찾는 규칙이 없어요" />}
            {shown.map((r) => (
              <div key={r.name} className="setting-row">
                <div className="setting-text">
                  <div className="setting-label">{r.label}</div>
                  <div className="setting-desc">
                    {r.desc && <>{r.desc} · </>}
                    <code className="rule-name">{r.name}</code>
                  </div>
                </div>
                {r.type === 'bool' ? (
                  <label className="switch">
                    <input type="checkbox" checked={r.value === 'true'} onChange={(e) => change(r, String(e.target.checked))} />
                    <span />
                  </label>
                ) : (
                  <RuleNumber value={r.value} onCommit={(v) => change(r, v)} />
                )}
              </div>
            ))}
          </div>
          <footer>
            <span className="hint">바꾸면 바로 적용돼요.</span>
          </footer>
        </section>
      </div>
    </div>
  )
}

// 숫자 규칙: 입력을 마치면(Enter·다른 곳 클릭) 적용한다
function RuleNumber({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const commit = () => {
    const n = Math.round(Number(text))
    if (!Number.isFinite(n)) return setText(value)
    onCommit(String(n))
  }
  return (
    <div className="num-input">
      <input
        type="number"
        className="input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      />
    </div>
  )
}
