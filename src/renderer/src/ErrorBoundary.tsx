import { Component, type ReactNode } from 'react'

// 화면 어딘가에서 오류가 나도 앱 전체가 까맣게 되지 않게 막고, 다시 불러오기 버튼을 보여 준다
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('화면 오류:', error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="fatal">
        <div className="fatal-card">
          <h2>화면에 문제가 생겼어요</h2>
          <p className="body">서버는 그대로 돌아가고 있어요. 다시 불러오면 대부분 해결돼요.</p>
          <pre className="crash-excerpt">{String(this.state.error?.message ?? this.state.error)}</pre>
          <button className="btn primary block" onClick={() => location.reload()}>
            다시 불러오기
          </button>
        </div>
      </div>
    )
  }
}
