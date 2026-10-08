// 버그 제보: GitHub 새 이슈 화면을 브라우저로 연다. 앱 버전·윈도우·언어는 알아서 채운다.
// (보내는 건 사용자가 GitHub에서 직접 누른다. 앱이 몰래 보내지 않는다)
import { app, shell } from 'electron'
import os from 'os'
import { getAppSettings } from './appsettings'

const REPO = 'https://github.com/rlaxodbs1723-prog/mc-server-manager'
const MAX_URL = 7000 // 너무 긴 주소는 브라우저·GitHub가 자른다

export function bugReportUrl(title: string, details: string): string {
  const t = String(title ?? '').trim().slice(0, 200)
  const d = String(details ?? '').trim()
  const env = [
    `- App: MC CubePanel ${app.getVersion()}`,
    `- Windows: ${os.release()} (${process.arch})`,
    `- Language: ${getAppSettings().language}`
  ].join('\n')
  const make = (text: string): string =>
    `${REPO}/issues/new?labels=bug&title=${encodeURIComponent(t || 'Bug report')}&body=${encodeURIComponent(`${text}\n\n---\n${env}`)}`
  let url = make(d)
  // 길면 설명 뒤쪽을 잘라 낸다
  for (let n = d.length; url.length > MAX_URL && n > 0; n -= 200) url = make(d.slice(0, n) + '\n…')
  return url
}

export function openBugReport(title: string, details: string): Promise<void> {
  return shell.openExternal(bugReportUrl(title, details))
}
