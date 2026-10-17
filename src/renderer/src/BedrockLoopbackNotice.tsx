import { useEffect, useState } from 'react'
import type { BedrockLoopbackState } from '../../shared-types'
import { useToast } from './ui'
import { cleanError } from './util'

// 스토어 버전 마인크래프트는 기본으로 같은 PC의 서버에 접속할 수 없다. 해당될 때만 보이고, 버튼 한 번으로 허용한다 (관리자 확인 창이 한 번 뜬다)
export default function BedrockLoopbackNotice() {
  const toast = useToast()
  const [state, setState] = useState<BedrockLoopbackState | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.api
      .getBedrockLoopback()
      .then(setState)
      .catch(() => undefined)
  }, [])

  if (!state?.needed || state.allowed) return null

  async function allow() {
    setBusy(true)
    try {
      const next = await window.api.allowBedrockLoopback()
      setState(next)
      if (next.allowed) toast('허용했어요. 마인크래프트를 완전히 껐다 켠 뒤 127.0.0.1로 접속해 보세요', 'success')
      else toast('허용하지 못했어요. 관리자 확인 창에서 "예"를 눌러야 해요', 'error')
    } catch (e) {
      toast(cleanError(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="banner loopback-banner">
      <span>이 컴퓨터의 마인크래프트(스토어 버전)는 기본으로 같은 컴퓨터의 서버에 접속할 수 없어요. 허용하면 이 컴퓨터에서도 127.0.0.1로 들어갈 수 있어요. (관리자 확인 창이 한 번 떠요)</span>
      <button className="btn sm primary" onClick={allow} disabled={busy}>
        {busy ? <span className="spinner" /> : null}
        이 컴퓨터에서 접속되게 하기
      </button>
    </div>
  )
}
