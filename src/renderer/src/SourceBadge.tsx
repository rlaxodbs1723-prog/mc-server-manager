import type { ModpackSource } from '../../shared-types'

// 검색 결과가 어느 사이트 것인지 작게 표시한다 (Modrinth·CurseForge를 한 목록에 섞어 보여 주므로)
export default function SourceBadge({ source }: { source?: ModpackSource }) {
  if (!source) return null
  return (
    <span className={`src-badge ${source}`} title={source === 'modrinth' ? 'Modrinth' : 'CurseForge'}>
      {source === 'modrinth' ? 'M' : 'CF'}
    </span>
  )
}
