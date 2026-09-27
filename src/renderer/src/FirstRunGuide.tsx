import { Copy, Play, Rocket, Share2, Timer } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Software } from '../../shared-types'

const MODDED: Software[] = ['fabric', 'quilt', 'forge', 'neoforge']

// 한 번도 켜지 않은 서버의 콘솔 자리에 보여 주는 시작 안내 (켜기 → 기다리기 → 주소 보내기)
// busyText: 점검·준비 중일 때 버튼 글자 (위쪽 켜기 버튼과 같게)
export default function FirstRunGuide({ software, onStart, startDisabled, busyText }: { software: Software; onStart: () => void; startDisabled: boolean; busyText?: string }) {
  const steps: { icon: ReactNode; title: string; body: ReactNode }[] = [
    {
      icon: <Play size={18} />,
      title: '서버 켜기',
      body: '처음 켤 때 마인크래프트 약관(EULA)에 동의하는 창이 한 번 떠요.'
    },
    {
      icon: <Timer size={18} />,
      title: '다 켜질 때까지 기다리기',
      body: '처음에는 월드를 만드느라 1~2분쯤 걸려요. 다 켜지면 알림이 와요.'
    },
    {
      icon: <Copy size={18} />,
      title: '플레이어에게 주소 보내기',
      body: '서버 이름 아래 주소를 복사해서 보내요. 플레이어는 멀티플레이 → 서버 추가에 붙여 넣으면 들어올 수 있어요.'
    }
  ]
  if (MODDED.includes(software))
    steps.push({
      icon: <Share2 size={18} />,
      title: '플레이어에게 모드 주기',
      body: '모드 서버는 플레이어도 같은 모드가 필요해요. 모드 탭의 "플레이어용 모드팩 내보내기"로 한 번에 보낼 수 있어요.'
    })

  return (
    <div className="first-run">
      <div className="first-run-head">
        <div className="state-icon">
          <Rocket size={22} />
        </div>
        <div>
          <h3>서버가 준비됐어요</h3>
          <p className="hint">이 순서대로 하면 플레이어들과 같이 놀 수 있어요.</p>
        </div>
      </div>
      <ol className="first-run-steps">
        {steps.map((s, i) => (
          <li key={s.title}>
            <span className="num">{i + 1}</span>
            <div>
              <b>
                {s.icon}
                {s.title}
              </b>
              <p>{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <button className="btn primary lg" onClick={onStart} disabled={startDisabled}>
        {busyText ? <span className="spinner" /> : <Play size={17} fill="currentColor" />}
        {busyText ?? '서버 켜기'}
      </button>
    </div>
  )
}
