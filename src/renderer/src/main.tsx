import './styles.css'
import { createRoot } from 'react-dom/client'
import App from './App'
import ErrorBoundary from './ErrorBoundary'

// 놓는 곳이 아닌 데에 파일을 떨어뜨리면 브라우저처럼 그 파일을 열어 버리므로 막는다
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => e.preventDefault())

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)
