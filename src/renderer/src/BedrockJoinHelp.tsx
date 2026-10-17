import { Copy } from 'lucide-react'
import BedrockLoopbackNotice from './BedrockLoopbackNotice'
import { Modal, useToast } from './ui'

// 배드락 서버에 들어오는 방법: 기기마다 다르다. 주소와 포트를 따로 입력해야 한다
export default function BedrockJoinHelp({
  address,
  port,
  lan,
  tunnel,
  onClose
}: {
  address: string
  port: number
  lan: string[]
  tunnel: boolean
  onClose: () => void
}) {
  const toast = useToast()
  // 주소에 포트가 붙어 있으면(숫자 주소 :19133 또는 터널 주소) 떼어서 따로 보여 준다
  const host = address.replace(/:\d+$/, '')
  const joinPort = Number(/:(\d+)$/.exec(address)?.[1]) || port
  const copy = async (text: string, what: string) => {
    await window.api.copyText(text)
    toast(`${what}을(를) 복사했어요`)
  }
  return (
    <Modal onClose={onClose}>
      <h2>배드락으로 들어오는 방법</h2>
      <div className="join-box">
        <div className="join-row">
          <span className="hint">주소</span>
          <b>{host}</b>
          <button className="btn icon sm ghost" onClick={() => copy(host, '주소')} title="복사">
            <Copy size={14} />
          </button>
        </div>
        <div className="join-row">
          <span className="hint">포트</span>
          <b>{joinPort}</b>
          <button className="btn icon sm ghost" onClick={() => copy(String(joinPort), '포트')} title="복사">
            <Copy size={14} />
          </button>
        </div>
      </div>
      <BedrockLoopbackNotice />
      <div className="join-steps">
        <p>
          <b>윈도우 · 폰 · 태블릿</b>
          <br />
          배드락 에디션에서 플레이 → 서버 → 서버 추가를 눌러요. 서버 이름은 마음대로, 주소와 포트는 위의 값을 따로 넣어요.
        </p>
        <p>
          <b>Xbox · PlayStation · Switch</b>
          <br />
          콘솔의 배드락에는 서버를 직접 추가하는 메뉴가 없어요. 같은 와이파이라면 친구 탭의 LAN 목록에 보일 수 있고, 그 밖에는 별도의 접속 도구(BedrockConnect
          같은 외부 서비스)가 필요해요.
        </p>
        {lan.length > 0 && (
          <p>
            <b>같은 와이파이</b>
            <br />
            {`주소에 ${lan.join(' 또는 ')}, 포트에 ${port}을 넣어요. 이 컴퓨터의 배드락에서는 주소를 127.0.0.1로 해 봐도 되고, 안 들어가지면 위의 와이파이 주소를 써요.`}
          </p>
        )}
        <p>
          <b>안 들어와질 때</b>
          <br />
          {tunnel
            ? '터널로 열려 있어요. 터널 주소가 바뀌면 다시 알려 줘야 해요.'
            : '공유기에서 UDP 포트가 열려 있어야 해요. 위의 접속 확인 버튼으로 밖에서 접속되는지 볼 수 있어요. 공유기가 두 개이면 터널로 열어야 해요.'}{' '}
          서버를 업데이트하지 않은 채 게임만 새 버전이 되어도 접속이 안 돼요.
        </p>
      </div>
      <div className="actions">
        <button className="btn primary" onClick={onClose}>
          확인
        </button>
      </div>
    </Modal>
  )
}
