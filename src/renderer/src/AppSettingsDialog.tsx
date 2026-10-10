import { FolderOpen } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AppInfo, AppSettings } from '../../shared-types'
import { Loading, Modal, useToast } from './ui'
import { cleanError } from './util'
import { LANGS } from '../../i18n'

// 앱 전체 설정 (서버마다가 아닌 것). 바꾸면 바로 저장된다
export default function AppSettingsDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const [info, setInfo] = useState<AppInfo | null>(null)

  const load = () => window.api.getAppInfo().then(setInfo).catch((e) => toast(cleanError(e), 'error'))
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function set(patch: Partial<AppSettings>) {
    if (!info) return
    setInfo({ ...info, settings: { ...info.settings, ...patch } }) // 바로 바뀐 것처럼 보이게
    try {
      const settings = await window.api.setAppSettings(patch)
      setInfo((cur) => (cur ? { ...cur, settings } : cur))
    } catch (e) {
      toast(cleanError(e), 'error')
      load()
    }
  }

  async function removeKey() {
    try {
      await window.api.removeCurseForgeKey()
      toast('CurseForge 연결을 끊었어요')
      load()
    } catch (e) {
      toast(cleanError(e), 'error')
    }
  }

  const s = info?.settings
  return (
    <Modal onClose={onClose}>
      <h2>앱 설정</h2>
      {!info || !s ? (
        <Loading />
      ) : (
        <div className="app-settings">
          <section>
            <div className="label">언어 · Language</div>
            <div className="seg" data-notr>
              {LANGS.map((l) => (
                <button
                  key={l.id}
                  className={s.language === l.id ? 'active' : ''}
                  onClick={() => {
                    if (s.language === l.id) return
                    // 화면 글자를 처음부터 다시 그리도록 새로 불러온다
                    window.api.setAppSettings({ language: l.id }).then(() => location.reload(), (e) => toast(cleanError(e), 'error'))
                  }}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <div className="label">시작</div>
            <label className="reset-row">
              <span>
                <b>윈도우를 켤 때 앱도 켜기</b>
                <span className="hint">{info.packaged ? '"앱을 켜면 이 서버도 켜기"를 켠 서버도 같이 켜져요.' : '설치한 앱에서만 돼요. 지금은 개발용으로 실행 중이에요.'}</span>
              </span>
              <span className="switch">
                <input type="checkbox" checked={s.launchAtLogin} disabled={!info.packaged} onChange={(e) => set({ launchAtLogin: e.target.checked })} />
                <span />
              </span>
            </label>
            <label className="reset-row">
              <span>
                <b>창 없이 트레이로 시작</b>
                <span className="hint">윈도우를 켤 때 자동으로 켜지면 창을 띄우지 않고 작업 표시줄 오른쪽에만 둬요.</span>
              </span>
              <span className="switch">
                <input type="checkbox" checked={s.startHidden} disabled={!info.packaged || !s.launchAtLogin} onChange={(e) => set({ startHidden: e.target.checked })} />
                <span />
              </span>
            </label>
          </section>

          <section>
            <div className="label">창을 닫으면</div>
            <div className="seg">
              <button className={s.closeBehavior === 'tray-if-running' ? 'active' : ''} onClick={() => set({ closeBehavior: 'tray-if-running' })}>
                켜진 서버가 있을 때만 트레이로
              </button>
              <button className={s.closeBehavior === 'always-tray' ? 'active' : ''} onClick={() => set({ closeBehavior: 'always-tray' })}>
                항상 트레이로
              </button>
            </div>
            <p className="hint">트레이에 있는 앱은 작업 표시줄 오른쪽 아이콘 → 종료로 끌 수 있어요.</p>
          </section>

          <section>
            <div className="label">알림</div>
            <label className="reset-row">
              <span>
                <b>윈도우 알림</b>
                <span className="hint">서버가 켜졌을 때, 튕겼을 때, 서버를 다 만들었을 때 알려 줘요. 앱을 보고 있을 때는 뜨지 않아요.</span>
              </span>
              <span className="switch">
                <input type="checkbox" checked={s.notifications} onChange={(e) => set({ notifications: e.target.checked })} />
                <span />
              </span>
            </label>
          </section>

          <section>
            <div className="label">개인 정보</div>
            <label className="reset-row">
              <span>
                <b>익명 사용 통계 보내기</b>
                <span className="hint">앱을 켠 횟수와 서버 종류만 세요. 이름·서버 이름·IP 같은 개인 정보는 저장하지 않아요.</span>
              </span>
              <span className="switch">
                <input type="checkbox" checked={s.usageStats} onChange={(e) => set({ usageStats: e.target.checked })} />
                <span />
              </span>
            </label>
          </section>

          {/* 예전에 직접 넣은 CurseForge 키가 있을 때만: 끊으면 기본 연결로 돌아간다 */}
          {info.curseForgeKey === 'user' && (
            <section>
              <div className="label">CurseForge</div>
              <div className="key-row">
                <span className="hint">내가 넣은 API 키로 연결돼 있어요.</span>
                <button className="btn sm ghost" onClick={removeKey}>
                  연결 끊기
                </button>
              </div>
            </section>
          )}

          {info.tunnelLinked && (
            <section>
              <div className="label">playit 터널</div>
              <div className="key-row">
                <span className="hint">공유기로 못 열 때 playit 터널로 열도록 연결돼 있어요.</span>
                <button
                  className="btn sm ghost"
                  onClick={async () => {
                    try {
                      await window.api.unlinkTunnel()
                      toast('playit 연결을 끊었어요')
                      load()
                    } catch (e) {
                      toast(cleanError(e), 'error')
                    }
                  }}
                >
                  연결 끊기
                </button>
              </div>
            </section>
          )}

          <section>
            <div className="label">데이터</div>
            <div className="key-row">
              <span className="hint">서버·백업·Java가 저장되는 곳이에요. 버전 {info.version}</span>
              <button className="btn sm ghost" onClick={() => window.api.openDataFolder()}>
                <FolderOpen size={15} />
                폴더 열기
              </button>
            </div>
          </section>
        </div>
      )}
      <div className="actions">
        <button className="btn primary" onClick={onClose}>
          닫기
        </button>
      </div>
    </Modal>
  )
}
