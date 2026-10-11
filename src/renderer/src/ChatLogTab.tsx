import { ArrowDown, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatEvent, ChatLogList } from '../../shared-types'
import Select from './Select'
import { Empty, Loading } from './ui'
import { cleanError } from './util'

const LABEL: Record<Exclude<ChatEvent['kind'], 'chat' | 'say'>, string> = { join: '접속', leave: '퇴장', death: '', advancement: '' }

// 채팅 탭: 로그 파일을 골라서 채팅, 접속·퇴장, 사망, 발전 과제를 메신저처럼 보여 준다
export default function ChatLogTab({ folderPath }: { folderPath: string }) {
  const [list, setList] = useState<ChatLogList | null>(null)
  const [date, setDate] = useState('')
  const [events, setEvents] = useState<ChatEvent[] | null>(null)
  const [error, setError] = useState('')
  const [onlyChat, setOnlyChat] = useState(false)
  const [query, setQuery] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.api.listChatLogs(folderPath).then((l) => {
      setList(l)
      if (l.logs[0]) setDate(l.logs[0].date)
    })
  }, [folderPath])

  // 가장 최근 날짜는 서버가 켜져 있는 동안 계속 늘어나서 5초마다 다시 읽는다
  useEffect(() => {
    if (!date) return
    let alive = true
    setEvents(null)
    setError('')
    const load = () =>
      window.api
        .readChatLog(folderPath, date)
        .then((ev) => alive && setEvents(ev))
        .catch((e) => alive && setError(cleanError(e)))
    load()
    const t = date === list?.logs[0]?.date ? setInterval(load, 5000) : undefined
    return () => {
      alive = false
      clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderPath, date])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (events ?? []).filter((e) => (!onlyChat || e.kind === 'chat') && (!q || e.name.toLowerCase().includes(q) || e.text.toLowerCase().includes(q)))
  }, [events, onlyChat, query])

  // 최근 기록이 아래에 있어서 맨 아래로. 위로 올려 보는 중이면 그대로 둔다
  const atBottom = useRef(true)
  const [away, setAway] = useState(false) // 위로 올려 보는 중이면 '맨 아래로' 버튼을 띄운다
  useEffect(() => {
    const el = listRef.current
    if (el && atBottom.current) el.scrollTop = el.scrollHeight
  }, [shown])

  const options = (list?.logs ?? []).map((l) => ({ value: l.date, label: l.date }))
  const KEEP = [
    { value: '0', label: '계속 보관' },
    { value: '7', label: '7일 지나면 삭제' },
    { value: '30', label: '30일 지나면 삭제' },
    { value: '90', label: '90일 지나면 삭제' },
    { value: '365', label: '1년 지나면 삭제' }
  ]

  return (
    <div className="chatlog">
      {list === null ? (
        <Loading />
      ) : list.logs.length === 0 ? (
        <Empty title="로그가 없어요" hint="서버를 한 번 켜면 기록이 생겨요." />
      ) : (
        <>
          <div className="chatlog-bar">
            <div className="chatlog-date">
              <Select value={date} options={options} onChange={setDate} />
            </div>
            <div className="chatlog-search">
              <Search size={15} />
              <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름이나 내용 찾기" />
            </div>
            <div className="chatlog-keep" title="서버를 켤 때 오래된 기록을 지워요">
              <Select
                value={String(list.keepDays)}
                options={
                  KEEP.some((k) => k.value === String(list.keepDays))
                    ? KEEP
                    : [...KEEP, { value: String(list.keepDays), label: `${list.keepDays}일 지나면 삭제` }]
                }
                onChange={(v) =>
                  window.api.setLogKeepDays(folderPath, Number(v)).then(() =>
                    window.api.listChatLogs(folderPath).then((l) => {
                      setList(l)
                      if (!l.logs.some((x) => x.date === date)) setDate(l.logs[0]?.date ?? '')
                    })
                  )
                }
              />
            </div>
            <label className="check-row">
              <input type="checkbox" checked={onlyChat} onChange={(e) => setOnlyChat(e.target.checked)} />
              채팅만
            </label>
          </div>
          <div className="chatlog-wrap">
            <div
              className="chatlog-list"
              ref={listRef}
              onScroll={(e) => {
                atBottom.current = e.currentTarget.scrollHeight - e.currentTarget.scrollTop - e.currentTarget.clientHeight < 40
                setAway(!atBottom.current)
              }}
            >
              {error ? (
                <p className="error-text">{error}</p>
              ) : events === null ? (
                <Loading text="기록을 읽는 중이에요" />
              ) : shown.length === 0 ? (
                <Empty title={events.length ? '찾는 기록이 없어요' : '이 날은 채팅이 없어요'} />
              ) : (
                shown.map((e, i) => {
                  const prev = shown[i - 1]
                  const grouped = e.kind === 'chat' && prev?.kind === 'chat' && prev.name === e.name
                  if (e.kind === 'chat' || e.kind === 'say')
                    return (
                      <div key={i} className={`chat-row ${grouped ? 'grouped' : ''}`}>
                        {!grouped &&
                          (e.kind === 'say' ? (
                            <span className="chat-avatar say">📢</span>
                          ) : (
                            <img
                              className="chat-avatar"
                              src={`https://mc-heads.net/avatar/${e.name}/32`}
                              alt=""
                              onError={(ev) => (ev.currentTarget.style.visibility = 'hidden')}
                            />
                          ))}
                        <div className="chat-body">
                          {!grouped && <b className="chat-name">{e.kind === 'say' ? '서버 공지' : e.name}</b>}
                          <div className="chat-line">
                            <span className={`chat-bubble ${e.kind}`}>{e.text}</span>
                            <span className="chat-time">{e.time.slice(0, 5)}</span>
                          </div>
                        </div>
                      </div>
                    )
                  return (
                    <div key={i} className={`chat-event ${e.kind}`}>
                      <span>{e.kind === 'death' ? `💀 ${e.text}` : e.kind === 'advancement' ? `🏆 ${e.name} · ${e.text}` : `${e.name} ${LABEL[e.kind]}`}</span>
                      <span className="chat-time">{e.time.slice(0, 5)}</span>
                    </div>
                  )
                })
              )}
            </div>
            {away && (
              <button
                className="btn sm chatlog-bottom"
                onClick={() => {
                  const el = listRef.current
                  el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
                }}
              >
                <ArrowDown size={15} />맨 아래로
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
