import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Last resort so a bug never leaves a blank white screen inside Telegram — that reads to the
 * person as "the app is broken", with no way to tell whether it's their connection, our server,
 * or a real crash. Reloading is a real fix here: it's a full remount, no state to lose.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false };

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled UI error", error, info.componentStack);
  }

  render() {
    if (!this.state.crashed) return this.props.children;
    return (
      <div className="screen">
        <div className="empty-state">
          <span className="emoji">😕</span>
          <p>Что-то пошло не так. Попробуйте перезапустить приложение.</p>
          <button className="btn btn-ribbon" style={{ marginTop: 14 }} onClick={() => location.reload()}>
            Обновить
          </button>
        </div>
      </div>
    );
  }
}
