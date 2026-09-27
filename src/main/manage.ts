// 관리 탭: 켜진 서버에 명령어를 보내 접속자·난이도·게임 모드 등을 바로 바꾼다.
// 화면이 고른 동작(ManageAction)을 여기서 검사해 명령어로 만들므로, 화면에서 임의의 명령어를 만들 수 없다.
import fs from 'fs'
import path from 'path'
import type { Difficulty, GameMode, ManageAction, ManageInfo } from '../shared-types'
import { readProperties, writeProperties } from './properties'
import { getPlayers, getState, sendCommand } from './runner'
import { readServerInfo } from './servers'

const PLAYER_NAME = /^[A-Za-z0-9_]{3,16}$/
const DIFFICULTIES: Difficulty[] = ['peaceful', 'easy', 'normal', 'hard']
const GAMEMODES: GameMode[] = ['survival', 'creative', 'adventure', 'spectator']

function readNames(folderPath: string, file: string): string[] {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(folderPath, file), 'utf8'))
    return Array.isArray(list) ? list.map((e) => String(e.name)) : []
  } catch {
    return []
  }
}

export function getManageInfo(folderPath: string): ManageInfo {
  const ops = new Set(readNames(folderPath, 'ops.json').map((n) => n.toLowerCase()))
  const props = readProperties(folderPath)
  const difficulty = DIFFICULTIES.find((d) => d === props.difficulty) ?? 'easy'
  const gamemode = GAMEMODES.find((g) => g === props.gamemode) ?? 'survival'
  return {
    players: getPlayers(folderPath).map((name) => ({ name, op: ops.has(name.toLowerCase()) })),
    banned: readNames(folderPath, 'banned-players.json'),
    difficulty,
    gamemode
  }
}

function checkName(name: string): string {
  if (!PLAYER_NAME.test(name)) throw new Error('잘못된 닉네임이에요.')
  return name
}

function toCommand(a: ManageAction): string {
  switch (a.type) {
    case 'say': {
      const text = String(a.text).replace(/[\r\n]+/g, ' ').trim().slice(0, 256)
      if (!text) throw new Error('보낼 메시지를 입력해 주세요.')
      return `say ${text}`
    }
    case 'difficulty':
      if (!DIFFICULTIES.includes(a.value)) throw new Error('잘못된 난이도예요.')
      return `difficulty ${a.value}`
    case 'gamemodeAll':
      if (!GAMEMODES.includes(a.value)) throw new Error('잘못된 게임 모드예요.')
      return `gamemode ${a.value} @a`
    case 'gamemode':
      if (!GAMEMODES.includes(a.value)) throw new Error('잘못된 게임 모드예요.')
      return `gamemode ${a.value} ${checkName(a.name)}`
    case 'time': {
      // 1.12 이하는 noon·midnight 같은 이름을 모른다. 숫자(틱)는 모든 버전에서 통한다
      const ticks = { day: 1000, noon: 6000, midnight: 18000 }[a.value]
      if (ticks == null) throw new Error('잘못된 시간이에요.')
      return `time set ${ticks}`
    }
    case 'weather':
      if (!['clear', 'rain', 'thunder'].includes(a.value)) throw new Error('잘못된 날씨예요.')
      return `weather ${a.value}`
    case 'save':
      return 'save-all'
    case 'tp':
      return `tp ${checkName(a.name)} ${checkName(a.target)}`
    case 'give': {
      const item = String(a.item).trim().toLowerCase()
      if (!/^([a-z0-9_.-]+:)?[a-z0-9_./-]{1,64}$/.test(item)) throw new Error('잘못된 아이템 이름이에요.')
      const count = Math.min(999, Math.max(1, Math.floor(Number(a.count) || 1)))
      return `give ${checkName(a.name)} ${item} ${count}`
    }
    case 'kick':
      return `kick ${checkName(a.name)} 관리자가 내보냈어요`
    case 'ban':
      return `ban ${checkName(a.name)} 관리자가 차단했어요`
    case 'op':
    case 'deop':
    case 'pardon':
      return `${a.type} ${checkName(a.name)}`
    default:
      throw new Error('알 수 없는 동작이에요.')
  }
}

export function runAction(folderPath: string, action: ManageAction): void {
  // 차단 해제는 꺼진 서버에서도 파일만 고치면 된다
  if (action.type === 'pardon' && getState(folderPath) !== 'running') {
    const name = checkName(action.name).toLowerCase()
    const file = path.join(folderPath, 'banned-players.json')
    try {
      const list = JSON.parse(fs.readFileSync(file, 'utf8'))
      fs.writeFileSync(file, JSON.stringify(list.filter((e: { name: string }) => String(e.name).toLowerCase() !== name), null, 2))
    } catch {
      // 목록 파일이 없으면 이미 해제된 것
    }
    return
  }
  if (getState(folderPath) !== 'running') throw new Error('서버가 켜져 있을 때만 할 수 있어요.')
  if (action.type === 'heal') {
    // 1.13 전에는 effect 문법이 다르다 (effect 이름 효과번호 초 세기)
    const name = checkName(action.name)
    const m = /^1\.(\d+)/.exec(readServerInfo(folderPath).mcVersion)
    const old = !!m && Number(m[1]) < 13
    const cmds = old
      ? [`effect ${name} 6 1 10`, `effect ${name} 23 1 10`]
      : [`effect give ${name} minecraft:instant_health 1 10`, `effect give ${name} minecraft:saturation 1 10`]
    cmds.forEach((c) => sendCommand(folderPath, c))
    return
  }
  sendCommand(folderPath, toCommand(action))
  if (action.type === 'gamemodeAll') sendCommand(folderPath, `defaultgamemode ${action.value}`) // 앞으로 들어올 사람도

  // 난이도·기본 게임 모드는 설정 파일에도 적어야 다음에 켤 때 되돌아가지 않는다
  if (action.type === 'difficulty') writeProperties(folderPath, { difficulty: action.value })
  if (action.type === 'gamemodeAll') writeProperties(folderPath, { gamemode: action.value })
}
