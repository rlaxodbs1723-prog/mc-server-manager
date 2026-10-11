import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { InvItem, ItemIcon, ModelBox } from '../../shared-types'

// 블록 모델: 게임 파일의 상자들을 크기 그대로, 인벤토리와 같은 각도로 그린다 (계단, 반 블록, 버튼 등)
type V3 = [number, number, number]
type Dir = keyof ModelBox['faces']
const NORMAL: Record<Dir, V3> = { up: [0, 1, 0], down: [0, -1, 0], north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0] }
// 면마다 [그림 왼쪽 위, 오른쪽 위, 왼쪽 아래] 모서리
function faceCorners(d: Dir, [x1, y1, z1]: number[], [x2, y2, z2]: number[]): [V3, V3, V3] {
  switch (d) {
    case 'up':
      return [
        [x1, y2, z1],
        [x2, y2, z1],
        [x1, y2, z2]
      ]
    case 'down':
      return [
        [x1, y1, z2],
        [x2, y1, z2],
        [x1, y1, z1]
      ]
    case 'north':
      return [
        [x2, y2, z1],
        [x1, y2, z1],
        [x2, y1, z1]
      ]
    case 'south':
      return [
        [x1, y2, z2],
        [x2, y2, z2],
        [x1, y1, z2]
      ]
    case 'west':
      return [
        [x1, y2, z1],
        [x1, y2, z2],
        [x1, y1, z1]
      ]
    case 'east':
      return [
        [x2, y2, z2],
        [x2, y2, z1],
        [x2, y1, z2]
      ]
  }
}
// 그림에서 쓸 부분을 따로 안 적었으면 상자 위치로 정한다 (게임과 같은 규칙)
function defaultUv(d: Dir, [x1, y1, z1]: number[], [x2, y2, z2]: number[]): number[] {
  switch (d) {
    case 'up':
      return [x1, z1, x2, z2]
    case 'down':
      return [x1, 16 - z2, x2, 16 - z1]
    case 'north':
      return [16 - x2, 16 - y2, 16 - x1, 16 - y1]
    case 'south':
      return [x1, 16 - y2, x2, 16 - y1]
    case 'west':
      return [z1, 16 - y2, z2, 16 - y1]
    case 'east':
      return [16 - z2, 16 - y2, 16 - z1, 16 - y1]
  }
}

function ModelIcon({ textures, boxes, rotY, onDrawn }: { textures: Record<string, string>; boxes: ModelBox[]; rotY: number; onDrawn?: (url: string) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const px = Math.round(48 * (window.devicePixelRatio || 1)) // 화면에 보이는 크기(48) x 화면 배율
  const HI = px / 64
  useEffect(() => {
    const c = ref.current?.getContext('2d')
    if (!c) return
    let alive = true
    const imgs: Record<string, HTMLImageElement> = {}
    Promise.all(
      Object.entries(textures).map(
        ([k, src]) =>
          new Promise<void>((res) => {
            const img = new Image()
            img.onload = () => ((imgs[k] = img), res())
            img.onerror = () => res()
            img.src = src
          })
      )
    ).then(() => {
      if (!alive) return
      // 기본 각도(225도)와 다르게 보이는 모델(계단 등)은 90도 단위로 돌린다
      const k = ((Math.round((225 - rotY) / 90) % 4) + 4) % 4
      const rot = ([x, y, z]: V3): V3 => {
        for (let i = 0; i < k; i++) [x, z] = [16 - z, x]
        return [x, y, z]
      }
      const rotN = ([x, y, z]: V3): V3 => {
        for (let i = 0; i < k; i++) [x, z] = [-z, x]
        return [x, y, z]
      }
      // 화면 좌표: 오른쪽 앞 모서리가 가운데 아래
      // 화면 좌표: 오른쪽 앞 모서리가 가운데 아래. 게임 인벤토리 각도(위로 30도, 옆으로 45도)와 같은 비율
      // 게임처럼 실제 화면 픽셀 수(화면 배율 포함)에 딱 맞춰 한 번에 그린다. 그린 뒤 늘이거나 줄이면 픽셀이 깨지거나 뭉개진다
      const P = ([x, y, z]: V3): [number, number] => [
        HI * (32 + 1.6875 * (16 - x) - 1.6875 * z), // 게임처럼 동쪽 면이 왼쪽, 북쪽 면이 오른쪽
        HI * (62 + 0.84375 * (x - 16) - 0.84375 * z - 2.0625 * y)
      ]
      c.setTransform(1, 0, 0, 1, 0, 0)
      c.clearRect(0, 0, 64 * HI, 64 * HI)
      c.imageSmoothingEnabled = false
      // 그늘진 그림은 미리 어둡게 만들어 둔다 (그린 뒤에 덧칠하면 면 가장자리가 밝게 튀어 보인다)
      const shaded = new Map<string, CanvasImageSource>()
      const tinted = (key: string, img: HTMLImageElement, shade: number): CanvasImageSource => {
        if (!shade) return img
        const id = `${key}|${shade}`
        let out = shaded.get(id)
        if (!out) {
          const cv = document.createElement('canvas')
          cv.width = img.width
          cv.height = img.height
          const x = cv.getContext('2d')!
          x.drawImage(img, 0, 0)
          x.globalCompositeOperation = 'source-atop'
          x.fillStyle = `rgba(0,0,0,${shade})`
          x.fillRect(0, 0, cv.width, cv.height)
          shaded.set(id, cv)
          out = cv
        }
        return out
      }
      // 보이는 면을 모두 모아, 보는 쪽에서 먼 면부터 그린다 (상자 단위로 정하면 계단처럼 붙은 상자에서 면이 잘못 겹친다)
      const faces: { depth: number; draw: () => void }[] = []
      for (const b of boxes) {
        for (const [d, f] of Object.entries(b.faces) as [Dir, { tex: string; uv?: number[] }][]) {
          const n = rotN(NORMAL[d])
          const shade = n[1] > 0 ? 0 : n[0] > 0 ? 0.22 : n[2] < 0 ? 0.42 : -1
          const img = imgs[f.tex]
          if (shade < 0 || !img) continue // 안 보이는 면
          const corners = faceCorners(d, b.from, b.to).map((p) => rot(p))
          // 면 가운데의 깊이 (화면 쪽으로 갈수록 크다)
          const cx = (corners[1][0] + corners[2][0]) / 2
          const cy = (corners[1][1] + corners[2][1]) / 2
          const cz = (corners[1][2] + corners[2][2]) / 2
          faces.push({
            depth: 0.5 * cy + 0.612 * (cx - cz),
            draw: () => {
              let [o, u, v] = corners.map(P)
              let U: [number, number] = [u[0] - o[0], u[1] - o[1]]
              let V: [number, number] = [v[0] - o[0], v[1] - o[1]]
              let [u1, v1, u2, v2] = f.uv ?? defaultUv(d, b.from, b.to)
              // 그림을 뒤집어 쓰는 면
              if (u1 > u2) {
                ;[u1, u2] = [u2, u1]
                o = [o[0] + U[0], o[1] + U[1]]
                U = [-U[0], -U[1]]
              }
              if (v1 > v2) {
                ;[v1, v2] = [v2, v1]
                o = [o[0] + V[0], o[1] + V[1]]
                V = [-V[0], -V[1]]
              }
              const s = img.width / 16
              const sw = Math.max((u2 - u1) * s, 0.01)
              const sh = Math.max((v2 - v1) * s, 0.01)
              c.setTransform(U[0], U[1], V[0], V[1], o[0], o[1])
              // 면 사이에 틈이 보이지 않게 가장자리를 반 픽셀씩 겹쳐 그린다
              const eu = 0.5 / Math.max(Math.hypot(U[0], U[1]), 0.5)
              const ev = 0.5 / Math.max(Math.hypot(V[0], V[1]), 0.5)
              c.drawImage(tinted(f.tex, img, shade), u1 * s, v1 * s, sw, sh, -eu, -ev, 1 + 2 * eu, 1 + 2 * ev)
            }
          })
        }
      }
      faces.sort((x, y) => x.depth - y.depth).forEach((f) => f.draw())
      c.setTransform(1, 0, 0, 1, 0, 0)
      onDrawn?.(c.canvas.toDataURL())
      c.setTransform(1, 0, 0, 1, 0, 0)
      c.globalCompositeOperation = 'source-over'
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textures, boxes, rotY, HI])
  return <canvas ref={ref} width={px} height={px} className="inv-icon" />
}

export function ItemIconView({ icon, name, glint }: { icon: ItemIcon | null; name: string; glint?: string | null }) {
  const [drawn, setDrawn] = useState<string | null>(null)
  let view
  if (icon?.kind === 'model') view = <ModelIcon {...icon} onDrawn={glint ? setDrawn : undefined} />
  else if (icon?.kind === 'flat')
    view = (
      <span className="inv-icon inv-flat">
        {icon.layers.map((src, i) => (
          <img key={i} src={src} alt="" draggable={false} />
        ))}
      </span>
    )
  // 그림을 못 찾은 아이템 (일부 모드 아이템 등): 이름 첫 글자
  else view = <span className="inv-icon inv-missing">{name.slice(0, 1).toUpperCase()}</span>
  if (!glint) return view
  // 게임처럼 아이템 모양 안에서만 보라색 반짝임이 흐른다
  const mask = icon?.kind === 'flat' ? icon.layers.map((u) => `url(${u})`).join(', ') : drawn ? `url(${drawn})` : null
  return (
    <span className="inv-glint-wrap">
      {view}
      {mask && <span className="inv-glint" style={{ backgroundImage: `url(${glint})`, maskImage: mask, WebkitMaskImage: mask }} />}
    </span>
  )
}

// 아이템 개수: 게임 글꼴 숫자 그림으로 그림자까지 똑같이 그린다 (그림이 없으면 글자로)
function Count({ n, digits }: { n: number; digits: string | null }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const text = String(n)
  const w = text.length * 6 + 1
  useEffect(() => {
    const c = ref.current?.getContext('2d')
    if (!c || !digits) return
    const img = new Image()
    img.onload = () => {
      const k = img.width / 80
      c.clearRect(0, 0, w, 9)
      c.imageSmoothingEnabled = false
      const draw = (dx: number, dy: number) => [...text].forEach((ch, i) => c.drawImage(img, Number(ch) * 8 * k, 0, 8 * k, 8 * k, i * 6 + dx, dy, 8, 8))
      draw(1, 1)
      c.globalCompositeOperation = 'source-atop'
      c.fillStyle = '#3f3f3f'
      c.fillRect(0, 0, w, 9)
      c.globalCompositeOperation = 'source-over'
      draw(0, 0)
    }
    img.src = digits
  }, [text, w, digits])
  if (!digits) return <span className="inv-count">{text}</span>
  return <canvas ref={ref} width={w} height={9} className="inv-count-px" style={{ width: w * 3, height: 27 }} />
}

function Slot({ item, digits, glint, onHover }: { item?: InvItem; digits: string | null; glint: string | null; onHover: (i: InvItem | null, e?: React.MouseEvent) => void }) {
  return (
    <div className="inv-slot" onMouseMove={(e) => item && onHover(item, e)} onMouseLeave={() => onHover(null)}>
      {item && (
        <>
          <ItemIconView icon={item.icon} name={item.name} glint={item.glint ? glint : null} />
          {item.count > 1 && <Count n={item.count} digits={digits} />}
        </>
      )}
    </div>
  )
}

// 마우스를 올리면 게임처럼 이름, 인챈트, 내구도를 보여 준다
function useTooltip() {
  const [tip, setTip] = useState<{ item: InvItem; x: number; y: number } | null>(null)
  const onHover = (item: InvItem | null, e?: React.MouseEvent) => setTip(item && e ? { item, x: e.clientX, y: e.clientY } : null)
  const view =
    tip &&
    createPortal(
      <div className="inv-tip" style={{ left: tip.x + 14, top: tip.y + 10 }}>
        <b className={tip.item.customName ? 'custom' : tip.item.enchants.length ? 'ench' : ''}>{tip.item.customName ?? tip.item.name}</b>
        {tip.item.enchants.map((e) => (
          <span key={e} className="ench-line">
            {e}
          </span>
        ))}
        {tip.item.damage > 0 && <span className="dim">{`내구도 ${tip.item.damage} 닳음`}</span>}
        <span className="dim">{tip.item.id}</span>
      </div>,
      document.body // 창의 움직이는 효과 때문에 위치가 어긋나지 않도록 맨 위에
    )
  return { onHover, view }
}

// 게임의 플레이어 인벤토리: 갑옷 4칸 + 왼손, 가방 3줄, 핫바 1줄
export function PlayerInventory({ items, digits, glint }: { items: InvItem[]; digits: string | null; glint: string | null }) {
  const at = (slot: number) => items.find((i) => i.slot === slot)
  const { onHover, view } = useTooltip()
  return (
    <div className="inv-panel">
      <div className="inv-top">
        <div className="inv-col">
          {[103, 102, 101, 100].map((s) => (
            <Slot key={s} item={at(s)} digits={digits} glint={glint} onHover={onHover} />
          ))}
        </div>
        <div className="inv-col inv-offhand">
          <Slot item={at(-106)} digits={digits} glint={glint} onHover={onHover} />
        </div>
      </div>
      <div className="inv-grid">
        {Array.from({ length: 27 }, (_, i) => (
          <Slot key={i} item={at(9 + i)} digits={digits} glint={glint} onHover={onHover} />
        ))}
      </div>
      <div className="inv-grid hotbar">
        {Array.from({ length: 9 }, (_, i) => (
          <Slot key={i} item={at(i)} digits={digits} glint={glint} onHover={onHover} />
        ))}
      </div>
      {view}
    </div>
  )
}

// 엔더 상자: 3줄
export function EnderChest({ items, digits, glint }: { items: InvItem[]; digits: string | null; glint: string | null }) {
  const { onHover, view } = useTooltip()
  return (
    <div className="inv-panel">
      <div className="inv-grid">
        {Array.from({ length: 27 }, (_, i) => (
          <Slot key={i} item={items.find((it) => it.slot === i)} digits={digits} glint={glint} onHover={onHover} />
        ))}
      </div>
      {view}
    </div>
  )
}
