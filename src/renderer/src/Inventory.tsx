import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { GuiDisplay, InvItem, ItemIcon, ModelBox } from '../../shared-types'

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

// 상자의 한 면이 바로 붙어 있는 다른 상자에 완전히 덮이는지 (덮인 면을 그리면 가장자리로 새어 보인다)
const AXIS: Record<Dir, [number, 1 | -1]> = { up: [1, 1], down: [1, -1], east: [0, 1], west: [0, -1], south: [2, 1], north: [2, -1] }
function hidden(b: ModelBox, d: Dir, boxes: ModelBox[]): boolean {
  if (b.rotation) return false // 기울어진 부품은 맞붙었는지 따지지 않는다
  const [ax, sign] = AXIS[d]
  const plane = sign > 0 ? b.to[ax] : b.from[ax]
  const others = [0, 1, 2].filter((i) => i !== ax)
  return boxes.some(
    (o) => o !== b && !o.rotation && (sign > 0 ? o.from[ax] : o.to[ax]) === plane && others.every((i) => o.from[i] <= b.from[i] && o.to[i] >= b.to[i])
  )
}

// 부품 회전: origin을 중심으로 axis 축을 angle도
function rotateAround(p: V3, r: NonNullable<ModelBox['rotation']>, normal = false): V3 {
  const a = (r.angle * Math.PI) / 180
  const [ox, oy, oz] = normal ? [0, 0, 0] : r.origin
  let [x, y, z] = [p[0] - ox, p[1] - oy, p[2] - oz]
  const c = Math.cos(a)
  const s = Math.sin(a)
  if (r.axis === 'x') [y, z] = [y * c - z * s, y * s + z * c]
  else if (r.axis === 'y') [x, z] = [x * c + z * s, -x * s + z * c]
  else [x, y] = [x * c - y * s, x * s + y * c]
  return [x + ox, y + oy, z + oz]
}

function ModelIcon({
  textures,
  boxes,
  rotY,
  display,
  onDrawn
}: {
  textures: Record<string, string>
  boxes: ModelBox[]
  rotY: number
  display?: GuiDisplay
  onDrawn?: (url: string) => void
}) {
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
      // 게임처럼: 부품 회전 -> 인벤토리 각도(기본 225도와의 차이만큼 세로축으로) -> 크기 -> 위치
      const theta = ((225 - (display?.rotation?.[1] ?? rotY)) * Math.PI) / 180
      const ct = Math.cos(theta)
      const st = Math.sin(theta)
      const spin = ([x, y, z]: V3, normal = false): V3 => {
        const [dx, dz] = normal ? [x, z] : [x - 8, z - 8]
        const nx = ct * dx - st * dz
        const nz = st * dx + ct * dz
        return normal ? [nx, y, nz] : [nx + 8, y, nz + 8]
      }
      const world = (p: V3, b: ModelBox): V3 => spin(b.rotation ? rotateAround(p, b.rotation) : p)
      const worldN = (n: V3, b: ModelBox): V3 => spin(b.rotation ? rotateAround(n, b.rotation, true) : n, true)
      const zoom = (display?.scale?.[0] ?? 0.625) / 0.625
      const shiftX = (display?.translation?.[0] ?? 0) * 4 * HI
      const shiftY = -(display?.translation?.[1] ?? 0) * 4 * HI
      // 화면 좌표: 오른쪽 앞 모서리가 가운데 아래. 게임 인벤토리 각도(위로 30도, 옆으로 45도)와 같은 비율
      // 게임처럼 실제 화면 픽셀 수(화면 배율 포함)에 딱 맞춰 한 번에 그린다. 그린 뒤 늘이거나 줄이면 픽셀이 깨지거나 뭉개진다
      const mid = 32 * HI
      const P = ([x, y, z]: V3): [number, number] => [
        mid + zoom * (HI * (32 + 1.6875 * (16 - x) - 1.6875 * z) - mid) + shiftX, // 게임처럼 동쪽 면이 왼쪽, 북쪽 면이 오른쪽
        mid + zoom * (HI * (62 + 0.84375 * (x - 16) - 0.84375 * z - 2.0625 * y) - mid) + shiftY
      ]
      // 보는 쪽 방향 (깊이·보이는 면 판단)
      const VIEW: V3 = [0.612, 0.5, -0.612]
      const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
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
        for (const [d, f] of Object.entries(b.faces) as [Dir, { tex: string; uv?: number[]; rotation?: number }][]) {
          if (hidden(b, d, boxes)) continue // 다른 상자에 완전히 덮인 면 (맞붙은 곳)
          const n = worldN(NORMAL[d], b)
          const img = imgs[f.tex]
          if (dot(n, VIEW) <= 1e-6 || !img) continue // 안 보이는 면
          // 밝기: 윗면은 그대로, 옆면은 동서 방향 0.22, 남북 방향 0.42만큼 어둡게 (기울어진 면은 섞어서)
          const side = n[0] * n[0] + n[2] * n[2]
          const shade = Math.round((side ? (0.22 * n[0] * n[0] + 0.42 * n[2] * n[2]) / side : 0) * (1 - Math.max(0, n[1])) * 100) / 100
          const corners = faceCorners(d, b.from, b.to).map((p) => world(p, b))
          // 면 가운데의 깊이 (화면 쪽으로 갈수록 크다)
          const center: V3 = [(corners[1][0] + corners[2][0]) / 2, (corners[1][1] + corners[2][1]) / 2, (corners[1][2] + corners[2][2]) / 2]
          faces.push({
            depth: dot(center, VIEW),
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
              // 면 그림을 돌려 쓰는 경우 (시계 방향 90/180/270도): 그림의 왼쪽 위가 닿는 모서리를 바꾼다
              const turn = ((((f.rotation ?? 0) / 90) % 4) + 4) % 4
              if (turn) {
                const c0: [number, number] = o
                const c1: [number, number] = [o[0] + U[0], o[1] + U[1]]
                const c3: [number, number] = [o[0] + V[0], o[1] + V[1]]
                const c2: [number, number] = [c1[0] + V[0], c1[1] + V[1]]
                const [no, nu, nv] = turn === 1 ? [c1, c2, c0] : turn === 2 ? [c2, c3, c1] : [c3, c0, c2]
                o = no
                U = [nu[0] - no[0], nu[1] - no[1]]
                V = [nv[0] - no[0], nv[1] - no[1]]
              }
              // uv는 0~16 기준. 그림이 정사각형이 아닐 수도 있어서(몹 모델 면) 가로세로 따로 맞춘다
              const sx = img.width / 16
              const sy = img.height / 16
              const sw = Math.max((u2 - u1) * sx, 0.01)
              const sh = Math.max((v2 - v1) * sy, 0.01)
              c.setTransform(U[0], U[1], V[0], V[1], o[0], o[1])
              // 면 사이에 틈이 보이지 않게 가장자리를 반 픽셀씩 겹쳐 그린다
              const eu = 0.5 / Math.max(Math.hypot(U[0], U[1]), 0.5)
              const ev = 0.5 / Math.max(Math.hypot(V[0], V[1]), 0.5)
              // 텍스처를 줄여서 그릴 때(한 칸이 1픽셀보다 작을 때)는 섞어서 그린다. 안 그러면 픽셀이 빠져서 깨져 보인다
              const shrink = Math.hypot(U[0], U[1]) < sw || Math.hypot(V[0], V[1]) < sh
              c.imageSmoothingEnabled = shrink
              c.imageSmoothingQuality = 'high'
              c.drawImage(tinted(f.tex, img, shade), u1 * sx, v1 * sy, sw, sh, -eu, -ev, 1 + 2 * eu, 1 + 2 * ev)
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
  }, [textures, boxes, rotY, display, HI])
  return <canvas ref={ref} width={px} height={px} className="inv-icon" />
}

// 회색 그림에 색을 곱해 칠한다 (물약 색, 염색 색). 투명한 곳은 그대로
function Tinted({ src, color }: { src: string; color: number }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      const cv = document.createElement('canvas')
      cv.width = img.width
      cv.height = img.height
      const c = cv.getContext('2d')!
      c.drawImage(img, 0, 0)
      c.globalCompositeOperation = 'multiply'
      c.fillStyle = `#${color.toString(16).padStart(6, '0')}`
      c.fillRect(0, 0, cv.width, cv.height)
      c.globalCompositeOperation = 'destination-in'
      c.drawImage(img, 0, 0)
      setUrl(cv.toDataURL())
    }
    img.src = src
  }, [src, color])
  return url ? <img src={url} alt="" draggable={false} /> : null
}

export function ItemIconView({ icon, name, glint, color }: { icon: ItemIcon | null; name: string; glint?: string | null; color?: number }) {
  const [drawn, setDrawn] = useState<string | null>(null)
  let view
  if (icon?.kind === 'model') view = <ModelIcon {...icon} onDrawn={glint ? setDrawn : undefined} />
  else if (icon?.kind === 'flat')
    view = (
      <span className="inv-icon inv-flat">
        {icon.layers.map((src, i) =>
          icon.tint?.layer === i ? <Tinted key={i} src={src} color={color ?? icon.tint.color} /> : <img key={i} src={src} alt="" draggable={false} />
        )}
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

function Slot({
  item,
  digits,
  glint,
  onHover
}: {
  item?: InvItem
  digits: string | null
  glint: string | null
  onHover: (i: InvItem | null, e?: React.MouseEvent) => void
}) {
  return (
    <div className="inv-slot" onMouseMove={(e) => item && onHover(item, e)} onMouseLeave={() => onHover(null)}>
      {item && (
        <>
          <ItemIconView icon={item.icon} name={item.name} glint={item.glint ? glint : null} color={item.color} />
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
