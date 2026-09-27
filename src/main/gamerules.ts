// 게임 규칙: 켜진 서버에 조용히 물어봐서 목록과 현재 값을 읽고, 바꾼다.
// 26.x부터 규칙 이름이 keep_inventory 같은 모양으로 바뀌었고, 그 전에는 keepInventory 모양이다. 둘 다 서버가 알려 주는 이름을 그대로 쓴다.
import type { GameRule } from '../shared-types'
import { quietQuery, sendCommand } from './runner'

const NAME = /^[A-Za-z0-9_]{1,64}$/

// 26.x: "System chat: /gamerule keep_inventory [<value>]" (한 줄에 하나)
// 그 전: "/gamerule (announceAdvancements|commandBlockOutput|...)" (한 줄에 전부)
// 같은 규칙이 "minecraft:"를 붙인 이름으로 한 번 더 나온다. 그 줄도 가로채되 이름은 붙이지 않은 쪽만 쓴다
// 모두 로그 머리("]: ") 바로 뒤(26.x는 "System chat: " 뒤)에서만 찾는다. 플레이어 채팅("<이름> ...")으로 흉내 낼 수 없게.
const FROM_SERVER = String.raw`\]: (?:System chat: )?`
const HELP_ONE = new RegExp(`${FROM_SERVER}\\/gamerule (?:minecraft:)?([A-Za-z0-9_]+) \\[<value>\\]\\s*$`)
const HELP_ALL = new RegExp(`${FROM_SERVER}\\/gamerule \\(([^)]+)\\)`)
// 26.x: "Game rule keep_inventory is currently set to false" / 그 전: "Gamerule keepInventory is currently set to: false"
const VALUE = new RegExp(`${FROM_SERVER}Game ?rule ([A-Za-z0-9_:]+) is currently set to:? (\\S+)\\s*$`, 'i')

// 1.12 이하(예: 1.8.9)의 옛 형식
// 목록: "gamerule"만 치면 "commandBlockOutput, doDaylightCycle, ... sendCommandFeedback and showDeathMessages" 한 줄
// 값: "keepInventory = false" / "help gamerule"은 "Usage: /gamerule <rule name> [value]"만 알려 준다
const OLD_LIST = new RegExp(`${FROM_SERVER}([A-Za-z0-9_]+(?:, [A-Za-z0-9_]+)+(?:,? and [A-Za-z0-9_]+)?)\\s*$`)
const OLD_VALUE = new RegExp(`${FROM_SERVER}([A-Za-z0-9_]+) = (\\S+)\\s*$`)
const OLD_USAGE = new RegExp(`${FROM_SERVER}Usage: /gamerule`)

export async function listGameRules(folderPath: string): Promise<GameRule[]> {
  const help = await quietQuery(folderPath, ['help gamerule'], (l) => HELP_ONE.test(l) || HELP_ALL.test(l) || OLD_USAGE.test(l))
  const names = new Set<string>()
  for (const line of help) {
    const one = HELP_ONE.exec(line)
    if (one) names.add(one[1])
    const all = HELP_ALL.exec(line)
    if (all) all[1].split('|').forEach((n) => NAME.test(n) && names.add(n))
  }
  // 옛 버전: 도움말에 규칙 이름이 없어서 "gamerule"로 목록을 받는다
  if (!names.size) {
    const old = await quietQuery(folderPath, ['gamerule'], (l) => OLD_LIST.test(l))
    for (const line of old) OLD_LIST.exec(line)?.[1].split(/,? and |, /).forEach((n) => NAME.test(n) && names.add(n))
  }
  if (!names.size) throw new Error('게임 규칙 목록을 받지 못했어요. 서버가 완전히 켜진 다음에 다시 해 보세요.')

  const list = [...names]
  const answers = await quietQuery(folderPath, list.map((n) => `gamerule ${n}`), (l) => VALUE.test(l) || OLD_VALUE.test(l), {
    idleMs: 700
  })
  const values = new Map<string, string>()
  for (const line of answers) {
    const m = VALUE.exec(line) ?? OLD_VALUE.exec(line)
    if (m) values.set(m[1].replace(/^minecraft:/, ''), m[2])
  }
  return list
    .filter((n) => values.has(n))
    .map((name) => {
      const value = values.get(name)!
      return { name, value, type: value === 'true' || value === 'false' ? 'bool' : 'int' } as GameRule
    })
}

export function setGameRule(folderPath: string, name: string, value: string): void {
  if (!NAME.test(name)) throw new Error('잘못된 게임 규칙 이름이에요.')
  if (!/^(true|false|-?\d{1,9})$/.test(value)) throw new Error('잘못된 값이에요.')
  sendCommand(folderPath, `gamerule ${name} ${value}`)
}
