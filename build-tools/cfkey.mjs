// CurseForge 키를 빌드에 넣을 때 그대로 넣지 않고 섞어서 넣는다 (exe를 열어 봐도 키 모양으로 바로 보이지 않게).
// 완전히 숨길 수는 없다 (앱이 쓰려면 풀어야 하므로). 쉽게 긁어 가지 못하게 하는 정도다.
// 푸는 쪽: src/main/curseforge.ts의 builtKey (MASK가 같아야 한다)
import fs from 'fs'
import path from 'path'

const MASK = 'mc-server-manager/cf'

// .env의 값 하나 (\$는 글자 $, 앞에 MAIN_VITE_가 붙어 있어도 된다)
export function readEnv(root, name) {
  try {
    const line = fs
      .readFileSync(path.join(root, '.env'), 'utf8')
      .split(/\r?\n/)
      .find((l) => new RegExp(`^(MAIN_VITE_)?${name}=`).test(l))
    return line?.slice(line.indexOf('=') + 1).trim().split('\\$').join('$') || ''
  } catch {
    return ''
  }
}

// .env의 CURSEFORGE_KEY
export const readCfKey = (root) => readEnv(root, 'CURSEFORGE_KEY')
// .env의 BUG_WEBHOOK (버그 제보를 받는 디스코드 웹훅 주소). 섞는 방법은 CurseForge 키와 같다
export const readBugHook = (root) => readEnv(root, 'BUG_WEBHOOK')

export const encodeCfKey = (key) =>
  key ? Buffer.from([...Buffer.from(key, 'utf8')].map((b, i) => b ^ MASK.charCodeAt(i % MASK.length))).reverse().toString('base64') : ''
