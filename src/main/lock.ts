// 서버마다 오래 걸리는 작업(버전 바꾸기, 백업 되돌리기 등)을 한 번에 하나만 하게 막는다.
// 작업 중에는 서버를 켤 수도 없다 (파일을 바꿔 끼우는 도중에 켜지면 서버가 망가진다).
const locks = new Map<string, string>() // 서버 폴더 -> 하고 있는 작업 이름

export const lockedBy = (folderPath: string): string | undefined => locks.get(folderPath)

export function assertFree(folderPath: string): void {
  const busy = locks.get(folderPath)
  if (busy) throw new Error(`지금 ${busy} 중이에요. 끝난 다음에 다시 해 주세요.`)
}

// 작업이 끝날 때마다 부른다 (창을 닫은 뒤 작업만 남아 있었으면 앱을 끝내려고)
let onIdle: (() => void) | null = null
export const setOnJobDone = (fn: () => void): void => {
  onIdle = fn
}

export async function withLock<T>(folderPath: string, label: string, work: () => Promise<T>): Promise<T> {
  assertFree(folderPath)
  locks.set(folderPath, label)
  try {
    return await work()
  } finally {
    locks.delete(folderPath)
    onIdle?.()
  }
}

// 지금 하고 있는 작업 이름들 (앱을 닫을 때 확인한다)
export const busyJobs = (): string[] => [...locks.values()]
