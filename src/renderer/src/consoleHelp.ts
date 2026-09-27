// 콘솔 자동완성: 자주 쓰는 명령어와 한국어 설명. {player}는 접속 중인 사람 이름으로 채운다
export interface CommandHint {
  name: string
  usage: string
  desc: string
  player?: boolean // 첫 인자가 플레이어 이름
}

export const COMMANDS: CommandHint[] = [
  { name: 'say', usage: 'say <메시지>', desc: '모두에게 공지' },
  { name: 'list', usage: 'list', desc: '접속 중인 사람 보기' },
  { name: 'op', usage: 'op <닉네임>', desc: '관리자로 지정', player: true },
  { name: 'deop', usage: 'deop <닉네임>', desc: '관리자 해제', player: true },
  { name: 'kick', usage: 'kick <닉네임> [이유]', desc: '내보내기', player: true },
  { name: 'ban', usage: 'ban <닉네임> [이유]', desc: '차단', player: true },
  { name: 'pardon', usage: 'pardon <닉네임>', desc: '차단 해제' },
  { name: 'whitelist', usage: 'whitelist add|remove|on|off|list', desc: '화이트리스트' },
  { name: 'gamemode', usage: 'gamemode <모드> [닉네임]', desc: '게임 모드 바꾸기' },
  { name: 'difficulty', usage: 'difficulty <난이도>', desc: '난이도 바꾸기' },
  { name: 'time', usage: 'time set <day|noon|night|midnight>', desc: '시간 바꾸기' },
  { name: 'weather', usage: 'weather <clear|rain|thunder>', desc: '날씨 바꾸기' },
  { name: 'tp', usage: 'tp <닉네임> <닉네임|x y z>', desc: '순간이동', player: true },
  { name: 'give', usage: 'give <닉네임> <아이템> [개수]', desc: '아이템 주기', player: true },
  { name: 'kill', usage: 'kill <닉네임>', desc: '죽이기', player: true },
  { name: 'effect', usage: 'effect give <닉네임> <효과>', desc: '효과 주기' },
  { name: 'enchant', usage: 'enchant <닉네임> <마법>', desc: '마법 부여', player: true },
  { name: 'xp', usage: 'xp add <닉네임> <양>', desc: '경험치 주기' },
  { name: 'clear', usage: 'clear <닉네임>', desc: '인벤토리 비우기', player: true },
  { name: 'gamerule', usage: 'gamerule <규칙> [값]', desc: '게임 규칙' },
  { name: 'setworldspawn', usage: 'setworldspawn [x y z]', desc: '월드 스폰 지점' },
  { name: 'spawnpoint', usage: 'spawnpoint <닉네임> [x y z]', desc: '개인 스폰 지점', player: true },
  { name: 'seed', usage: 'seed', desc: '월드 시드 보기' },
  { name: 'save-all', usage: 'save-all', desc: '지금 저장' },
  { name: 'stop', usage: 'stop', desc: '저장하고 끄기' },
  { name: 'tell', usage: 'tell <닉네임> <메시지>', desc: '귓속말', player: true },
  { name: 'title', usage: 'title <닉네임|@a> title <글>', desc: '화면에 큰 글씨' },
  { name: 'summon', usage: 'summon <몹> [x y z]', desc: '몹 소환' },
  { name: 'tick', usage: 'tick query|rate|freeze', desc: '서버 틱 확인·조절' },
  { name: 'worldborder', usage: 'worldborder set <크기>', desc: '월드 경계' }
]

export interface Suggestion {
  text: string // 고르면 입력칸에 들어갈 전체 문장
  label: string
  desc: string
}

export function suggest(input: string, players: string[]): Suggestion[] {
  const text = input.replace(/^\//, '')
  const parts = text.split(' ')
  if (parts.length === 1) {
    const q = parts[0].toLowerCase()
    if (!q) return []
    return COMMANDS.filter((c) => c.name.startsWith(q) && c.name !== q)
      .slice(0, 6)
      .map((c) => ({ text: c.name + ' ', label: c.usage, desc: c.desc }))
  }
  // 두 번째 칸: 플레이어 이름
  const cmd = COMMANDS.find((c) => c.name === parts[0].toLowerCase())
  if (parts.length === 2 && cmd?.player) {
    const q = parts[1].toLowerCase()
    return ['@a', ...players]
      .filter((p) => p.toLowerCase().startsWith(q) && p.toLowerCase() !== q)
      .slice(0, 6)
      .map((p) => ({ text: `${parts[0]} ${p} `, label: p, desc: p === '@a' ? '모든 사람' : '접속 중' }))
  }
  return []
}

export const usageOf = (input: string): string | undefined => {
  const name = input.replace(/^\//, '').split(' ')[0].toLowerCase()
  return input.includes(' ') ? COMMANDS.find((c) => c.name === name)?.usage : undefined
}
