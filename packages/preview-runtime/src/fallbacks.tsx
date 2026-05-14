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
