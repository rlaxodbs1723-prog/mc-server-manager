// 배드락 서버 관리: 접속자(내보내기·관리자)·허용 목록·시간/날씨/난이도·게임 규칙.
// 화면이 고른 동작(BedrockAction)을 여기서 검사해 명령어로 만들므로, 화면에서 임의의 명령어를 만들 수 없다.
import fs from 'fs'
import path from 'path'
import type { BedrockAction, BedrockManageInfo, GameRule } from '../shared-types'
import { readProperties, writeProperties } from './properties'
import { getPlayers, getState, getXuid, quietQuery, sendCommand } from './runner'

// 게이머태그: 영문·숫자·공백과 몇 가지 기호 (따옴표·역슬래시가 없어서 명령어에 따옴표로 감싸 넣어도 안전하다)
const NAME = /^[A-Za-z0-9 _#.-]{1,32}$/
const DIFFICULTIES = ['peaceful', 'easy', 'normal', 'hard']
const GAMEMODES = ['survival', 'creative', 'adventure']

function checkName(name: string): string {
  const n = String(name ?? '').trim()
  if (!NAME.test(n)) throw new Error('잘못된 닉네임이에요.')
  return n
}

const allowFile = (folderPath: string): string => path.join(folderPath, 'allowlist.json')

function readAllowlist(folderPath: string): { name: string; xuid?: string; ignoresPlayerLimit?: boolean }[] {
  try {
    const list = JSON.parse(fs.readFileSync(allowFile(folderPath), 'utf8'))
    return Array.isArray(list) ? list.filter((e) => e && typeof e.name === 'string') : []
  } catch {
    return []
  }
}

function opXuids(folderPath: string): Set<string> {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(folderPath, 'permissions.json'), 'utf8'))
    return new Set((Array.isArray(list) ? list : []).filter((e) => e?.permission === 'operator').map((e) => String(e.xuid)))
  } catch {
    return new Set()
  }
}

export function getBedrockManage(folderPath: string): BedrockManageInfo {
  const ops = opXuids(folderPath)
  const props = readProperties(folderPath)
  return {
    players: getPlayers(folderPath).map((name) => ({ name, op: ops.has(getXuid(folderPath, name) ?? '-') })),
    allowlist: readAllowlist(folderPath).map((e) => e.name),
    allowlistOn: props['allow-list'] === 'true',
    difficulty: (DIFFICULTIES.includes(props.difficulty) ? props.difficulty : 'easy') as BedrockManageInfo['difficulty'],
    gamemode: (GAMEMODES.includes(props.gamemode) ? props.gamemode : 'survival') as BedrockManageInfo['gamemode']
  }
}

export function runBedrockAction(folderPath: string, action: BedrockAction): void {
  const running = getState(folderPath) === 'running'
  // 허용 목록은 꺼진 서버에서도 파일만 고치면 된다
  if (action.type === 'allow' || action.type === 'disallow') {
    const name = checkName(action.name)
    if (running) return sendCommand(folderPath, `allowlist ${action.type === 'allow' ? 'add' : 'remove'} "${name}"`)
    const list = readAllowlist(folderPath).filter((e) => e.name.toLowerCase() !== name.toLowerCase())
    if (action.type === 'allow') list.push({ name, ignoresPlayerLimit: false })
    fs.writeFileSync(allowFile(folderPath), JSON.stringify(list, null, 2))
    return
  }
  if (action.type === 'allowOn') {
    writeProperties(folderPath, { 'allow-list': String(!!action.value) }) // 다음에 켤 때도 그대로
    if (running) sendCommand(folderPath, `allowlist ${action.value ? 'on' : 'off'}`)
    return
  }
  if (!running) throw new Error('서버가 켜져 있을 때만 할 수 있어요.')
  switch (action.type) {
    case 'say': {
      const text = String(action.text)
        .replace(/[\r\n]+/g, ' ')
        .trim()
        .slice(0, 256)
      if (!text) throw new Error('보낼 메시지를 입력해 주세요.')
      return sendCommand(folderPath, `say ${text}`)
    }
    case 'kick':
      return sendCommand(folderPath, `kick "${checkName(action.name)}" 관리자가 내보냈어요`)
    case 'op':
    case 'deop':
      return sendCommand(folderPath, `${action.type} "${checkName(action.name)}"`)
    case 'time': {
      if (!['day', 'noon', 'night', 'midnight'].includes(action.value)) throw new Error('잘못된 시간이에요.')
      return sendCommand(folderPath, `time set ${action.value}`)
    }
    case 'weather':
      if (!['clear', 'rain', 'thunder'].includes(action.value)) throw new Error('잘못된 날씨예요.')
      return sendCommand(folderPath, `weather ${action.value}`)
    case 'difficulty':
      if (!DIFFICULTIES.includes(action.value)) throw new Error('잘못된 난이도예요.')
      sendCommand(folderPath, `difficulty ${action.value}`)
      writeProperties(folderPath, { difficulty: action.value }) // 다음에 켤 때 되돌아가지 않게
      return
    case 'gamemodeAll':
      if (!GAMEMODES.includes(action.value)) throw new Error('잘못된 게임 모드예요.')
      sendCommand(folderPath, `gamemode ${action.value} @a`)
      sendCommand(folderPath, `defaultgamemode ${action.value}`) // 앞으로 들어올 사람도
      writeProperties(folderPath, { gamemode: action.value })
      return
    default:
      throw new Error('알 수 없는 동작이에요.')
  }
}

// ---------- 게임 규칙 ----------
// "gamerule"만 치면 "commandBlockOutput = true, doDayLightCycle = true, ..." 한 줄로 전부 나온다. 규칙 이름은 대소문자를 가리지 않는다
const RULE_LINE = /\] ((?:[A-Za-z0-9_]+ = [A-Za-z0-9_-]+(?:, )?)+)\s*$/

export async function listBedrockRules(folderPath: string): Promise<GameRule[]> {
  const lines = await quietQuery(folderPath, ['gamerule'], (l) => RULE_LINE.test(l), { firstMs: 6000, maxMs: 12000 })
  const rules: GameRule[] = []
  for (const line of lines) {
    const m = RULE_LINE.exec(line)
    if (!m) continue
    for (const pair of m[1].split(', ')) {
      const [name, value] = pair.split(' = ')
      if (name && value != null) rules.push({ name, value, type: value === 'true' || value === 'false' ? 'bool' : 'int' })
    }
  }
  if (!rules.length) throw new Error('게임 규칙 목록을 받지 못했어요. 서버가 완전히 켜진 다음에 다시 해 보세요.')
  return rules
}
