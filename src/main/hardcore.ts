// 하드코어 켜기/끄기. 하드코어 여부는 server.properties가 아니라 월드 파일(level.dat)에 저장돼서,
// 이미 있는 월드는 level.dat을 직접 고쳐야 바뀐다. (server.properties의 hardcore는 월드를 만들 때만 읽힌다)
import fs from 'fs'
import path from 'path'
import type { HardcoreInfo } from '../shared-types'
import { child, parseNbt, serializeNbt, setChild, type Tag } from './nbt'
import { readProperties, writeProperties } from './properties'
import { getState } from './runner'

type Compound = Tag & { type: 10 }

function levelDat(folderPath: string): string {
  const name = readProperties(folderPath)['level-name'] || 'world'
  return path.join(folderPath, name, 'level.dat')
}

function readData(file: string) {
  const nbt = parseNbt(fs.readFileSync(file))
  const data = child(nbt.root, 'Data')
  if (data?.type !== 10) throw new Error('월드 파일(level.dat)을 읽지 못했어요.')
  return { nbt, data }
}

// 26.x: Data.difficulty_settings { hardcore, difficulty: "hard" } / 그 전: Data.hardcore, Data.Difficulty(0~3)
function worldHardcore(data: Compound): boolean {
  const settings = child(data, 'difficulty_settings')
  const tag = settings?.type === 10 ? child(settings, 'hardcore') : child(data, 'hardcore')
  return tag?.type === 1 && tag.value !== 0
}

export function getHardcore(folderPath: string): HardcoreInfo {
  const file = levelDat(folderPath)
  if (!fs.existsSync(file)) return { worldExists: false, hardcore: readProperties(folderPath).hardcore === 'true' }
  try {
    return { worldExists: true, hardcore: worldHardcore(readData(file).data) }
  } catch {
    return { worldExists: true, hardcore: false }
  }
}

export function setHardcore(folderPath: string, on: boolean): void {
  if (getState(folderPath) !== 'stopped') throw new Error('서버를 끈 다음에 바꿀 수 있어요.')

  // 새로 만들 월드를 위해 설정 파일에도 적는다 (하드코어는 난이도가 어려움으로 고정)
  writeProperties(folderPath, on ? { hardcore: 'true', difficulty: 'hard' } : { hardcore: 'false' })

  const file = levelDat(folderPath)
  if (!fs.existsSync(file)) return // 아직 월드가 없으면 처음 켤 때 설정 파일 값으로 만들어진다

  const { nbt, data } = readData(file)
  const settings = child(data, 'difficulty_settings')
  if (settings?.type === 10) {
    setChild(settings, 'hardcore', { type: 1, value: on ? 1 : 0 })
    if (on) setChild(settings, 'difficulty', { type: 8, value: Buffer.from('hard') })
  } else {
    setChild(data, 'hardcore', { type: 1, value: on ? 1 : 0 })
    if (on) setChild(data, 'Difficulty', { type: 1, value: 3 })
  }

  // 월드 파일이라 조심한다: 백업을 남기고, 임시 파일에 쓴 뒤 바꿔 끼운다
  fs.copyFileSync(file, `${file}.before-hardcore-change`)
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, serializeNbt(nbt))
  parseNbt(fs.readFileSync(tmp)) // 다시 읽히는지 확인
  fs.renameSync(tmp, file)
}
