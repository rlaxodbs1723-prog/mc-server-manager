// 테스트용 가짜 electron. 앱 데이터는 TEST_HOME(테스트 전용 폴더)에만 쓴다
const fs = require('fs')
const path = require('path')
const home = process.env.TEST_HOME
if (!home) throw new Error('TEST_HOME이 없어요')
const noop = () => undefined
module.exports = {
  // 바탕화면 등 모든 경로도 테스트 폴더로
  app: { getPath: () => home, isPackaged: false, getVersion: () => '0.0.0-test', on: noop, getLocale: () => 'ko', setLoginItemSettings: noop },
  shell: {
    trashItem: async (p) => fs.rmSync(p, { recursive: true, force: true }), // 테스트 폴더 안에서만 불린다
    openPath: async () => '',
    openExternal: async () => undefined,
    showItemInFolder: noop
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    // 저장 창: 고른 것처럼 테스트 폴더의 out 안에 저장한다
    showSaveDialog: async (a, b) => {
      const o = b ?? a
      fs.mkdirSync(path.join(home, 'out'), { recursive: true })
      return { canceled: false, filePath: path.join(home, 'out', path.basename(o.defaultPath)) }
    }
  },
  BrowserWindow: class { static getAllWindows() { return [] } },
  Notification: class { static isSupported() { return false } show() {} },
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }) }
}
