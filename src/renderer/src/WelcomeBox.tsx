import { useEffect, useRef, useState } from 'react'
import { useToast } from './ui'
import { cleanError } from './util'

// 들어온 사람에게만 보이는 환영 메시지 입력칸 (관리 탭의 난이도 위). 칸을 벗어나거나 엔터를 치면 저장한다. 서버가 꺼져 있어도 바꿀 수 있다
export default function WelcomeBox({ folderPath }: { folderPath: string }) {
  const toast = useToast()
  const [text, setText] = useState('')
  const saved = useRef('')

  useEffect(() => {
    let alive = true
    window.api
      .getSettings(folderPath)
      .then((s) => {
        if (!alive) return
        saved.current = s.automation.welcome
        setText(s.automation.welcome)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [folderPath])

  async function save() {
    if (text === saved.current) return
    try {
      await window.api.saveSettings(folderPath, { automation: { welcome: text } })
      saved.current = text
      toast(text.trim() ? '환영 메시지를 저장했어요' : '환영 메시지를 껐어요')
    } catch (e) {
      toast(cleanError(e), 'error')
    }
  }

  return (
    <>
      <input
        className="input"
        value={text}
        maxLength={200}
        placeholder="{name}님 어서 오세요!"
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <p className="hint" style={{ marginTop: 8 }}>
        들어온 사람에게만 보여요. {'{name}'}은 그 사람 닉네임으로 바뀌어요. 비우면 보내지 않아요.
      </p>
    </>
  )
}
