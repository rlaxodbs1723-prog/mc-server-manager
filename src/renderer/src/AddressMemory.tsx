import { useEffect, useRef, useState } from 'react'

const BASE = 'cubepanel.kr'
const NAME_RE = /^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$/

export interface AddressMemoryValue {
  domainName?: string // 이름 주소로 쓸 이름 (비어 있으면 서버를 만들 수 없다)
  memoryMb?: number
  blocked: boolean // 이름이 비었거나 이미 쓰는 이름이라 이대로는 만들 수 없다
}

type Check = 'idle' | 'checking' | 'free' | 'taken' | 'error'

const gb = (mb: number): string => `${(mb / 1024).toFixed(mb % 1024 ? 1 : 0)}GB`

// 서버 주소 이름 입력 (이름.cubepanel.kr). 쓸 수 있는 이름인지 미리 확인한다
export function DomainField({ onChange }: { onChange: (v: { domainName?: string; blocked: boolean }) => void }) {
  const [name, setName] = useState('')
  const [check, setCheck] = useState<Check>('idle')
  const seq = useRef(0)

  // 이름을 다 쓰고 잠깐 멈추면 쓸 수 있는지 확인한다 (서버를 다 만든 뒤에야 알게 되지 않게)
  useEffect(() => {
    const n = name.trim()
    if (!NAME_RE.test(n)) return setCheck('idle')
    setCheck('checking')
    const id = ++seq.current
    const t = setTimeout(() => {
      window.api
        .checkDomainName(n)
        .then((free) => id === seq.current && setCheck(free ? 'free' : 'taken'))
        .catch(() => id === seq.current && setCheck('error'))
    }, 500)
    return () => clearTimeout(t)
  }, [name])

  const valid = NAME_RE.test(name.trim())
  useEffect(() => {
    onChange({ domainName: valid ? name.trim() : undefined, blocked: !valid || check === 'taken' || check === 'checking' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, valid, check])

  return (
    <div>
      <div className="label">서버 주소 이름</div>
      <div className="domain-row">
        <input className="input" value={name} maxLength={20} onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} />
        <span className="domain-suffix">{`.${BASE}`}</span>
      </div>
      {name.trim() !== '' && (
        <p className={`hint ${check === 'taken' ? 'warn-text' : ''}`}>
          {!valid
            ? '영어 소문자, 숫자, 하이픈(-) 3~20자. 하이픈은 처음과 끝에 사용 불가'
            : check === 'checking'
              ? '사용 가능 여부 확인 중…'
              : check === 'free'
                ? '사용 가능한 이름'
                : check === 'taken'
                  ? '이미 사용 중인 이름'
                  : check === 'error'
                    ? '확인하지 못함. 서버를 만든 뒤 다시 확인'
                    : ''}
        </p>
      )}
    </div>
  )
}

// 서버가 쓸 메모리 슬라이더
export function MemoryField({ onChange }: { onChange: (memoryMb: number | undefined) => void }) {
  const [range, setRange] = useState<{ minMb: number; maxMb: number; totalMb: number; defaultMb: number } | null>(null)
  const [memory, setMemory] = useState(0)

  useEffect(() => {
    window.api
      .getMemoryRange()
      .then((r) => {
        setRange(r)
        setMemory(r.defaultMb)
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    onChange(range ? memory : undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memory, range])

  if (!range) return null
  return (
    <div>
      <div className="label">
        서버가 쓸 메모리 <b className="mem-value">{gb(memory)}</b>
      </div>
      <input
        type="range"
        className="range"
        min={range.minMb}
        max={range.maxMb}
        step={512}
        value={memory}
        onChange={(e) => setMemory(Number(e.target.value))}
        style={{ ['--p' as string]: `${((memory - range.minMb) / Math.max(1, range.maxMb - range.minMb)) * 100}%` }}
      />
      <div className="range-labels">
        <span>{gb(range.minMb)}</span>
        <span>{gb(range.maxMb)}</span>
      </div>
      {range.totalMb - memory < 4096 && (
        <p className="warn-text mem-warn">{`⚠ 컴퓨터에 ${gb(Math.max(0, range.totalMb - memory))}만 남음. 같은 컴퓨터에서 게임도 하면 버벅일 수 있음`}</p>
      )}
    </div>
  )
}

// 주소 이름과 메모리를 한 곳에 같이 보여 주는 묶음 (모드팩 만들기 창이 쓴다)
export default function AddressMemory({ onChange }: { onChange: (v: AddressMemoryValue) => void }) {
  const [d, setD] = useState<{ domainName?: string; blocked: boolean }>({ blocked: true })
  const [memoryMb, setMemoryMb] = useState<number | undefined>(undefined)
  useEffect(() => {
    onChange({ ...d, memoryMb })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, memoryMb])
  return (
    <div className="reset-fields">
      <DomainField onChange={setD} />
      <MemoryField onChange={setMemoryMb} />
    </div>
  )
}
