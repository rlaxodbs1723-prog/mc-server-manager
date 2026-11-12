import { Component, type ErrorInfo, type ReactNode } from 'react'

// 화면 어딘가에서 오류가 나도 앱 전체가 까맣게 되지 않게 막고, 다시 불러오기 버튼을 보여 준다
// 어느 화면 조각에서 났는지(컴포넌트 이름 몇 개)도 같이 보여 준다. 제보 스크린샷만 보고 원인을 찾을 수 있게
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null; where: string }> {
  state = { error: null as Error | null, where: '' }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('화면 오류:', error, info.componentStack)
    const names = [...String(info.componentStack ?? '').matchAll(/at (\w+)/g)].map((m) => m[1]).filter((n) => /^[A-Z]/.test(n))
    this.setState({ where: [...new Set(names)].slice(0, 4).join(' < ') })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="fatal">
        <div className="fatal-card">
          <h2>화면에 문제가 생겼어요</h2>
          <p className="body">서버는 그대로 돌아가고 있어요. 다시 불러오면 대부분 해결돼요.</p>
          <pre className="crash-excerpt">
            {String(this.state.error?.message ?? this.state.error)}
            {this.state.where && `\n@ ${this.state.where}`}
          </pre>
          <button className="btn primary block" onClick={() => location.reload()}>
            다시 불러오기
          </button>
        </div>
      </div>
    )
  }
}
