// 서버 만들기 취소: 작업마다 취소 표시를 두고, 그 작업 안에서 도는 다운로드·설치 프로그램이 알아서 멈추게 한다.
// AsyncLocalStorage로 "지금 어느 작업 안에서 도는지"를 넘겨서, 다운로드 함수 등에 인자를 따로 넘기지 않아도 된다.
import { AsyncLocalStorage } from 'async_hooks'
import type { ChildProcess } from 'child_process'

export class CancelledError extends Error {
  constructor() {
    super('설치를 취소했어요.')
  }
}

interface Token {
  cancelled: boolean
  controllers: Set<AbortController>
  procs: Set<ChildProcess>
}

const als = new AsyncLocalStorage<Token>()
const tokens = new Map<string, Token>()

export function runCancellable<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const token: Token = { cancelled: false, controllers: new Set(), procs: new Set() }
  tokens.set(id, token)
  return als.run(token, fn).finally(() => tokens.delete(id))
}

export function cancelTask(id: string): void {
  const t = tokens.get(id)
  if (!t) return
  t.cancelled = true
  t.controllers.forEach((c) => c.abort())
  t.procs.forEach((p) => p.kill())
}

export const isCancelled = (): boolean => als.getStore()?.cancelled ?? false

export function throwIfCancelled(): void {
  if (isCancelled()) throw new CancelledError()
}

// 다운로드의 AbortController / 설치 프로그램을 지금 작업에 묶는다. 돌려준 함수로 풀어 준다
export function watchAbort(ctrl: AbortController): () => void {
  const t = als.getStore()
  if (!t) return () => {}
  if (t.cancelled) ctrl.abort()
  t.controllers.add(ctrl)
  return () => t.controllers.delete(ctrl)
}

export function watchProcess(proc: ChildProcess): void {
  const t = als.getStore()
  if (!t) return
  if (t.cancelled) proc.kill()
  t.procs.add(proc)
  proc.on('close', () => t.procs.delete(proc))
}
