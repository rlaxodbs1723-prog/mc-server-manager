import { useState } from 'react'
import type { SaveWorld } from '../../shared-types'
import { WorldSource } from './ImportWorldDialog'
import Select from './Select'
import { Modal, useToast } from './ui'
import { cleanError } from './util'
import { useTasks } from './tasks'

const LEVEL_TYPES = [
  { value: 'minecraft:normal', label: '기본' },
  { value: 'minecraft:flat', label: '평지' },
  { value: 'minecraft:large_biomes', label: '큰 바이옴' },
  { value: 'minecraft:amplified', label: '증폭 (높은 산)' }
]

interface Props {
  folderPath: string
  mcVersion: string
  properties: Record<string, string>
  worldExists: boolean
  onClose: () => void
  onDone: () => void
}

// 월드를 만들 때만 정해지는 설정(하드코어, 시드, 월드 종류, 구조물)을 고르고 월드를 새로 만든다.
export default function WorldResetDialog({ folderPath, mcVersion, properties, worldExists, onClose, onDone }: Props) {
  const toast = useToast()
  const { runJob } = useTasks() // 오래 걸리는 작업은 타이틀바 작업 목록에도 보여 준다
  const [hardcore, setHardcore] = useState(properties.hardcore === 'true')
  const [seed, setSeed] = useState(properties['level-seed'] ?? '')
  const [levelType, setLevelType] = useState(properties['level-type'] || 'minecraft:normal')
  const [structures, setStructures] = useState(properties['generate-structures'] !== 'false')
  const [busy, setBusy] = useState(false)
  const [importWorld, setImportWorld] = useState<SaveWorld | null>(null)

  // 예전 버전 형식(default, flat 등)이 들어 있으면 목록에 그대로 보여 준다
  const typeOptions = LEVEL_TYPES.some((o) => o.value === levelType) ? LEVEL_TYPES : [...LEVEL_TYPES, { value: levelType, label: levelType }]

  async function confirm() {
    setBusy(true)
    try {
      await window.api.saveSettings(folderPath, {
        properties: {
          hardcore: String(hardcore),
          'level-seed': seed.trim(),
          'level-type': levelType,
          'generate-structures': String(structures)
        }
      })
      if (importWorld) {
        await runJob(folderPath, '월드 가져오기', '가져왔어요', () => window.api.importWorld(folderPath, importWorld.path)) // 지금 월드는 백업한 뒤 휴지통으로
        toast(`${importWorld.name} 월드를 가져왔어요. 서버를 켜면 이 월드로 시작해요`)
        return onDone()
      }
      if (worldExists) await runJob(folderPath, '월드 리셋', '리셋했어요', () => window.api.resetWorld(folderPath))
      toast(worldExists ? '월드를 리셋했어요. 서버를 켜면 새 월드가 만들어져요' : '새 월드 설정을 저장했어요')
      onDone()
    } catch (e) {
      toast(cleanError(e), 'error')
      setBusy(false)
    }
  }

  return (
    <Modal onClose={busy ? undefined : onClose}>
      <h2>{worldExists ? '월드 리셋' : '새 월드 설정'}</h2>
      <p className="body">
        {worldExists
          ? '지금 월드는 휴지통으로 옮기고, 다음에 서버를 켤 때 아래 설정으로 새 월드를 만들어요.'
          : '서버를 처음 켤 때 아래 설정으로 월드를 만들어요.'}
      </p>

      <WorldSource serverVersion={mcVersion} picked={importWorld} onChange={setImportWorld}>
      <div className="reset-fields">
        <label className="reset-row">
          <span>
            <b>하드코어</b>
            <span className="hint">죽으면 다시 살아날 수 없어요</span>
          </span>
          <span className="switch">
            <input type="checkbox" checked={hardcore} onChange={(e) => setHardcore(e.target.checked)} />
            <span />
          </span>
        </label>
        <label className="reset-row">
          <span>
            <b>구조물 만들기</b>
            <span className="hint">마을, 신전 같은 구조물</span>
          </span>
          <span className="switch">
            <input type="checkbox" checked={structures} onChange={(e) => setStructures(e.target.checked)} />
            <span />
          </span>
        </label>
        <div>
          <div className="label">월드 종류</div>
          <Select value={levelType} onChange={setLevelType} options={typeOptions} />
        </div>
        <div>
          <div className="label">시드</div>
          <input className="input" value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="비워 두면 무작위" maxLength={64} />
        </div>
      </div>
      </WorldSource>

      <div className="actions">
        <button className="btn" onClick={onClose} disabled={busy}>
          취소
        </button>
        <button className={`btn ${worldExists ? 'danger' : 'primary'}`} onClick={confirm} disabled={busy}>
          {busy ? <span className="spinner" /> : worldExists ? '리셋하기' : '저장하기'}
        </button>
      </div>
    </Modal>
  )
}
