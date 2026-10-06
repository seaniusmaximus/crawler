import { Component, type ReactNode } from 'react'

interface Props {
  /** Named in the console when it fails. */
  name: string
  /** When this changes, a failed piece gets another go. */
  resetKey?: unknown
  /** Tidy up after a failure, e.g. close the menu that failed. */
  onError?: () => void
  children: ReactNode
}

interface State {
  failed: boolean
  resetKey: unknown
}

/**
 * Keeps an error in one piece of the page from blanking all of it: that piece
 * disappears and the rest carries on. The error still goes to the console.
 */
export class Contained extends Component<Props, State> {
  state: State = { failed: false, resetKey: this.props.resetKey }

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey === state.resetKey ? null : { failed: false, resetKey: props.resetKey }
  }

  componentDidCatch(error: unknown): void {
    console.error(`[${this.props.name}] failed and was closed:`, error)
    this.props.onError?.()
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}
