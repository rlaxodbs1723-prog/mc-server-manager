import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { encodeCfKey, readBugHook, readCfKey } from './build-tools/cfkey.mjs'

// CurseForge 키는 섞어서 넣는다 (src/main/curseforge.ts에서 푼다)
const cfKey = encodeCfKey(readCfKey(__dirname))
// 버그 제보 디스코드 웹훅도 같은 방법으로 (src/main/bugreport.ts에서 푼다)
const bugHook = encodeCfKey(readBugHook(__dirname))

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], define: { __CF_KEY_ENC__: JSON.stringify(cfKey), __BUG_HOOK_ENC__: JSON.stringify(bugHook) } },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { plugins: [react()] }
})
