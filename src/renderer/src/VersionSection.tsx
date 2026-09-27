import { useEffect, useState } from 'react'
import { SOFTWARE_INFO, type LoaderVersion, type McVersion, type Software } from '../../shared-types'
import Select from './Select'
import { cleanError } from './util'

// 고른 버전 (저장하기를 누르면 바뀐다)
export interface PickedVersion {
  mcVersion: string
  loaderVersion: string
  downgrade: boolean // 지금보다 낮은 마인크래프트 버전
  ready: boolean // 로더 목록을 다 불러와서 바꿀 수 있는 상태
}

interface Props {
  serverOn: boolean
  software: Software
  mcVersion: string
  loaderVersion?: string
  picked: PickedVersion | null // null이면 지금 버전 그대로
  onPick: (p: PickedVersion | null) => void
}

const MODDED: Software[] = ['fabric', 'quilt', 'forge', 'neoforge']
export const versionLabel = (software: Software, v?: string): string => (v ? (software === 'paper' || software === 'purpur' ? `#${v}` : v) : '')

// 서버 설정 > 버전: 같은 서버 종류 안에서 마인크래프트 버전과 로더(빌드) 버전을 고른다
export default function VersionSection({ serverOn, software, mcVersion, loaderVersion, picked, onPick }: Props) {
  const info = SOFTWARE_INFO[software]
  const isBuild = software === 'paper' || software === 'purpur'
  const version = picked?.mcVersion ?? mcVersion
  const loader = picked?.loaderVersion ?? loaderVersion ?? ''
  const [versions, setVersions] = useState<McVersion[]>([])
  const [loaders, setLoaders] = useState<LoaderVersion[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    window.api
      .getVersions(true)
      .then((list) => setVersions(list.filter((v) => v.type === 'release' || v.id === mcVersion)))
      .catch((e) => setError(`버전 목록을 불러오지 못했어요. (${cleanError(e)})`))
  }, [mcVersion])

  const idx = (id: string) => versions.findIndex((v) => v.id === id)
  const isDowngrade = (v: string) => v !== mcVersion && idx(mcVersion) >= 0 && idx(v) > idx(mcVersion) // 목록은 최신순

  // 고른 값을 위로 알린다. 지금 버전과 같으면 null
  const report = (v: string, l: string, ready: boolean) =>
    onPick(v === mcVersion && (software === 'vanilla' || l === loaderVersion) ? null : { mcVersion: v, loaderVersion: l, downgrade: isDowngrade(v), ready })

  // 마인크래프트 버전을 고르면 그 버전의 로더 목록을 불러온다. 고른 로더가 목록에 없으면 가장 알맞은 것으로
  useEffect(() => {
    if (software === 'vanilla' || !version) return
    let alive = true
    setLoaders(null)
    window.api
      .getLoaderVersions(software, version)
      .then((list) => {
        if (!alive) return
        setLoaders(list)
        const keep = list.some((l) => l.version === loader) ? loader : version === mcVersion && loaderVersion && list.some((l) => l.version === loaderVersion) ? loaderVersion : (list[0]?.version ?? '')
        report(version, keep, list.length > 0)
      })
      .catch((e) => {
        if (!alive) return
        setLoaders([])
        setError(`${info.label} 정보를 불러오지 못했어요. (${cleanError(e)})`)
      })
    return () => {
      alive = false
    }
  }, [software, version, versions.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const mcChanged = version !== mcVersion
  const unsupported = software !== 'vanilla' && loaders !== null && loaders.length === 0

  return (
    <>
      <div className="setting-row col">
        <div className="setting-text">
          <div className="setting-label">지금 버전</div>
          <div className="setting-desc">
            {info.label} {mcVersion}
            {loaderVersion ? ` · ${versionLabel(software, loaderVersion)}` : ''}
            {serverOn && ' · 서버를 끈 다음에 바꿀 수 있어요'}
          </div>
        </div>
      </div>

      <div className="setting-row col">
        <div className="setting-text">
          <div className="setting-label">마인크래프트 버전</div>
        </div>
        <Select
          value={version}
          onChange={(v) => report(v, loader, software === 'vanilla')}
          disabled={!versions.length || serverOn}
          placeholder="불러오는 중…"
          searchPlaceholder="버전 검색 (예: 1.20)"
          options={versions.map((v) => ({ value: v.id, label: v.id, tag: v.id === mcVersion ? '지금' : undefined }))}
        />
      </div>

      {software !== 'vanilla' && (
        <div className="setting-row col">
          <div className="setting-text">
            <div className="setting-label">{isBuild ? `${info.label} 빌드` : `${info.label} 버전`}</div>
          </div>
          <Select
            value={loader}
            onChange={(l) => report(version, l, true)}
            disabled={!loaders?.length || serverOn}
            placeholder={loaders === null ? '불러오는 중…' : '지원하는 버전이 없어요'}
            searchPlaceholder="버전 검색"
            options={(loaders ?? []).map((l) => ({
              value: l.version,
              label: versionLabel(software, l.version),
              tag: !mcChanged && l.version === loaderVersion ? '지금' : l.stable ? undefined : '베타'
            }))}
          />
        </div>
      )}

      {error && <p className="error-text">{error}</p>}
      {unsupported && <p className="warn-text">{version}은(는) {info.label}에서 지원하지 않아요.</p>}
      {picked && isDowngrade(version) && <p className="warn-text">⚠ 낮은 버전으로 바꾸면 월드가 망가질 수 있어요. 바꾸기 전에 월드를 자동으로 백업해요.</p>}
      {picked && mcChanged && !isDowngrade(version) && <p className="hint">바꾸기 전에 월드를 자동으로 백업해요. 한 번 켜서 새 버전으로 바뀐 월드는 예전 버전에서 열리지 않아요.</p>}
      {picked && mcChanged && MODDED.includes(software) && <p className="warn-text">설치된 모드가 새 버전에 맞지 않으면 서버가 켜지지 않을 수 있어요.</p>}
      {picked && <p className="hint">저장하기를 누르면 바뀌어요. 진행 상황은 오른쪽 위 작업 목록에서 볼 수 있어요.</p>}
    </>
  )
}
