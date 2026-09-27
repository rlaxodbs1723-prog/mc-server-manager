import { Archive, FolderOpen, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { BackupItem, BackupSettings } from '../../shared-types'
import Select from './Select'
import { Confirm, Empty, Skeleton, useToast } from './ui'
import { cleanError } from './util'
import { useTasks } from './tasks'

const size = (b: number): string =>
  b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)}GB` : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(0)}MB` : `${Math.max(1, Math.round(b / 1024))}KB`

const when = (t: number): string =>
  new Date(t).toLocaleString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit' })

export default function BackupTab({ folderPath, serverOn }: { folderPath: string; serverOn: boolean }) {
  const toast = useToast()
  const { runJob, busyOf } = useTasks()
  const busy = busyOf(folderPath) // 오래 걸리는 작업은 타이틀바 작업 목록에도 보여 준다
  const [list, setList] = useState<BackupItem[] | null>(null)
  const [making, setMaking] = useState(false)
  const [restoring, setRestoring] = useState<BackupItem | null>(null)
  const [removing, setRemoving] = useState<BackupItem | null>(null)
  const [settings, setSettings] = useState<BackupSettings | null>(null)
  useEffect(() => {
    window.api.getBackupSettings(folderPath).then(setSettings)
  }, [folderPath])
  async function saveSettings(next: BackupSettings) {
    setSettings(next)
    try {
      await window.api.setBackupSettings(folderPath, next)
    } catch (e) {
      toast(cleanError(e), 'error')
    }
  }

  const load = () => window.api.listBackups(folderPath).then(setList).catch(() => setList([]))
  useEffect(() => {
    setList(null)
    load()
    // 켤 때 자동 백업·정기 백업처럼 이 화면 밖에서 백업이 생기거나 지워져도 목록을 다시 읽는다
    return window.api.onServerEvent((e) => {
      if (e.type === 'backups' && e.folderPath === folderPath) load()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderPath])

  async function make() {
    setMaking(true)
    try {
      await runJob(folderPath, '백업 만들기', '백업했어요', () => window.api.createBackup(folderPath))
      toast('백업했어요')
      load()
    } catch (e) {
      toast(cleanError(e), 'error')
    } finally {
      setMaking(false)
    }
  }

  async function restore(b: BackupItem) {
    setRestoring(null)
    try {
      await runJob(folderPath, '백업으로 되돌리기', '되돌렸어요', () => window.api.restoreBackup(folderPath, b.id))
      toast(`${when(b.createdAt)} 월드로 되돌렸어요`)
    } catch (e) {
      toast(cleanError(e), 'error')
    }
  }

  async function remove(b: BackupItem) {
    setRemoving(null)
    try {
      await window.api.deleteBackup(folderPath, b.id)
      load()
    } catch (e) {
      toast(cleanError(e), 'error')
    }
  }

  return (
    <div className="manage">
      <section className="manage-card">
        <header>
          <h3>
            <Archive size={18} />
            월드 백업
          </h3>
          <div className="backup-actions">
            <button className="btn icon ghost" onClick={() => window.api.openBackupFolder(folderPath)} title="백업 폴더 열기">
              <FolderOpen size={18} />
            </button>
            <button className="btn primary" onClick={make} disabled={making || !!busy} title={busy ? `${busy} 중이에요. 끝나면 할 수 있어요` : undefined}>
              {making ? <span className="spinner" /> : null}
              {making ? '백업하는 중…' : '지금 백업하기'}
            </button>
          </div>
        </header>
        {settings && (
          <div className="backup-settings">
            <div>
              <div className="label">정기 백업</div>
              <Select
                value={String(settings.everyMin)}
                onChange={(v) => saveSettings({ ...settings, everyMin: Number(v) })}
                options={[
                  { value: '0', label: '안 함' },
                  { value: '30', label: '30분마다' },
                  { value: '60', label: '1시간마다' },
                  { value: '180', label: '3시간마다' },
                  { value: '360', label: '6시간마다' },
                  { value: '720', label: '12시간마다' },
                  { value: '1440', label: '하루마다' }
                ]}
              />
            </div>
            <div>
              <div className="label">자동 백업 남기는 개수</div>
              <Select
                value={String(settings.keep)}
                onChange={(v) => saveSettings({ ...settings, keep: Number(v) })}
                options={['5', '10', '20', '50', '100'].map((n) => ({ value: n, label: `최근 ${n}개` }))}
              />
            </div>
          </div>
        )}
        <p className="hint">서버를 켤 때, 그리고 켜져 있는 동안 정한 간격마다 자동으로 백업해요. 오래된 자동 백업은 알아서 지워요.</p>
      </section>


      <section className="manage-card">
        {list === null ? (
          <Skeleton small count={3} />
        ) : !list.length ? (
          <Empty icon={<Archive size={22} />} title="아직 백업이 없어요" hint="서버를 켜면 자동으로 백업돼요. 지금 바로 만들 수도 있어요." />
        ) : (
          <div className="player-list">
            {list.map((b) => (
              <div className="player" key={b.id}>
                <div className="player-name">
                  <span className="n">{when(b.createdAt)}</span>
                  <span className="chip">{b.auto ? '자동' : '직접'}</span>
                  {b.note && <span className="hint">{b.note}</span>}
                  <span className="hint">{size(b.sizeBytes)}</span>
                </div>
                <button
                  className="btn"
                  onClick={() => setRestoring(b)}
                  disabled={serverOn || !!busy}
                  title={busy ? `${busy} 중이에요. 끝나면 할 수 있어요` : serverOn ? '서버를 끈 다음에 복원할 수 있어요' : '이 시점으로 되돌리기'}
                >
                  <RotateCcw size={15} />
                  복원
                </button>
                <button className="btn icon ghost" onClick={() => setRemoving(b)} disabled={!!busy} title={busy ? `${busy} 중이에요. 끝나면 할 수 있어요` : '백업 삭제'}>
                  <Trash2 size={17} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {restoring && (
        <Confirm
          title="이 백업으로 되돌릴까요?"
          body={`${when(restoring.createdAt)} 월드로 되돌려요. 지금 월드는 휴지통으로 옮겨요.`}
          confirmText="되돌리기"
          danger
          onConfirm={() => restore(restoring)}
          onCancel={() => setRestoring(null)}
        />
      )}
      {removing && (
        <Confirm
          title="백업을 지울까요?"
          body={`${when(removing.createdAt)} 백업을 휴지통으로 옮겨요.`}
          confirmText="삭제"
          danger
          onConfirm={() => remove(removing)}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  )
}
