import { useEffect, useRef, type RefObject } from 'react'

// 마우스 엄지 버튼(뒤로가기)으로 "한 단계 뒤로" 가기.
// 뒤로 갈 곳이 여러 화면에 겹쳐 있으면(예: 서버 만들기 창 안의 맵 보기) 가장 안쪽 화면이 먼저 받는다.
// handler가 null이면 지금은 뒤로 갈 곳이 없다는 뜻이라 바깥 화면에 넘긴다.
interface Entry {
  el: RefObject<HTMLElement | null>
  handler: RefObject<(() => void) | null>
}
const entries = new Set<Entry>()

function onMouse(e: MouseEvent): void {
  if (e.button !== 3) return // 3 = 뒤로 버튼
  e.preventDefault()
  if (e.type !== 'mouseup') return
  const live = [...entries].filter((x) => x.handler.current && x.el.current?.isConnected)
  // 다른 후보를 안에 품고 있지 않은 것 = 가장 안쪽
  const inner = live.find((x) => !live.some((y) => y !== x && x.el.current!.contains(y.el.current!)))
  inner?.handler.current?.()
}
window.addEventListener('mousedown', onMouse)
window.addEventListener('mouseup', onMouse)

export function useMouseBack(el: RefObject<HTMLElement | null>, handler: (() => void) | null): void {
  const h = useRef(handler)
  h.current = handler
  useEffect(() => {
    const entry: Entry = { el, handler: h }
    entries.add(entry)
    return () => {
      entries.delete(entry)
    }
  }, [el])
}
