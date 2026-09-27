import { useEffect, useRef, useState } from 'react'
import { UNDO_MS, useToast } from './ui'

// 지우기처럼 되돌릴 수 없는 일은 바로 하지 않고, 목록에서만 먼저 숨긴 채 "되돌리기" 알림을 띄운다.
// 알림이 사라지면(6초) 그때 실제로 지운다. 화면을 떠나거나 서버를 켜기 전에는 기다리지 않고 바로 처리한다.
interface Pending {
  timer: ReturnType<typeof setTimeout>
  fire: () => Promise<void>
}

// 서버를 켜기 전에 남은 지우기를 모두 끝내려고 모아 둔다
const flushers = new Set<() => Promise<void>>()
export async function flushPendingRemovals(): Promise<void> {
  await Promise.all([...flushers].map((f) => f()))
}

export function useDelayedRemove() {
  const toast = useToast()
  const pending = useRef(new Map<string, Pending>())
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const unhide = (key: string): void =>
    setHidden((h) => {
      const n = new Set(h)
      n.delete(key)
      return n
    })

  const flush = async (): Promise<void> => {
    const list = [...pending.current.values()]
    pending.current.clear()
    for (const p of list) clearTimeout(p.timer)
    await Promise.all(list.map((p) => p.fire()))
  }

  useEffect(() => {
    flushers.add(flush)
    // 창을 닫으려 하면: 닫기를 한 번 멈추고, 기다리던 지우기를 끝낸 다음 다시 닫는다 (지운 줄 알았는데 남아 있지 않게)
    const onUnload = (e: BeforeUnloadEvent): void => {
      if (!pending.current.size) return
      e.preventDefault()
      e.returnValue = false
      void flush().then(() => window.api.windowControl('close'))
    }
    window.addEventListener('beforeunload', onUnload)
    return () => {
      flushers.delete(flush)
      window.removeEventListener('beforeunload', onUnload)
      void flush() // 화면을 떠나면 기다리지 않고 지운다
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 기다리던 지우기를 모두 취소한다 (지운 것처럼 숨겼던 것도 다시 보인다). 취소한 수를 돌려준다
  const cancelAll = (): number => {
    const n = pending.current.size
    for (const p of pending.current.values()) clearTimeout(p.timer)
    pending.current.clear()
    setHidden(new Set())
    return n
  }

  // key: 목록에서 숨길 항목, text: 알림 문구, run: 실제로 지우는 일
  function schedule(key: string, text: string, run: () => Promise<void>): void {
    setHidden((h) => new Set(h).add(key))
    const fire = async (): Promise<void> => {
      pending.current.delete(key)
      try {
        await run()
      } finally {
        unhide(key)
      }
    }
    const timer = setTimeout(fire, UNDO_MS)
    pending.current.set(key, { timer, fire })
    toast(text, 'success', {
      label: '되돌리기',
      onClick: () => {
        clearTimeout(timer)
        pending.current.delete(key)
        unhide(key)
      }
    })
  }

  return { hidden, schedule, cancelAll }
}
