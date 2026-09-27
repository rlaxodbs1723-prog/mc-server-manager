import { useLayoutEffect, type RefObject } from 'react'

// 창·메뉴·알림이 닫힐 때도 부드럽게 사라지게 한다.
// React는 닫히는 순간 요소를 바로 지워서 애니메이션을 걸 틈이 없다. 그래서 지워지기 직전의 모습을 복사해
// 같은 자리에 잠깐 두고 "leaving" 애니메이션을 돌린 뒤 없앤다 (복사본은 누를 수 없다).
// 어떤 버튼·키로 닫든 똑같이 동작한다.
const LEAVE_MS = 160

export function useLeaveAnimation(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = ref.current
    const parent = el?.parentNode
    return () => {
      if (!el || !parent) return
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      const ghost = el.cloneNode(true) as HTMLElement
      // 복사하면 입력 칸의 글자와 스크롤 위치는 따라오지 않아서 옮겨 준다
      const from = [el, ...el.querySelectorAll<HTMLElement>('*')]
      const to = [ghost, ...ghost.querySelectorAll<HTMLElement>('*')]
      ghost.classList.add('leaving')
      ghost.setAttribute('aria-hidden', 'true')
      ghost.style.pointerEvents = 'none'
      ;(parent.isConnected ? parent : document.body).appendChild(ghost)
      from.forEach((a, i) => {
        const b = to[i]
        if (!b) return
        if (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement) (b as HTMLInputElement).value = a.value
        if (a.scrollTop) b.scrollTop = a.scrollTop
      })
      setTimeout(() => ghost.remove(), LEAVE_MS)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
