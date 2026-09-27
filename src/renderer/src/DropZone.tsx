import { FileDown } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'

// 영역 어디에든 파일을 끌어다 놓을 수 있게 한다. 끌고 있는 동안 전체를 덮는 안내가 뜬다
export default function DropZone({ label, onFiles, disabled, children, className }: { label: string; onFiles: (files: FileList) => void; disabled?: boolean; children: ReactNode; className?: string }) {
  const [over, setOver] = useState(false)
  const depth = useRef(0) // 안쪽 요소를 지날 때마다 enter/leave가 오므로 깊이로 센다
  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes('Files')

  return (
    <div
      className={`drop-zone ${className ?? ''}`}
      onDragEnter={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        depth.current++
        setOver(true)
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = disabled ? 'none' : 'copy'
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1)
        if (!depth.current) setOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        depth.current = 0
        setOver(false)
        if (!disabled && e.dataTransfer.files.length) onFiles(e.dataTransfer.files)
      }}
    >
      {children}
      {over && (
        <div className={`drop-overlay ${disabled ? 'disabled' : ''}`}>
          <FileDown size={34} />
          <b>{disabled ? '서버를 끈 다음에 넣을 수 있어요' : label}</b>
        </div>
      )}
    </div>
  )
}
