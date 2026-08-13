import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <main className="app-shell">
          <section className="panel">
            <p className="eyebrow">EzProctor Exam</p>
            <h1>Teacher Dashboard Error</h1>
            <p className="subcopy">
              The dashboard hit a frontend error instead of rendering the management view.
            </p>
            <pre className="error-box">{String(this.state.error?.stack || this.state.error?.message || this.state.error)}</pre>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>
);
