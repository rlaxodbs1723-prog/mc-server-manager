// 공유받은 서버(친구 앱): 화면이 서버 경로 대신 "remote:방번호"로 부르면 그 요청을 방장 앱으로 보낸다.
// 화면 코드를 그대로 쓰려고, 모든 ipcMain.handle을 감싸서 첫 인자가 remote:로 시작하는지만 본다.
// 방장 앱 쪽에서는 같은 기능을 이름으로 다시 찾아 실행해야 해서, 등록된 처리 함수를 이름별로 모아 둔다.
// index.ts에서 다른 처리 함수가 등록되기 전에 불러와야 한다 (그래서 이 파일은 다른 앱 모듈을 불러오지 않는다)
import { ipcMain, type IpcMainInvokeEvent } from 'electron'

export const REMOTE = 'remote:'
export const isRemote = (p: unknown): p is string => typeof p === 'string' && p.startsWith(REMOTE)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (event: IpcMainInvokeEvent, ...args: any[]) => unknown
const handlers = new Map<string, Handler>()
let forward: ((room: string, channel: string, args: unknown[]) => Promise<unknown>) | null = null

export const setRemoteForwarder = (fn: typeof forward): void => {
  forward = fn
}
// 방장 앱이 친구 요청을 실행할 때 쓴다 (이 앱에 등록된 같은 이름의 처리 함수)
export const localHandler = (channel: string): Handler | undefined => handlers.get(channel)

const original = ipcMain.handle.bind(ipcMain)
ipcMain.handle = ((channel: string, fn: Handler) => {
  handlers.set(channel, fn)
  original(channel, (event, ...args) => {
    if (isRemote(args[0])) {
      if (!forward) throw new Error('공유받은 서버에 연결할 수 없어요.')
      return forward(args[0].slice(REMOTE.length), channel, args.slice(1))
    }
    return fn(event, ...args)
  })
}) as typeof ipcMain.handle
