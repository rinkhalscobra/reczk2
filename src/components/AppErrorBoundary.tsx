import { Component, type ReactNode } from 'react';
import { RouteStatus } from './RouteStatus';

export class AppErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error('Unable to render the workspace:', error);
  }

  render() {
    if (this.state.hasError) {
      return <RouteStatus error="This page could not load. Please try reloading it." onRetry={() => window.location.reload()} />;
    }
    return this.props.children;
  }
}
