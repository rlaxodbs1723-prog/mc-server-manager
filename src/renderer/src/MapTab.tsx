import { Globe2, ListChecks, RotateCcw, Save } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GameRule } from '../../shared-types'
import { labelOf } from './gameruleLabels'
import GameRulesDialog from './GameRulesDialog'
import { FieldRow, valueOf, WORLD_FIELDS } from './SettingsDialog'
import { useToast } from './ui'
import { cleanError } from './util'
import WorldResetDialog from './WorldResetDialog'

// 최신 버전에서는 설정 파일에서 사라지고 게임 규칙으로 옮겨진 항목들 (PvP·몹 생성 등). 서버가 켜져 있을 때 스위치로 바로 바꾼다
// TOP_RULES는 오른쪽 칸(월드 설정) 맨 위에, 나머지는 왼쪽 칸에 보여 준다. 몹 생성은 몬스터·동물 등 모든 몹의 자연 생성을 한꺼번에 켜고 끈다(spawn_mobs)
const TOP_RULES = ['pvp', 'spawn_mobs', 'command_blocks_work', 'allow_entering_nether_using_portals']
// 스위치 하나로 여러 규칙을 같이 바꾼다: 몹 생성은 몬스터 생성 규칙(spawn_monsters)이 따로 있는 버전에서도 몬스터·동물 등 모든 몹이 한꺼번에 꺼지게 한다 (그 버전에 있는 규칙만)
// (26.x는 몬스터·팬텀·약탈자 순찰대·떠돌이 상인·워든이 각각 따로 있다)
const GROUP: Record<string, string[]> = {
  spawn_mobs: ['spawn_mobs', 'spawn_monsters', 'spawn_phantoms', 'spawn_patrols', 'spawn_wandering_traders', 'spawn_wardens']
}
const QUICK_RULES = [...TOP_RULES, 'mob_griefing', 'keep_inventory']
// 스위치에 보일 이름·설명 (게임 규칙 창의 설명과 따로 쓴다)
const QUICK_TEXT: Record<string, { label: string; desc: string }> = {
  spawn_mobs: { label: '몹 생성', desc: '끄면 몬스터·동물 등 모든 몹이 자연스럽게 생기지 않아요' },
  command_blocks_work: { label: '명령 블록 사용', desc: '명령 블록을 설치하고 작동시킬 수 있어요.' },
  allow_entering_nether_using_portals: { label: '네더 허용', desc: '끄면 차원문으로 네더에 들어갈 수 없어요' }
}
// 옛 버전: 설정 파일의 몹 생성 항목 셋을 스위치 하나로 (몬스터·동물·주민)
const MOB_KEYS = ['spawn-monsters', 'spawn-animals', 'spawn-npcs']
// 옛 버전에서 맨 위에 둘 항목 (PvP, 몹 생성(위의 MOB_KEYS), 명령 블록, 네더)
const LEGACY_TOP = ['pvp', 'enable-command-block', 'allow-nether']

// 자바 서버의 맵 탭: 지금 월드, 하드코어, 월드 리셋(새로 만들기·내 월드·맵 받기는 이 창 안에 있다), 게임 규칙, 월드 관련 설정(거리·범위·몹 생성 등)
export default function MapTab({ folderPath, serverOn, mcVersion }: { folderPath: string; serverOn: boolean; mcVersion: string }) {
  const toast = useToast()
  const [world, setWorld] = useState<{ exists: boolean; name: string; properties: Record<string, string> } | null>(null)
  const [hardcore, setHardcore] = useState<boolean | null>(null)
  const [showReset, setShowReset] = useState(false)
  const [showRules, setShowRules] = useState(false)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [rules, setRules] = useState<GameRule[] | null>(null) // 켜진 서버에서 읽은 게임 규칙 (자주 쓰는 것만 보인다)

  const load = useCallback(async () => {
    const s = await window.api.getSettings(folderPath)
    setWorld({ exists: s.worldExists, name: s.properties['level-name'] || 'world', properties: s.properties })
    setEdits({})
    window.api
      .getHardcore(folderPath)
      .then((h) => setHardcore(h.hardcore))
      .catch(() => setHardcore(null))
  }, [folderPath])
  useEffect(() => {
    load().catch(() => undefined)
    // 서버를 켜거나 끄면 설정 파일이 새로 채워지므로 다시 읽는다 (바꾸던 값이 있으면 그대로 둔다)
    return window.api.onServerEvent((e) => {
      if (e.folderPath === folderPath && e.type === 'status')
        window.api
          .getSettings(folderPath)
          .then((s) => setWorld((cur) => (cur ? { ...cur, exists: s.worldExists, properties: s.properties } : cur)))
          .catch(() => undefined)
    })
  }, [load, folderPath])

  // 설정 항목은 그 서버의 server.properties에 실제로 있을 때만 보여 준다 (버전마다 있는 항목이 다르다). 처음 켜기 전에는 예전 버전 전용 항목을 숨긴다
  const props = useMemo(() => ({ ...(world?.properties ?? {}), ...edits }), [world, edits])
  const fileExists = world ? Object.keys(world.properties).length > 0 : false
  const fields = WORLD_FIELDS.filter((f) => (fileExists ? f.key in (world?.properties ?? {}) : !f.legacy))
  const dirty = Object.keys(edits).length > 0
  // 옛 버전 목록의 맨 위 항목과 몹 생성 스위치
  const mobKeys = MOB_KEYS.filter((k) => fields.some((f) => f.key === k))
  const mobsOn = mobKeys.every((k) => props[k] !== 'false') // 설정 파일에 값이 없으면 켜진 것(기본값)
  const legacyRow = (key: string): React.ReactNode => {
    const f = fields.find((x) => x.key === key)
    return f ? <FieldRow key={f.key} field={f} value={valueOf(f, props)} changed={f.key in edits} onChange={(v) => set(f.key, v)} /> : null
  }

  // 설정 파일에 PvP 같은 항목이 없는 최신 버전이면, 켜진 서버에서 규칙을 읽어 스위치로 보여 준다. 막 켜져서 아직 못 읽으면 몇 번 다시 해 본다
  const newer = !!world && fileExists && !('pvp' in world.properties)
  useEffect(() => {
    if (!newer || !serverOn) return setRules(null)
    let alive = true
    let tries = 0
    const attempt = (): void => {
      window.api
        .listGameRules(folderPath)
        .then((list) => alive && setRules(list))
        .catch(() => {
          if (alive && ++tries < 12) setTimeout(attempt, 4000)
        })
    }
    attempt()
    return () => {
      alive = false
    }
  }, [newer, serverOn, folderPath])
  const shortName = (r: GameRule): string => r.name.replace(/^minecraft:/, '')
  const quick = (rules ?? []).filter((r) => r.type === 'bool' && QUICK_RULES.includes(shortName(r)))
  const topRules = TOP_RULES.flatMap((n) => quick.filter((r) => shortName(r) === n)) // 순서는 TOP_RULES대로
  const sideRules = quick.filter((r) => !TOP_RULES.includes(shortName(r)))
  // 이 스위치가 바꾸는 규칙들 (켜진 서버에 실제로 있는 것만)
  const membersOf = (r: GameRule): GameRule[] => {
    const names = GROUP[shortName(r)] ?? [shortName(r)]
    return (rules ?? []).filter((x) => x.type === 'bool' && names.includes(shortName(x)))
  }
  const ruleRow = (r: GameRule): React.ReactNode => {
    const l = QUICK_TEXT[shortName(r)] ?? labelOf(r.name)
    const on = membersOf(r).every((x) => x.value === 'true') // 하나라도 꺼져 있으면 꺼진 것으로 보인다
    return (
      <div className="setting-row" key={r.name}>
        <div className="setting-text">
          <div className="setting-label">{l.label}</div>
          <div className="setting-desc">{l.desc}</div>
        </div>
        <label className="switch">
          <input type="checkbox" checked={on} onChange={(e) => setRule(r, e.target.checked)} />
          <span />
        </label>
      </div>
    )
  }

  async function setRule(r: GameRule, on: boolean): Promise<void> {
    const members = membersOf(r)
    const before = new Map(members.map((x) => [x.name, x.value]))
    const names = new Set(before.keys())
    setRules((list) => list?.map((x) => (names.has(x.name) ? { ...x, value: String(on) } : x)) ?? null)
    try {
      for (const x of members) await window.api.setGameRule(folderPath, x.name, String(on))
    } catch (e) {
      setRules((list) => list?.map((x) => (before.has(x.name) ? { ...x, value: before.get(x.name) as string } : x)) ?? null) // 되돌리기
      toast(cleanError(e), 'error')
    }
  }

  // 설정 항목이 아직 없으면(서버가 설정 파일을 다 만들기 전) 2초마다 다시 읽는다. 서버가 다 켜지면 창을 다시 열지 않아도 나타난다
  const empty = !!world && fields.length === 0
  useEffect(() => {
    if (!empty) return
    const timer = setInterval(() => {
      window.api
        .getSettings(folderPath)
        .then((s) => setWorld((cur) => (cur ? { ...cur, exists: s.worldExists, properties: s.properties } : cur)))
        .catch(() => undefined)
    }, 2000)
    return () => clearInterval(timer)
  }, [empty, folderPath])

  const set = (key: string, value: string): void =>
    setEdits((cur) => {
      const next = { ...cur, [key]: value }
      if ((world?.properties[key] ?? '') === value) delete next[key] // 원래 값으로 돌아오면 바뀐 것에서 뺀다
      return next
    })

  async function save() {
    setSaving(true)
    try {
      await window.api.saveSettings(folderPath, { properties: edits })
      toast(serverOn ? '저장했어요. 서버를 다시 켜면 적용돼요' : '저장했어요')
      await load()
    } catch (e) {
      toast(cleanError(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  async function toggleHardcore(on: boolean) {
    try {
      await window.api.setHardcore(folderPath, on)
      setHardcore(on)
      toast(on ? '하드코어로 바꿨어요. 난이도는 어려움으로 고정돼요' : '하드코어를 껐어요')
    } catch (e) {
      toast(cleanError(e), 'error')
    }
  }

  return (
    <div className="mods map-tab">
      <div className="mods-col">
        <div className="installed-head">
          <h3>지금 월드</h3>
        </div>
        <div className="mod-card small">
          <span className="sw-badge" style={{ width: 40, height: 40, borderRadius: 12, color: '#5dbb63', background: '#5dbb6324' }}>
            <Globe2 size={20} />
          </span>
          <div className="body">
            <div className="t" style={{ fontSize: 14 }}>
              {world?.name ?? '…'}
            </div>
            <div className="hint">{world ? (world.exists ? '월드 있음' : '아직 월드가 없어요. 서버를 처음 켜면 만들어져요') : ''}</div>
          </div>
        </div>

        <div className="setting-row" style={{ marginTop: 10 }}>
          <div className="setting-text">
            <div className="setting-label">하드코어</div>
            <div className="setting-desc">
              {serverOn ? '서버를 끈 다음에 바꿀 수 있어요.' : '죽으면 다시 살아날 수 없고 관전 모드가 돼요. 난이도는 어려움으로 고정돼요.'}
            </div>
          </div>
          <label className="switch">
            <input type="checkbox" checked={!!hardcore} disabled={hardcore == null || serverOn} onChange={(e) => toggleHardcore(e.target.checked)} />
            <span />
          </label>
        </div>

        <div className="setting-row">
          <div className="setting-text">
            <div className="setting-label">{world?.exists ? '월드 리셋' : '새 월드 설정'}</div>
            <div className="setting-desc">시드·월드 종류·구조물로 새로 만들거나, 내 월드·zip, CurseForge 맵으로 바꿔요.</div>
          </div>
          <button
            className={`btn ${world?.exists ? 'danger' : ''}`}
            onClick={() => setShowReset(true)}
            disabled={serverOn || !world}
            title={serverOn ? '서버를 끈 다음에 할 수 있어요' : undefined}
          >
            <RotateCcw size={16} />
            {world?.exists ? '월드 리셋' : '설정하기'}
          </button>
        </div>

        <div className="setting-row">
          <div className="setting-text">
            <div className="setting-label">게임 규칙</div>
            <div className="setting-desc">죽어도 아이템 유지, 낙하 피해 등. 서버가 켜져 있을 때 바꿀 수 있어요.</div>
          </div>
          <button className="btn" onClick={() => setShowRules(true)} disabled={!serverOn} title={serverOn ? undefined : '서버가 켜져 있을 때 할 수 있어요'}>
            <ListChecks size={16} />
            열기
          </button>
        </div>
        {sideRules.map(ruleRow)}
        {newer && serverOn && rules == null && <p className="hint">자주 쓰는 규칙을 불러오고 있어요…</p>}
      </div>

      <div className="mods-col">
        <div className="installed-head">
          <h3>월드 설정</h3>
          {dirty && (
            <button className="btn sm primary" onClick={save} disabled={saving}>
              {saving ? <span className="spinner" /> : <Save size={15} />}
              저장하기
            </button>
          )}
        </div>
        <div className="mods-scroll">
          {topRules.map(ruleRow)}
          {legacyRow('pvp')}
          {mobKeys.length > 0 && (
            <div className="setting-row">
              <div className="setting-text">
                <div className="setting-label">몹 생성</div>
                <div className="setting-desc">끄면 몬스터·동물·주민 등 모든 몹이 자연스럽게 생기지 않아요</div>
              </div>
              <label className="switch">
                <input type="checkbox" checked={mobsOn} onChange={(e) => mobKeys.forEach((k) => set(k, String(e.target.checked)))} />
                <span />
              </label>
            </div>
          )}
          {legacyRow('enable-command-block')}
          {legacyRow('allow-nether')}
          {fields
            .filter((f) => !LEGACY_TOP.includes(f.key) && !MOB_KEYS.includes(f.key))
            .map((f) => (
              <FieldRow key={f.key} field={f} value={valueOf(f, props)} changed={f.key in edits} onChange={(v) => set(f.key, v)} />
            ))}
          {(!fileExists || fields.length === 0) && <p className="hint">서버를 한 번 끝까지 켜면 설정 항목이 생겨요.</p>}
          {dirty && serverOn && <p className="hint">바뀐 설정은 서버를 다시 켜면 적용돼요.</p>}
        </div>
      </div>

      {showRules && <GameRulesDialog folderPath={folderPath} onClose={() => setShowRules(false)} />}
      {showReset && world && (
        <WorldResetDialog
          folderPath={folderPath}
          mcVersion={mcVersion}
          properties={world.properties}
          worldExists={world.exists}
          onClose={() => setShowReset(false)}
          onDone={() => {
            setShowReset(false)
            load().catch(() => undefined)
          }}
        />
      )}
    </div>
  )
}
