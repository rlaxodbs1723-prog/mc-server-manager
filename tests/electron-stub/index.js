// 테스트용 가짜 electron. 앱 데이터는 TEST_HOME(테스트 전용 폴더)에만 쓴다
const fs = require('fs')
const home = process.env.TEST_HOME
if (!home) throw new Error('TEST_HOME이 없어요')
const noop = () => undefined
module.exports = {
  app: { getPath: () => home, isPackaged: false, getVersion: () => '0.0.0-test', on: noop, getLocale: () => 'ko' },
  shell: {
    trashItem: async (p) => fs.rmSync(p, { recursive: true, force: true }), // 테스트 폴더 안에서만 불린다
    openPath: async () => '',
    openExternal: async () => undefined,
    showItemInFolder: noop
  },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true }) },
  BrowserWindow: class { static getAllWindows() { return [] } },
  Notification: class { static isSupported() { return false } show() {} },
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }) }
}
