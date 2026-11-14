import { useEffect, useState } from 'react'

// 플레이어 머리·몸 그림. 앱이 컴퓨터에 저장해 둔 것을 바로 보여 주고, 처음 보는 이름만 받아 온다
const memo = new Map<string, string>() // 이번에 받은 그림 (화면을 옮겨 다녀도 깜빡이지 않게)
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='

export default function McHead({ name, kind = 'avatar', size = 40, className }: { name: string; kind?: 'avatar' | 'body'; size?: number; className?: string }) {
  const key = `${kind}-${size}-${name}`
  const [src, setSrc] = useState<string | undefined>(() => memo.get(key))
  useEffect(() => {
    let on = true
    const have = memo.get(key)
    if (have) {
      setSrc(have)
      return
    }
    setSrc(undefined)
    window.api
      .getAvatar(name, kind, size)
      .then((u) => {
        if (!u) return
        memo.set(key, u)
        if (on) setSrc(u)
      })
      .catch(() => undefined)
    return () => {
      on = false
    }
  }, [key, name, kind, size])
  return <img className={className} src={src ?? BLANK} alt="" draggable={false} />
}
