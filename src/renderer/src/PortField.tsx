import { Globe } from 'lucide-react'
import { useEffect, useState } from 'react'
import DomainDialog from './DomainDialog'
import { useToast } from './ui'
import { cleanError } from './util'

// 서버가 꺼져 있을 때 접속 주소 자리에 보이는 서버 포트 칸. 서버를 켜면 접속 주소로 바뀐다
export default function PortField({ folderPath }: { folderPath: string }) {
  const toast = useToast()
  const [saved, setSaved] = useState(25565)
  const [text, setText] = useState('25565')
  const [domainOpen, setDomainOpen] = useState(false)
  const [domain, setDomain] = useState<string | null>(null) // 만들어 둔 이름 주소

  useEffect(() => {
    window.api
      .getSettings(folderPath)
      .then((s) => {
        const p = Number(s.properties['server-port'] || 25565)
        setSaved(p)
        setText(String(p))
      })
      .catch(() => undefined)
  }, [folderPath])

  useEffect(() => {
    if (!domainOpen) window.api.getDomain(folderPath).then((d) => setDomain(d?.host ?? null)).catch(() => undefined)
  }, [folderPath, domainOpen])

  async function commit() {
    const port = Number(text)
    if (port === saved) return setText(String(saved))
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      setText(String(saved))
      return toast('포트는 1024~65535 사이의 숫자로 적어 주세요', 'error')
    }
    try {
      const s = await window.api.getSettings(folderPath)
      const clash = s.automation.autoStart ? s.otherAutoStart.filter((o) => o.port === port).map((o) => o.name) : []
      if (clash.length) {
        setText(String(saved))
        return toast(`${clash.join(', ')} 서버와 포트(${port})가 겹쳐요. 다른 숫자로 해 주세요`, 'error')
      }
      await window.api.saveSettings(folderPath, { properties: { 'server-port': String(port) } })
      setSaved(port)
      toast(`서버 포트를 ${port}(으)로 바꿨어요. 다음에 켤 때부터 이 포트로 열려요`, 'success')
    } catch (e) {
      setText(String(saved))
      toast(cleanError(e), 'error')
    }
  }

  return (
    <>
      <label className="port-field" title="플레이어가 접속하는 포트예요. 서버를 여러 개 동시에 켤 때만 바꾸세요">
        <span>서버 포트</span>
        <input
          type="text"
          inputMode="numeric"
          value={text}
          onChange={(e) => setText(e.target.value.replace(/\D/g, '').slice(0, 5))}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </label>
      <button className="port-domain" onClick={() => setDomainOpen(true)} title="숫자 대신 외우기 쉬운 이름으로 접속하게 해요">
        <Globe size={13} />
        {domain ?? '이름 주소 만들기'}
      </button>
      {domainOpen && <DomainDialog folderPath={folderPath} onClose={() => setDomainOpen(false)} />}
    </>
  )
}
