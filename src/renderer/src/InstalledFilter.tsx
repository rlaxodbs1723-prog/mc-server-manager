import { Search, X } from 'lucide-react'

// 설치된 목록을 이름으로 거르는 작은 검색창
export default function InstalledFilter({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="search-box installed-filter">
      <Search size={16} />
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      {value && (
        <button className="btn icon sm ghost clear" onClick={() => onChange('')} title="지우기">
          <X size={14} />
        </button>
      )}
    </div>
  )
}

// 이름·파일 이름에 검색어가 들어 있는지 (대소문자·띄어쓰기 무시)
export function matchesFilter(q: string, ...texts: (string | undefined)[]): boolean {
  const n = (s: string): string => s.toLowerCase().replace(/\s+/g, '')
  const k = n(q)
  return !k || texts.some((t) => !!t && n(t).includes(k))
}
