// 게임 규칙의 한국어 이름·설명·분류. 26.x 이름(keep_inventory) 기준이고, 예전 이름(keepInventory)도 찾아진다.
export const CATEGORIES = ['플레이어', '몹', '월드', '블록·아이템', '기타'] as const
export type Category = (typeof CATEGORIES)[number]

type Label = [label: string, desc: string, category: Category]

const LABELS: Record<string, Label> = {
  // 플레이어
  keep_inventory: ['죽어도 아이템 유지', '죽었을 때 인벤토리와 경험치를 잃지 않아요', '플레이어'],
  natural_health_regeneration: ['체력 자연 회복', '배가 부르면 체력이 저절로 차요', '플레이어'],
  immediate_respawn: ['바로 부활', '죽으면 부활 화면 없이 바로 다시 태어나요', '플레이어'],
  fall_damage: ['낙하 피해', '높은 곳에서 떨어지면 다쳐요', '플레이어'],
  fire_damage: ['불 피해', '불에 닿으면 다쳐요', '플레이어'],
  drowning_damage: ['익사 피해', '물속에서 숨이 차면 다쳐요', '플레이어'],
  freeze_damage: ['동상 피해', '가루눈 속에서 얼면 다쳐요', '플레이어'],
  pvp: ['플레이어끼리 공격(PvP)', '플레이어가 서로 때릴 수 있어요', '플레이어'],
  show_death_messages: ['사망 메시지', '누가 어떻게 죽었는지 채팅에 보여 줘요', '플레이어'],
  show_advancement_messages: ['발전 과제 알림', '발전 과제를 달성하면 채팅에 알려 줘요', '플레이어'],
  players_sleeping_percentage: ['잠자기 인원 비율(%)', '이만큼의 사람이 자면 밤이 넘어가요', '플레이어'],
  spawn_radius: ['부활 범위', '처음 태어나는 위치가 흩어지는 범위(블록)', '플레이어'],
  respawn_radius: ['부활 범위', '처음 태어나는 위치가 흩어지는 범위(블록)', '플레이어'],
  locator_bar: ['위치 표시 막대', '화면에 다른 플레이어 방향을 보여 줘요', '플레이어'],
  reduced_debug_info: ['디버그 정보 줄이기', 'F3 화면에서 좌표 등을 숨겨요', '플레이어'],
  ender_pearls_vanish_on_death: ['죽으면 엔더 진주 사라짐', '던진 엔더 진주가 죽을 때 사라져요', '플레이어'],
  players_nether_portal_default_delay: ['네더 차원문 대기 시간', '서바이벌에서 차원문을 탈 때까지 기다리는 시간(틱)', '플레이어'],
  players_nether_portal_creative_delay: ['네더 차원문 대기 시간(크리에이티브)', '크리에이티브에서 차원문을 탈 때까지 기다리는 시간(틱)', '플레이어'],
  elytra_movement_check: ['겉날개 속도 검사', '끄면 겉날개가 비정상적으로 빨라도 막지 않아요', '플레이어'],
  player_movement_check: ['이동 속도 검사', '끄면 비정상적으로 빠른 이동을 막지 않아요', '플레이어'],
  limited_crafting: ['제작법 제한', '알아낸 제작법만 만들 수 있어요', '플레이어'],
  spectators_generate_chunks: ['관전자 지형 생성', '관전 모드로 돌아다닐 때도 새 지형을 만들어요', '플레이어'],

  // 몹
  spawn_mobs: ['몹 생성', '동물과 몬스터가 자연스럽게 생겨요', '몹'],
  spawn_monsters: ['몬스터 생성', '좀비·크리퍼 같은 몬스터가 생겨요', '몹'],
  mob_griefing: ['몹이 블록 망가뜨리기', '크리퍼 폭발, 엔더맨이 블록 옮기기 등', '몹'],
  spawn_phantoms: ['팬텀 생성', '오래 안 자면 팬텀이 나타나요', '몹'],
  spawn_patrols: ['약탈자 순찰대', '약탈자 무리가 돌아다녀요', '몹'],
  spawn_wandering_traders: ['떠돌이 상인', '떠돌이 상인이 찾아와요', '몹'],
  spawn_wardens: ['워든 생성', '스컬크 비명체가 워든을 불러요', '몹'],
  raids: ['습격', '흉조 효과로 마을 습격이 일어나요', '몹'],
  universal_anger: ['모두에게 화내기', '화난 중립 몹이 가까운 모든 플레이어를 공격해요', '몹'],
  forgive_dead_players: ['죽은 플레이어 용서', '공격한 사람이 죽으면 중립 몹이 화를 풀어요', '몹'],
  max_entity_cramming: ['끼임 한도', '한 칸에 이보다 많이 모이면 몹이 다쳐요', '몹'],
  mob_drops: ['몹 전리품', '몹을 잡으면 아이템을 떨어뜨려요', '몹'],

  // 월드
  advance_time: ['시간 흐름', '끄면 낮·밤이 멈춰요', '월드'],
  advance_weather: ['날씨 변화', '끄면 날씨가 바뀌지 않아요', '월드'],
  random_tick_speed: ['작물 성장 속도', '클수록 작물·나무가 빨리 자라요 (기본 3)', '월드'],
  fire_spread_radius_around_player: ['불 번짐 범위', '플레이어 주변 몇 블록까지 불이 번질지 (0이면 안 번져요)', '월드'],
  spread_vines: ['덩굴 퍼짐', '덩굴이 저절로 자라서 퍼져요', '월드'],
  water_source_conversion: ['물 무한 생성', '물 두 칸 사이에 새 물 원천이 생겨요', '월드'],
  lava_source_conversion: ['용암 무한 생성', '용암 두 칸 사이에 새 용암 원천이 생겨요', '월드'],
  max_snow_accumulation_height: ['눈 쌓이는 높이', '눈이 올 때 쌓이는 최대 층 수', '월드'],
  allow_entering_nether_using_portals: ['네더 차원문 사용', '끄면 차원문으로 네더에 갈 수 없어요', '월드'],
  global_sound_events: ['전체 소리', '보스 등장 같은 소리를 모두에게 들려줘요', '월드'],

  // 블록·아이템
  block_drops: ['블록 아이템 떨어뜨림', '블록을 부수면 아이템이 나와요', '블록·아이템'],
  entity_drops: ['엔티티 아이템 떨어뜨림', '보트·그림 등을 부수면 아이템이 나와요', '블록·아이템'],
  tnt_explodes: ['TNT 폭발', '끄면 TNT가 터지지 않아요', '블록·아이템'],
  block_explosion_drop_decay: ['블록 폭발 시 아이템 줄이기', '침대 등 블록 폭발에 부서진 블록 일부만 떨어뜨려요', '블록·아이템'],
  mob_explosion_drop_decay: ['몹 폭발 시 아이템 줄이기', '크리퍼 폭발에 부서진 블록 일부만 떨어뜨려요', '블록·아이템'],
  tnt_explosion_drop_decay: ['TNT 폭발 시 아이템 줄이기', 'TNT에 부서진 블록 일부만 떨어뜨려요', '블록·아이템'],
  projectiles_can_break_blocks: ['발사체가 블록 부수기', '화살 등이 장식 항아리 같은 블록을 부숴요', '블록·아이템'],
  spawner_blocks_work: ['스포너 작동', '몹 스포너에서 몹이 나와요', '블록·아이템'],

  // 기타
  send_command_feedback: ['명령어 결과 알림', '명령어를 쓰면 결과를 채팅에 보여 줘요', '기타'],
  command_block_output: ['명령 블록 알림', '명령 블록 실행 결과를 관리자 채팅에 보여 줘요', '기타'],
  command_blocks_work: ['명령 블록 작동', '끄면 명령 블록이 실행되지 않아요', '기타'],
  log_admin_commands: ['관리자 명령 기록', '관리자가 쓴 명령어를 다른 관리자에게 알려요', '기타'],
  max_command_sequence_length: ['명령 연쇄 한도', '한 번에 실행할 수 있는 명령어 수', '기타'],
  max_command_forks: ['명령 분기 한도', '명령어 실행이 갈라질 수 있는 최대 수', '기타'],
  max_block_modifications: ['블록 변경 한도', 'fill 같은 명령으로 한 번에 바꿀 수 있는 블록 수', '기타'],

  // 1.12 이하에만 있는 것
  disable_elytra_movement_check: ['겉날개 움직임 확인 끄기', '켜면 겉날개가 비정상적으로 빨라도 막지 않아요', '플레이어'],
  game_loop_function: ['게임 반복 함수', '매 틱마다 실행할 함수(데이터 팩) 이름', '기타']
}

// 예전(1.21.10까지) 이름 → 26.x 이름. 그대로 snake_case로만 바뀐 것은 따로 적지 않는다
const OLD_NAMES: Record<string, string> = {
  doDaylightCycle: 'advance_time',
  doWeatherCycle: 'advance_weather',
  doMobSpawning: 'spawn_mobs',
  doMobLoot: 'mob_drops',
  doTileDrops: 'block_drops',
  doEntityDrops: 'entity_drops',
  doImmediateRespawn: 'immediate_respawn',
  doInsomnia: 'spawn_phantoms',
  doPatrolSpawning: 'spawn_patrols',
  doTraderSpawning: 'spawn_wandering_traders',
  doWardenSpawning: 'spawn_wardens',
  doVinesSpread: 'spread_vines',
  doLimitedCrafting: 'limited_crafting',
  disableRaids: 'raids', // 뜻이 반대라 설명만 빌린다
  naturalRegeneration: 'natural_health_regeneration',
  announceAdvancements: 'show_advancement_messages',
  showDeathMessages: 'show_death_messages',
  randomTickSpeed: 'random_tick_speed',
  spawnRadius: 'spawn_radius',
  waterSourceConversion: 'water_source_conversion',
  lavaSourceConversion: 'lava_source_conversion',
  doFireTick: 'fire_spread_radius_around_player',
  commandBlocksEnabled: 'command_blocks_work',
  maxCommandChainLength: 'max_command_sequence_length',
  maxCommandForkCount: 'max_command_forks',
  commandModificationBlockLimit: 'max_block_modifications'
}

const snake = (s: string) => s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())
const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

// 26.x 이름 → 번역 파일에 남아 있는 예전 키 (이름이 아예 바뀐 것들)
const TRANSLATION_KEY: Record<string, string> = {
  advance_time: 'doDaylightCycle',
  advance_weather: 'doWeatherCycle',
  spawn_mobs: 'doMobSpawning',
  mob_drops: 'doMobLoot',
  block_drops: 'doTileDrops',
  entity_drops: 'doEntityDrops',
  immediate_respawn: 'doImmediateRespawn',
  spawn_phantoms: 'doInsomnia',
  spawn_patrols: 'doPatrolSpawning',
  spawn_wandering_traders: 'doTraderSpawning',
  spawn_wardens: 'doWardenSpawning',
  spread_vines: 'doVinesSpread',
  limited_crafting: 'doLimitedCrafting',
  natural_health_regeneration: 'naturalRegeneration',
  show_advancement_messages: 'announceAdvancements',
  command_blocks_work: 'commandBlocksEnabled',
  spawner_blocks_work: 'spawnerBlocksEnabled',
  max_command_sequence_length: 'maxCommandChainLength',
  max_command_forks: 'maxCommandForkCount',
  max_block_modifications: 'commandModificationBlockLimit',
  max_snow_accumulation_height: 'snowAccumulationHeight',
  respawn_radius: 'spawnRadius'
}

// 게임 안 화면과 같은 이름: 공식 번역(lang)에서 찾고, 없으면 앱이 붙인 이름을 쓴다.
// 찾는 순서: gamerule.minecraft.<새 이름> → gamerule.<서버가 준 이름> → 예전 키 → 낙타 표기로 바꾼 이름
export function labelOf(name: string, lang: Record<string, string> = {}): { label: string; desc: string; category: Category } {
  const key = LABELS[name] ? name : (OLD_NAMES[name] ?? snake(name))
  const mine = LABELS[key]
  const candidates = [`minecraft.${name}`, name, TRANSLATION_KEY[name], camel(name)].filter(Boolean) as string[]
  const found = candidates.find((c) => lang[`gamerule.${c}`])
  const label = found ? lang[`gamerule.${found}`] : (mine?.[0] ?? name)
  const desc = (found && lang[`gamerule.${found}.description`]) || (mine?.[1] ?? '')
  return { label, desc, category: mine?.[2] ?? '기타' }
}
