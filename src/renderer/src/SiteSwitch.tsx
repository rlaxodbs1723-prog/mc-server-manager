import { useEffect, useState } from 'react'
import type { SearchSite } from '../../shared-types'

const SITES: { id: SearchSite; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'modrinth', label: 'Modrinth' },
  { id: 'curseforge', label: 'CurseForge' }
]

// 검색할 사이트 고르기 (전체 / Modrinth / CurseForge)
export default function SiteSwitch({ value, onChange }: { value: SearchSite; onChange: (s: SearchSite) => void }) {
  const [hasKey, setHasKey] = useState(true)
  useEffect(() => {
    window.api
      .hasCurseForgeKey()
      .then((has) => {
        setHasKey(has)
        if (!has && value === 'curseforge') onChange('all') // 전에 골라 둔 CurseForge를 지금은 쓸 수 없으면 전체로
      })
      .catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div className="seg site-switch">
      {SITES.map((s) => {
        const off = s.id === 'curseforge' && !hasKey
        return (
          <button
            key={s.id}
            className={value === s.id ? 'active' : ''}
            onClick={() => onChange(s.id)}
            disabled={off}
            title={off ? 'CurseForge API 키가 없어서 쓸 수 없어요' : undefined}
          >
            {s.label}
          </button>
        )
      })}
    </div>
  )
}
