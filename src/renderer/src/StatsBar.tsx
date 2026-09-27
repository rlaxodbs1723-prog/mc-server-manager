import { AlertTriangle, Cpu, Gauge, MemoryStick } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ServerStats } from '../../shared-types'

const HISTORY = 40 // 그래프에 남길 점 수 (2.5초마다 → 약 1분 40초)

// 켜진 서버의 CPU·메모리·TPS를 작은 그래프와 함께 보여 준다
export default function StatsBar({ folderPath, on }: { folderPath: string; on: boolean }) {
  const [stats, setStats] = useState<ServerStats | null>(null)
  const [history, setHistory] = useState<{ cpu: number[]; mem: number[]; tps: number[] }>({ cpu: [], mem: [], tps: [] })

  useEffect(() => {
    setStats(null)
    setHistory({ cpu: [], mem: [], tps: [] })
    if (!on) return
    let alive = true
    const tick = async () => {
      if (document.hidden) return // 창이 안 보이면 쉰다 (PowerShell로 사용량 읽기가 멈춘다)
      const s = await window.api.getStats(folderPath).catch(() => null)
      if (!alive) return
      setStats(s)
      if (s)
        setHistory((h) => ({
          cpu: s.cpu == null ? h.cpu : [...h.cpu, s.cpu].slice(-HISTORY),
          mem: s.memMb == null ? h.mem : [...h.mem, (s.memMb / s.maxMemMb) * 100].slice(-HISTORY),
          tps: s.tps == null ? h.tps : [...h.tps, (s.tps / 20) * 100].slice(-HISTORY)
        }))
    }
    tick()
    const id = setInterval(tick, 2500)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [folderPath, on])

  if (!on || !stats) return null
  const gb = (mb: number) => (mb / 1024).toFixed(1)
  const tpsLevel = stats.tps == null ? '' : stats.tps >= 18 ? 'good' : stats.tps >= 12 ? 'warn' : 'bad'

  // 잠깐 튀는 건 무시하고, 최근 3번(약 7초) 내내 높을 때만 경고한다
  const last3 = (a: number[]) => a.length >= 3 && a.slice(-3)
  const cpuHigh = (() => {
    const l = last3(history.cpu)
    return l ? l.every((v) => v >= 90) : false
  })()
  const tpsLow = (() => {
    const l = last3(history.tps)
    return l ? l.every((v) => v <= 75) : false // 15 TPS 이하
  })()
  const sysLow = stats.sysFreeMb < Math.max(1024, stats.sysTotalMb * 0.08)
  const warnings: { level: 'warn' | 'bad'; text: string }[] = []
  if (sysLow)
    warnings.push({
      level: 'bad',
      text: `컴퓨터 메모리가 ${gb(stats.sysFreeMb)}GB밖에 안 남았어요. 서버 메모리를 줄이거나 다른 프로그램을 꺼 주세요.`
    })
  if (cpuHigh) warnings.push({ level: 'warn', text: 'CPU를 거의 다 쓰고 있어요. 모드가 많거나 보이는 거리가 넓으면 생겨요.' })
  if (tpsLow) warnings.push({ level: stats.tps != null && stats.tps < 10 ? 'bad' : 'warn', text: `서버가 느려졌어요 (${stats.tps} TPS). 렉이 걸리고 있어요.` })

  return (
    <>
      {warnings.length > 0 && (
        <div className="stats-warnings">
          {warnings.map((w) => (
            <div key={w.text} className={`stats-warning ${w.level}`}>
              <AlertTriangle size={16} />
              {w.text}
            </div>
          ))}
        </div>
      )}
      <div className="stats-bar">
        <Stat icon={<Cpu size={16} />} label="CPU" value={stats.cpu == null ? '…' : `${stats.cpu}%`} points={history.cpu} level={cpuHigh ? 'warn' : ''} />
        <Stat
          icon={<MemoryStick size={16} />}
          label="메모리"
          value={stats.memMb == null ? '…' : `${gb(stats.memMb)} / ${gb(stats.maxMemMb)}GB`}
          points={history.mem}
          level={sysLow ? 'bad' : ''}
          hint={`실제 RAM에 올라와 있는 양이에요. 컴퓨터 전체에 ${gb(stats.sysFreeMb)} / ${gb(stats.sysTotalMb)}GB 남았어요`}
        />
        <Stat
          icon={<Gauge size={16} />}
          label="서버 속도"
          value={stats.tps == null ? '—' : `${stats.tps} TPS`}
          points={history.tps}
          level={tpsLevel}
          hint={stats.tps == null ? '이 버전은 서버 속도를 알 수 없어요' : '20이면 정상이에요. 낮을수록 렉이 걸려요'}
        />
      </div>
    </>
  )
}

// 숫자만 보여 준다 (지난 값들은 경고를 판단하는 데만 쓴다)
function Stat({ icon, label, value, level = '', hint }: { icon: React.ReactNode; label: string; value: string; points?: number[]; level?: string; hint?: string }) {
  return (
    <div className={`stat ${level}`} title={hint}>
      <div className="stat-top">
        {icon}
        <span className="stat-label">{label}</span>
        <b className="stat-value">{value}</b>
      </div>
    </div>
  )
}
