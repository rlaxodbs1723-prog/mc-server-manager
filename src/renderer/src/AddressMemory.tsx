import { useEffect, useRef, useState } from 'react'

const BASE = 'cubepanel.kr'
const NAME_RE = /^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$/

export interface AddressMemoryValue {
  domainName?: string // 이름 주소로 쓸 이름 (비어 있으면 숫자 주소)
  memoryMb?: number
  blocked: boolean // 이름이 비었거나 이미 쓰는 이름이라 이대로는 만들 수 없다
}

type Check = 'idle' | 'checking' | 'free' | 'taken' | 'error'

const gb = (mb: number): string => `${(mb / 1024).toFixed(mb % 1024 ? 1 : 0)}GB`

// 서버를 처음 만들 때 정하는 두 가지: 접속 주소 이름(이름.cubepanel.kr)과 서버가 쓸 메모리. 서버 만들기·모드팩 만들기 창이 같이 쓴다
export default function AddressMemory({ onChange }: { onChange: (v: AddressMemoryValue) => void }) {
  const [range, setRange] = useState<{ minMb: number; maxMb: number; totalMb: number; defaultMb: number } | null>(null)
  const [memory, setMemory] = useState(0)
  const [name, setName] = useState('')
  const [check, setCheck] = useState<Check>('idle')
  const seq = useRef(0)

  useEffect(() => {
    window.api
      .getMemoryRange()
      .then((r) => {
        setRange(r)
        setMemory(r.defaultMb)
      })
      .catch(() => undefined)
  }, [])

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
    onChange({ domainName: valid ? name.trim() : undefined, memoryMb: range ? memory : undefined, blocked: !valid || check === 'taken' || check === 'checking' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, valid, check, memory, range])

  return (
    <div className="reset-fields">
      <div className="setting-row col" style={{ padding: 0, border: 0 }}>
        <div className="setting-text">
          <div className="setting-label">
            서버 주소 이름
          </div>
        </div>
        <div className="domain-row">
          <input
            className="input"
            value={name}
            maxLength={20}
            placeholder="myserver"
            onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
          />
          <span className="domain-suffix">{`.${BASE}`}</span>
        </div>
        <p className={`hint ${check === 'taken' ? 'warn-text' : ''}`}>
          {name.trim() === ''
            ? ''
            : !valid
              ? '영어 소문자, 숫자, 하이픈(-)으로 3~20자로 적어 주세요. (하이픈은 처음과 끝에 쓸 수 없어요)'
              : check === 'checking'
                ? '쓸 수 있는지 확인하고 있어요…'
                : check === 'free'
                  ? '쓸 수 있는 이름이에요.'
                  : check === 'taken'
                    ? '이미 다른 사람이 쓰는 이름이에요. 다른 이름으로 해 주세요.'
                    : check === 'error'
                      ? '지금은 확인하지 못했어요. 서버를 만든 뒤에 다시 확인해요.'
                      : ''}
        </p>
      </div>

      {range && (
        <div className="setting-row col" style={{ padding: 0, border: 0, marginTop: 16 }}>
          <div className="setting-text">
            <div className="setting-label">
              서버가 쓸 메모리 <b className="mem-value">{gb(memory)}</b>
            </div>
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
          {range.totalMb - memory < 4096 && <p className="warn-text mem-warn">{`⚠ 컴퓨터에 ${gb(Math.max(0, range.totalMb - memory))}만 남아요. 같은 컴퓨터에서 게임도 하면 버벅일 수 있어요.`}</p>}
        </div>
      )}
    </div>
  )
}
