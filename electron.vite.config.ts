import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { encodeCfKey, readCfKey } from './build-tools/cfkey.mjs'

// CurseForge 키는 섞어서 넣는다 (src/main/curseforge.ts에서 푼다)
const cfKey = encodeCfKey(readCfKey(__dirname))

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], define: { __CF_KEY_ENC__: JSON.stringify(cfKey) } },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { plugins: [react()] }
})
