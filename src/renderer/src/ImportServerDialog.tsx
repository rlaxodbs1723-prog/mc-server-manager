import { useEffect, useState } from 'react'
import { SOFTWARE_INFO, type DetectedServer, type LoaderVersion, type McVersion, type Software } from '../../shared-types'
import { DomainField, MemoryField } from './AddressMemory'
import Select from './Select'
import { useTasks } from './tasks'
import { Modal } from './ui'

const norm = (s: string): string => s.trim().toLowerCase()
const SOFTWARES = Object.keys(SOFTWARE_INFO) as Software[]

// 기존 서버 폴더를 앱으로 가져오는 창. 폴더에서 알아낸 종류·버전을 보여 주고, 틀리면 고칠 수 있다
export default function ImportServerDialog({
  folder,
  detected,
  existingNames,
  onClose
}: {
  folder: string
  detected: DetectedServer
  existingNames: string[]
  onClose: () => void
}) {
  const { tasks, startCreate } = useTasks()
  const [name, setName] = useState(detected.name)
  const [software, setSoftware] = useState<string>(detected.software ?? '')
  const [mc, setMc] = useState(detected.mcVersion ?? '')
  const [loader, setLoader] = useState(detected.loaderVersion ?? '')
  const [versions, setVersions] = useState<McVersion[]>([])
  const [loaders, setLoaders] = useState<LoaderVersion[] | null>(null)
  const [domain, setDomain] = useState<{ domainName?: string; blocked: boolean }>({ blocked: true })
  const [memoryMb, setMemoryMb] = useState<number | undefined>(undefined)

  const taken = new Set([...existingNames, ...tasks.filter((t) => t.status === 'running').map((t) => t.options?.name ?? '')].map(norm))
  const nameTaken = taken.has(norm(name))

  useEffect(() => {
    window.api
      .getVersions(true)
      .then(setVersions)
      .catch(() => undefined)
  }, [])

  // 종류나 버전이 바뀌면 그 버전의 로더·빌드 목록을 다시 불러온다
  useEffect(() => {
    if (!software || software === 'vanilla' || !mc) return setLoaders(null)
    let alive = true
    setLoaders(null)
    window.api
      .getLoaderVersions(software as Exclude<Software, 'vanilla'>, mc)
      .then((list) => alive && setLoaders(list))
      .catch(() => alive && setLoaders([]))
    return () => {
      alive = false
    }
  }, [software, mc])

  // 알아낸 버전이 목록에 없으면(스냅샷 등) 맨 위에 넣어 그대로 고를 수 있게 한다
  const mcOptions = [
    ...(mc && !versions.some((v) => v.id === mc) ? [{ value: mc, label: mc }] : []),
    ...versions.map((v) => ({ value: v.id, label: v.id, tag: v.type === 'snapshot' ? '스냅샷' : undefined }))
  ]
  const loaderOptions = [
    ...(loader && !(loaders ?? []).some((l) => l.version === loader) ? [{ value: loader, label: loader }] : []),
    ...(loaders ?? []).map((l) => ({ value: l.version, label: l.version, tag: !l.stable ? '베타' : undefined }))
  ]
  const ready = !!name.trim() && !nameTaken && !!software && !!mc && !domain.blocked

  function run() {
    startCreate({
      name: name.trim(),
      software: software as Software,
      mcVersion: mc,
      loaderVersion: software === 'vanilla' ? undefined : loader || undefined,
      importFrom: folder,
      memoryMb,
      domainName: domain.domainName
    })
    onClose()
  }

  return (
    <Modal onClose={onClose}>
      <div style={{ display: 'contents' }}>
        <h2>기존 서버 가져오기</h2>
        <div className="wizard-cols">
          <div className="wizard-col">
            <div className="reset-fields">
              <div>
                <div className="label">서버 이름</div>
                <input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoFocus />
                {nameTaken && (
                  <p className="error-text" style={{ marginTop: 6 }}>
                    같은 이름의 서버가 이미 있음. 다른 이름 입력 필요
                  </p>
                )}
              </div>
              <div>
                <div className="label">서버 종류</div>
                <Select
                  value={software}
                  onChange={(v) => {
                    setSoftware(v)
                    setLoader('')
                  }}
                  placeholder="종류 선택"
                  options={SOFTWARES.map((s) => ({ value: s, label: SOFTWARE_INFO[s].label }))}
                />
              </div>
              <div>
                <div className="label">마인크래프트 버전</div>
                <Select value={mc} onChange={setMc} disabled={!versions.length} placeholder="버전 선택" searchPlaceholder="버전 검색" options={mcOptions} />
              </div>
              {software && software !== 'vanilla' && (
                <div>
                  <div className="label">
                    {software === 'paper' || software === 'purpur'
                      ? `${SOFTWARE_INFO[software as Software].label} 빌드`
                      : `${SOFTWARE_INFO[software as Software].label} 버전`}
                  </div>
                  <Select
                    value={loader}
                    onChange={setLoader}
                    disabled={loaders === null && !loader}
                    placeholder={loaders === null ? '불러오는 중…' : '선택 안 함'}
                    searchPlaceholder="버전 검색"
                    options={loaderOptions}
                  />
                </div>
              )}
              <DomainField onChange={setDomain} />
            </div>
          </div>
          <div className="wizard-col">
            <div className="import-summary">
              <div className="path" title={folder}>
                {folder}
              </div>
              <div className="meta">
                {detected.sizeMb.toLocaleString()}MB{detected.sizePartial ? ' 이상' : ''} · {detected.hasWorld ? '월드 있음' : '월드 없음'}
              </div>
              <div className="meta">원본 폴더는 그대로 두고 복사함</div>
            </div>
            <div className="reset-fields">
              <MemoryField onChange={setMemoryMb} />
            </div>
          </div>
        </div>
        <div className="actions">
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button className="btn primary" onClick={run} disabled={!ready}>
            가져오기
          </button>
        </div>
      </div>
    </Modal>
  )
}
