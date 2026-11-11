// 배드락 실험적 기능: 배드락 서버는 설정 파일에 실험 기능 칸이 없고, 월드의 level.dat 안 experiments에 적어 둔다.
// 서버가 꺼져 있을 때만 고친다 (켜져 있으면 서버가 저장하면서 덮어쓴다). 고치기 전에 원래 파일을 옆에 남겨 둔다.
// experiments_ever_used·saved_with_toggled_experiments는 서버가 월드를 열 때 알아서 붙이므로 건드리지 않는다.
import fs from 'fs'
import path from 'path'
import type { BedrockExperiment } from '../shared-types'
import { bedrockWorldDir } from './bedrock'
import { child, parseBedrockLevelDat, serializeBedrockLevelDat, setChild, TAG, type Tag } from './nbt'
import { getState } from './runner'

// 여러 버전에서 계속 쓰인 것만 둔다 (버전 한정 실험은 이름이 자주 바뀐다). 월드에 이미 있는 다른 실험도 목록에 같이 보여 준다
const KNOWN = ['gametest', 'upcoming_creator_features', 'experimental_creator_cameras', 'villager_trades_rebalance', 'jigsaw_structures']
const META = new Set(['experiments_ever_used', 'saved_with_toggled_experiments'])
const ID_RE = /^[a-z0-9_]{1,64}$/

const levelDat = (folderPath: string): string => path.join(bedrockWorldDir(folderPath), 'level.dat')

function readExperiments(folderPath: string): { file: string; data: ReturnType<typeof parseBedrockLevelDat>; ex: Tag & { type: 10 } } | null {
  const file = levelDat(folderPath)
  if (!fs.existsSync(file)) return null
  const data = parseBedrockLevelDat(fs.readFileSync(file))
  let ex = child(data.root, 'experiments')
  if (!ex || ex.type !== TAG.Compound) {
    ex = { type: TAG.Compound, value: [] }
    setChild(data.root, 'experiments', ex)
  }
  return { file, data, ex: ex as Tag & { type: 10 } }
}

// ready: 월드가 있다 (한 번도 안 켠 서버는 월드가 없어서 아직 못 고친다). hardcore: level.dat의 IsHardcore
export function getBedrockExperiments(folderPath: string): { ready: boolean; items: BedrockExperiment[]; hardcore: boolean } {
  const r = readExperiments(folderPath)
  if (!r) return { ready: false, items: KNOWN.map((id) => ({ id, on: false })), hardcore: false }
  const hc = child(r.data.root, 'IsHardcore')
  const have = new Map(r.ex.value.map(([n, t]) => [n.toString('utf8'), t.type === TAG.Byte && t.value !== 0]))
  const ids = [...KNOWN, ...[...have.keys()].filter((id) => !KNOWN.includes(id) && !META.has(id) && ID_RE.test(id))]
  return { ready: true, items: ids.map((id) => ({ id, on: have.get(id) ?? false })), hardcore: hc?.type === TAG.Byte && hc.value !== 0 }
}

export function setBedrockExperiment(folderPath: string, id: string, on: boolean): void {
  if (!ID_RE.test(id) || META.has(id)) throw new Error('알 수 없는 실험 기능이에요.')
  writeLevel(folderPath, (r) => setChild(r.ex, id, { type: TAG.Byte, value: on ? 1 : 0 }))
}

// 하드코어: 죽으면 다시 살아날 수 없다 (level.dat의 IsHardcore)
export function setBedrockHardcore(folderPath: string, on: boolean): void {
  writeLevel(folderPath, (r) => setChild(r.data.root, 'IsHardcore', { type: TAG.Byte, value: on ? 1 : 0 }))
}

function writeLevel(folderPath: string, change: (r: NonNullable<ReturnType<typeof readExperiments>>) => void): void {
  if (getState(folderPath) !== 'stopped') throw new Error('서버를 끈 다음에 바꿀 수 있어요. (켜져 있으면 서버가 저장하면서 되돌려요)')
  const r = readExperiments(folderPath)
  if (!r) throw new Error('서버를 한 번 켜서 월드를 만든 다음에 바꿀 수 있어요.')
  change(r)
  const out = serializeBedrockLevelDat(r.data)
  fs.copyFileSync(r.file, `${r.file}.cubepanel-bak`) // 원래 파일 (잘못되면 이걸로 되돌린다)
  const tmp = `${r.file}.tmp`
  fs.writeFileSync(tmp, out)
  fs.renameSync(tmp, r.file)
}
