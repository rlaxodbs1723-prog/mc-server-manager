// 서버 아이콘: 멀티플레이 목록에 보이는 그림. 서버 폴더의 server-icon.png (64×64)
// 아무 그림이나 받아서 가운데를 정사각형으로 자른 뒤 64×64로 줄여 저장한다. 서버를 다시 켜면 적용된다.
import { dialog, nativeImage, type BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import { tr } from './i18n'

const FILE = 'server-icon.png'

export function getServerIcon(folderPath: string): string | null {
  const p = path.join(folderPath, FILE)
  if (!fs.existsSync(p)) return null
  return `data:image/png;base64,${fs.readFileSync(p).toString('base64')}`
}

export function setServerIconFrom(folderPath: string, source: string): string {
  const img = nativeImage.createFromPath(path.resolve(String(source)))
  if (img.isEmpty()) throw new Error('그림 파일(png, jpg 등)을 넣어 주세요.')
  const { width, height } = img.getSize()
  const side = Math.min(width, height)
  const square = img.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side })
  const icon = square.resize({ width: 64, height: 64, quality: 'best' })
  fs.writeFileSync(path.join(folderPath, FILE), icon.toPNG())
  return icon.toDataURL()
}

export async function pickServerIcon(folderPath: string, win: BrowserWindow | null): Promise<string | null> {
  const opts = { title: tr('서버 아이콘으로 쓸 그림을 골라 주세요'), properties: ['openFile' as const], filters: [{ name: tr('그림'), extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] }] }
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (res.canceled || !res.filePaths[0]) return null
  return setServerIconFrom(folderPath, res.filePaths[0])
}

export function removeServerIcon(folderPath: string): void {
  fs.rmSync(path.join(folderPath, FILE), { force: true })
}
