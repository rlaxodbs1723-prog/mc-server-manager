// 버그 제보: 앱 안에서 디스코드 웹훅으로 바로 보낸다 (제보하는 사람은 계정이 필요 없다).
// 앱 버전·윈도우·언어는 알아서 붙인다. 사진·영상은 한 개씩 따로 올린다 (디스코드 한도 때문에).
// 웹훅 주소는 .env의 BUG_WEBHOOK을 빌드할 때 섞어서 넣는다 (섞는 쪽: build-tools/cfkey.mjs, MASK가 같아야 한다)
import { app, BrowserWindow, dialog } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { getAppSettings } from './appsettings'
import type { BugFile } from '../shared-types'

declare const __BUG_HOOK_ENC__: string
const MASK = 'mc-server-manager/cf'
export const BUG_MAX_BYTES = 10 * 1024 * 1024 // 디스코드 첨부 한도 (파일당 10MB)
export const BUG_MAX_FILES = 10
const GAP_MS = 60_000 // 1분에 한 번만 (실수로 여러 번 누르거나 장난으로 도배하지 않게)
const IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'webp']
const VIDEO = ['mp4', 'mov', 'webm']
let lastSent = 0

function hook(): string {
  const enc = typeof __BUG_HOOK_ENC__ === 'string' ? __BUG_HOOK_ENC__ : ''
  if (!enc) return ''
  const url = Buffer.from([...Buffer.from(enc, 'base64').reverse()].map((b, i) => b ^ MASK.charCodeAt(i % MASK.length))).toString('utf8')
  return /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(url) ? url : ''
}

// 디스코드에 보낼 글 (제목·설명·앱 정보). 길이는 디스코드 한도에 맞춰 자른다
export function bugMessage(title: string, details: string, fileNames: string[] = []): Record<string, unknown> {
  const cut = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s)
  const t = String(title ?? '').trim()
  const d = String(details ?? '').trim()
  return {
    username: 'MC CubePanel Bug Report',
    allowed_mentions: { parse: [] }, // @everyone 같은 걸 적어도 아무도 부르지 않게
    embeds: [
      {
        title: cut(t || 'Bug report', 250),
        description: cut(d || '(no details)', 4000),
        color: 0xff5555,
        fields: [
          { name: 'App', value: `MC CubePanel ${app.getVersion()}`, inline: true },
          { name: 'Windows', value: `${os.release()} (${process.arch})`, inline: true },
          { name: 'Language', value: getAppSettings().language, inline: true },
          ...(fileNames.length ? [{ name: 'Attachments', value: cut(fileNames.join('\n'), 1000) }] : [])
        ],
        timestamp: new Date().toISOString()
      }
    ]
  }
}

// 첨부할 수 있는 파일인지 보고 정보를 돌려준다 (사진·영상만, 10MB 이하)
export function bugFileInfo(file: string): BugFile {
  const p = path.resolve(String(file))
  const ext = path.extname(p).slice(1).toLowerCase()
  if (![...IMAGE, ...VIDEO].includes(ext)) throw new Error('사진(png, jpg, gif, webp)이나 영상(mp4, mov, webm)만 넣을 수 있어요.')
  let st: fs.Stats
  try {
    st = fs.statSync(p)
  } catch {
    throw new Error('파일을 찾을 수 없어요.')
  }
  if (!st.isFile()) throw new Error('파일을 찾을 수 없어요.')
  if (st.size > BUG_MAX_BYTES) throw new Error(`${path.basename(p)}: 10MB보다 커서 보낼 수 없어요.`)
  return { path: p, name: path.basename(p), size: st.size }
}

export async function pickBugFiles(win: BrowserWindow | null): Promise<BugFile[]> {
  const opts = { properties: ['openFile' as const, 'multiSelections' as const], filters: [{ name: 'Image / Video', extensions: [...IMAGE, ...VIDEO] }] }
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  return res.canceled ? [] : res.filePaths.map(bugFileInfo)
}

async function post(url: string, body: FormData | string): Promise<void> {
  const res = await fetch(`${url}?wait=true`, {
    method: 'POST',
    body,
    headers: typeof body === 'string' ? { 'Content-Type': 'application/json' } : undefined,
    signal: AbortSignal.timeout(120_000)
  })
  if (res.status === 429) throw new Error('제보가 너무 많이 몰렸어요. 잠시 뒤에 다시 보내 주세요.')
  if (!res.ok) throw new Error(`제보를 보내지 못했어요. (${res.status})`)
}

export async function sendBugReport(title: string, details: string, files: string[] = []): Promise<void> {
  if (!String(title ?? '').trim() && !String(details ?? '').trim()) throw new Error('무슨 문제인지 적어 주세요.')
  const url = hook()
  if (!url) throw new Error('이 버전에서는 제보를 보낼 수 없어요. 앱을 업데이트해 주세요.')
  const wait = lastSent + GAP_MS - Date.now()
  if (wait > 0) throw new Error(`방금 제보를 보냈어요. ${Math.ceil(wait / 1000)}초 뒤에 다시 보낼 수 있어요.`)
  const list = files.slice(0, BUG_MAX_FILES).map(bugFileInfo)
  lastSent = Date.now()
  try {
    await post(url, JSON.stringify(bugMessage(title, details, list.map((f) => f.name))))
    // 파일은 한 개씩 (여러 개를 한 번에 보내면 합친 크기 한도에 걸린다)
    for (const f of list) {
      const form = new FormData()
      form.append('payload_json', JSON.stringify({ username: 'MC CubePanel Bug Report', allowed_mentions: { parse: [] } }))
      form.append('files[0]', new Blob([new Uint8Array(fs.readFileSync(f.path))]), f.name)
      await post(url, form)
    }
  } catch (e) {
    lastSent = 0 // 못 보냈으면 1분 기다리지 않고 바로 다시 보낼 수 있게
    if (e instanceof Error && e.name === 'TimeoutError') throw new Error('제보를 보내는 데 너무 오래 걸려요. 인터넷 연결을 확인해 주세요.')
    if (e instanceof TypeError) throw new Error('제보를 보내지 못했어요. 인터넷 연결을 확인해 주세요.')
    throw e
  }
}
