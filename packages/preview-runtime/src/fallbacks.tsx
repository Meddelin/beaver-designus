import * as React from "react";

export function UnknownComponentFallback({ id }: { id: string }): React.ReactElement {
  return (
    <span
      data-bvr-fallback="unknown-component"
      style={{
        display: "inline-block",
        padding: "4px 8px",
        margin: "2px",
        background: "#fff3cd",
        border: "1px dashed #c98e00",
        borderRadius: "4px",
        color: "#5b4500",
        fontFamily: "ui-monospace, monospace",
        fontSize: "11px",
      }}
      title={`Component "${id}" is not in the current manifest. Drift between project and manifest_rev?`}
    >
      ⚠ unknown: {id}
    </span>
  );
}

/** Shown in place of a node whose component threw during render (e.g. a
 *  DS component dereferenced a prop the agent hasn't filled with a valid
 *  value yet). Keeps the rest of the canvas alive. */
export function RenderErrorFallback({
  component,
  message,
}: {
  component: string;
  message: string;
}): React.ReactElement {
  return (
    <span
      data-bvr-fallback="render-error"
      style={{
        display: "inline-block",
        padding: "4px 8px",
        margin: "2px",
        background: "#ffe1e1",
        border: "1px dashed #c92f2f",
        borderRadius: "4px",
        color: "#5b0000",
        fontFamily: "ui-monospace, monospace",
        fontSize: "11px",
        maxWidth: "320px",
        whiteSpace: "normal",
        verticalAlign: "top",
      }}
      title={message}
    >
      ⚠ {component} — render error: {message}
    </span>
  );
}

/** React error boundary, one instance per prototype node. A throw in any DS
 *  component is contained to that node instead of unmounting the whole
 *  preview tree (the "white screen of death"). `resetKey` (the node's
 *  serialized props) makes the boundary retry once the offending prop is
 *  corrected by the agent, so the canvas self-heals without a reload. */
export class RenderErrorBoundary extends React.Component<
  { component: string; resetKey: string; children: React.ReactNode },
  { error: Error | null; key: string }
> {
  constructor(props: { component: string; resetKey: string; children: React.ReactNode }) {
    super(props);
    this.state = { error: null, key: props.resetKey };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(
    props: { resetKey: string },
    state: { error: Error | null; key: string }
  ) {
    // Props changed (agent edited the node) → clear the error and re-attempt.
    if (props.resetKey !== state.key) return { error: null, key: props.resetKey };
    return null;
  }

  render() {
    if (this.state.error) {
      return (
        <RenderErrorFallback
          component={this.props.component}
          message={this.state.error.message || String(this.state.error)}
        />
      );
    }
    return this.props.children;
  }
}

export function ValidationErrorBadge({ message }: { message: string }): React.ReactElement {
  return (
    <span
      data-bvr-fallback="validation-error"
      style={{
        display: "inline-block",
        padding: "2px 6px",
        margin: "2px",
        background: "#ffe1e1",
        border: "1px dashed #c92f2f",
        borderRadius: "4px",
        color: "#5b0000",
        fontFamily: "ui-monospace, monospace",
        fontSize: "11px",
      }}
    >
      ✕ {message}
    </span>
  );
}
