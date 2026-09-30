import './styles.css'
import { createRoot } from 'react-dom/client'
import App from './App'
import ErrorBoundary from './ErrorBoundary'
import { startTranslating } from './i18n-dom'

// 놓는 곳이 아닌 데에 파일을 떨어뜨리면 브라우저처럼 그 파일을 열어 버리므로 막는다
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => e.preventDefault())

// 언어를 먼저 정한 뒤에 그린다 (한국어로 잠깐 보였다가 바뀌지 않게)
window.api
  .getAppInfo()
  .then((info) => startTranslating(info.settings.language))
  .catch(() => undefined)
  .finally(() =>
    createRoot(document.getElementById('root')!).render(
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    )
  )
