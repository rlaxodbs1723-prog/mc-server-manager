import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// CurseForge 키와 버그 제보 웹훅은 앱에 넣지 않는다 (사이트의 중계 서버가 Netlify 환경 변수로 갖고 있다: netlify/functions)
export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { plugins: [react()] }
})
