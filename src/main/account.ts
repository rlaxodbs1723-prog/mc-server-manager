// 로그인 (서버 공유를 쓰려면 필요). 규칙은 share/auth.mjs.
// 브라우저로 Discord·Google 로그인 화면을 열고, 로그인이 끝나면 브라우저가 내 컴퓨터(127.0.0.1)의 이 앱으로 돌아온다.
// 세션 토큰은 userData/account.json에 윈도우 암호화(safeStorage)로 저장한다. 비밀번호는 받지 않는다
import { app, BrowserWindow, safeStorage, shell } from 'electron'
import crypto from 'crypto'
import fs from 'fs'
import http from 'http'
import path from 'path'
import type { Account, ServerEvent } from '../shared-types'

// 중계 주소: 서버 공유와 같은 곳 (MCSM_SHARE_RELAY=ws://localhost:8788 이면 시험용 중계)
const BASE = (): string => (process.env.MCSM_SHARE_RELAY ?? 'wss://cubepanel.kr').replace(/^ws/, 'http')
const file = (): string => path.join(app.getPath('userData'), 'account.json')
const LOGIN_MS = 5 * 60_000

let token = ''
let account: Account | null = null
let loaded = false
let pendingLogin: { cancel: () => void } | null = null
const listeners: (() => void)[] = []

function load(): void {
  if (loaded) return
  loaded = true
  try {
    const saved = JSON.parse(fs.readFileSync(file(), 'utf8'))
    const raw = Buffer.from(String(saved.token ?? ''), 'base64')
    token = saved.enc ? safeStorage.decryptString(raw) : raw.toString('utf8')
    account = saved.account ?? null
    if (!/^[0-9a-f]{64}$/.test(token) || !account) [token, account] = ['', null]
  } catch {
    // 로그인한 적 없음 (또는 다른 컴퓨터에서 옮겨 와서 풀 수 없음)
  }
}

function save(): void {
  if (!token || !account) {
    fs.rmSync(file(), { force: true })
    return
  }
  const enc = safeStorage.isEncryptionAvailable()
  const raw = enc ? safeStorage.encryptString(token) : Buffer.from(token, 'utf8')
  fs.writeFileSync(file(), JSON.stringify({ enc, token: raw.toString('base64'), account }, null, 2))
}

function changed(): void {
  save()
  BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('serverEvent', { type: 'account', folderPath: '' } satisfies ServerEvent))
  for (const fn of listeners) fn()
}

// 서버 공유가 로그인·로그아웃할 때 다시 붙으려고 듣는다
export function onAccountChange(fn: () => void): void {
  listeners.push(fn)
}

export function sessionToken(): string {
  load()
  return token
}

export function getAccount(): Account | null {
  load()
  return account
}

// 앱을 켤 때: 저장된 로그인이 아직 살아 있는지 확인하고 이름을 새로 받는다 (인터넷이 없으면 그대로 둔다)
export async function refreshAccount(): Promise<void> {
  load()
  if (!token) return
  try {
    const res = await fetch(`${BASE()}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) })
    if (res.status === 401) {
      ;[token, account] = ['', null]
      return changed()
    }
    if (!res.ok) return
    const me = (await res.json()).account as Account
    if (me && (me.name !== account?.name || me.id !== account?.id || (me.avatar ?? '') !== (account?.avatar ?? ''))) {
      account = me
      changed()
    }
  } catch {
    // 인터넷 없음: 다음에 확인
  }
}

export async function loginProviders(): Promise<string[]> {
  try {
    const res = await fetch(`${BASE()}/api/auth/providers`, { signal: AbortSignal.timeout(10_000) })
    return res.ok ? ((await res.json()).providers ?? []) : []
  } catch {
    throw new Error('로그인 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.')
  }
}

// 브라우저로 로그인한다. 끝나면(또는 취소·5분 지남) 돌아온다
export async function login(provider: string): Promise<Account> {
  if (!/^[a-z]{2,20}$/.test(provider)) throw new Error('잘못된 로그인 방식이에요.')
  pendingLogin?.cancel()
  const verifier = crypto.randomBytes(32).toString('hex')
  const challenge = crypto.createHash('sha256').update(verifier).digest('hex')

  // 브라우저가 돌아올 곳: 127.0.0.1의 빈 포트 (밖에서는 들어올 수 없다)
  let finish: (r: { c?: string; error?: string }) => void = () => undefined
  const result = new Promise<{ c?: string; error?: string }>((resolve) => (finish = resolve))
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== '/cb') return void res.writeHead(404).end()
    const c = url.searchParams.get('c') ?? undefined
    const error = url.searchParams.get('error') ?? undefined
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(donePage(c && !error ? '로그인됐어요' : '로그인하지 못했어요', c && !error ? '이 창을 닫고 MC CubePanel로 돌아가세요.' : '앱에서 다시 시도해 주세요.'))
    finish({ c, error })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const port = (server.address() as { port: number }).port
  const timer = setTimeout(() => finish({ error: 'timeout' }), LOGIN_MS)
  pendingLogin = { cancel: () => finish({ error: 'cancel' }) }
  try {
    await shell.openExternal(`${BASE()}/api/auth/${provider}/start?port=${port}&challenge=${challenge}`)
    const r = await result
    if (r.error === 'cancel') throw new Error('로그인을 취소했어요.')
    if (r.error === 'timeout') throw new Error('로그인 시간이 지났어요. 다시 눌러 주세요.')
    if (!r.c) throw new Error('로그인하지 못했어요. 다시 시도해 주세요.')
    const res = await fetch(`${BASE()}/api/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ c: r.c, verifier }),
      signal: AbortSignal.timeout(15_000)
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || !body.token) throw new Error('로그인하지 못했어요. 다시 시도해 주세요.')
    token = String(body.token)
    account = body.account as Account
    changed()
    focusApp()
    return account
  } finally {
    clearTimeout(timer)
    server.close()
    pendingLogin = null
  }
}

export function cancelLogin(): void {
  pendingLogin?.cancel()
}

export async function logout(): Promise<void> {
  load()
  const t = token
  ;[token, account] = ['', null]
  changed()
  if (t) await fetch(`${BASE()}/api/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(10_000) }).catch(() => undefined)
}

// 계정 지우기: 중계에 저장된 계정과 모든 기기의 로그인을 지운다
export async function deleteAccount(): Promise<void> {
  load()
  if (!token) return
  const res = await fetch(`${BASE()}/api/auth/delete`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) }).catch(() => null)
  if (!res || (!res.ok && res.status !== 401)) throw new Error('계정을 지우지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.')
  ;[token, account] = ['', null]
  changed()
}

// 로그인이 끝나면 브라우저에서 앱으로 돌아온다
function focusApp(): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

const donePage = (title: string, body: string): string =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MC CubePanel</title><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#101013;color:#f2f3f5;font-family:system-ui,'Malgun Gothic',sans-serif;text-align:center"><div><h2 style="margin:0 0 8px">${title}</h2><p style="color:#b0b6c0;margin:0">${body}</p></div></body>`
