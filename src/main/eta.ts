// 서버 만들기의 전체 남은 시간 계산.
// 만들기는 여러 단계로 나뉜다. 받는 양을 아는 단계는 실제 속도로, 모르는 단계(Forge 설치 등)는
// 지난번에 걸린 시간으로 예상한다. 끝나면 단계별로 걸린 시간을 저장해 다음 예상에 쓴다.
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import type { CreatePhase, Progress, Software } from '../shared-types'

// 처음 만들 때 쓰는 기본 예상 시간(초). 한 번 만들고 나면 실제 걸린 시간으로 바뀐다.
const DEFAULT_SEC: Record<CreatePhase, number> = {
  meta: 1,
  vanilla: 10,
  java: 20,
  loader: 5,
  install: 30,
  base: 3
}
const INSTALL_SEC: Partial<Record<Software, number>> = { forge: 90, neoforge: 40, quilt: 15 }

const historyFile = (): string => path.join(app.getPath('userData'), 'create-times.json')

type History = Record<string, number> // "종류:단계" -> 초

function readHistory(): History {
  try {
    return JSON.parse(fs.readFileSync(historyFile(), 'utf8'))
  } catch {
    return {}
  }
}

export function phasesFor(software: Software): CreatePhase[] {
  const list: CreatePhase[] = ['meta']
  if (software === 'vanilla' || software === 'fabric' || software === 'quilt') list.push('vanilla')
  list.push('java')
  if (software !== 'vanilla') list.push('loader')
  if (software === 'forge' || software === 'neoforge' || software === 'quilt') list.push('install')
  if (software === 'fabric' || software === 'quilt') list.push('base')
  return list
}

export class CreateEta {
  private phases: CreatePhase[]
  private expected: Record<string, number> = {}
  private index = -1
  private phaseStart = Date.now()
  private readonly start = Date.now()
  private fraction: number | null = null // 지금 단계의 진행률 (모르면 null)
  private measured: Partial<Record<CreatePhase, number>> = {}

  constructor(private software: Software) {
    this.phases = phasesFor(software)
    const history = readHistory()
    for (const p of this.phases) {
      this.expected[p] = history[`${software}:${p}`] ?? (p === 'install' ? INSTALL_SEC[software] : undefined) ?? DEFAULT_SEC[p]
    }
  }

  // 진행 보고를 받아 단계를 옮기고, 전체 진행률과 남은 시간을 붙여 돌려준다
  update(p: Progress): Progress {
    const now = Date.now()
    if (p.phase) {
      const i = this.phases.indexOf(p.phase)
      if (i > this.index) {
        if (this.index >= 0) this.measured[this.phases[this.index]] = (now - this.phaseStart) / 1000
        for (let k = this.index + 1; k < i; k++) this.measured[this.phases[k]] = 0 // 건너뛴 단계
        this.index = i
        this.phaseStart = now
        this.fraction = null
      }
    }
    this.fraction = p.done != null && p.total ? Math.min(1, p.done / p.total) : this.fraction

    const eta = this.remaining(now)
    const elapsed = (now - this.start) / 1000
    const percent = Math.min(99, Math.round((elapsed / (elapsed + eta)) * 100))
    return { ...p, percent, etaSeconds: Math.round(eta) }
  }

  private remaining(now: number): number {
    if (this.index < 0) return this.phases.reduce((sum, ph) => sum + this.expected[ph], 0)
    const current = this.phases[this.index]
    const elapsed = (now - this.phaseStart) / 1000
    let left: number
    if (this.fraction != null && this.fraction > 0.02 && elapsed >= 1) {
      left = (elapsed / this.fraction) * (1 - this.fraction) // 실제 속도로
    } else {
      left = Math.max(this.expected[current] - elapsed, 2) // 예상보다 오래 걸리면 "곧"으로 버틴다
    }
    for (let k = this.index + 1; k < this.phases.length; k++) left += this.expected[this.phases[k]]
    return left
  }

  // 다 만들었을 때: 단계별로 걸린 시간을 저장 (지난번과 섞어서 튀는 값을 줄인다)
  finish(): void {
    if (this.index >= 0) this.measured[this.phases[this.index]] = (Date.now() - this.phaseStart) / 1000
    const history = readHistory()
    for (const [phase, sec] of Object.entries(this.measured)) {
      const key = `${this.software}:${phase}`
      history[key] = history[key] == null ? sec : history[key] * 0.4 + sec * 0.6
    }
    try {
      fs.writeFileSync(historyFile(), JSON.stringify(history, null, 2))
    } catch {
      // 저장 못 해도 다음 예상이 조금 덜 정확할 뿐이다
    }
  }
}
