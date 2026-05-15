import * as React from "react";
import { COMPONENT_MAP } from "./component-map.ts";
import { UnknownComponentFallback } from "./fallbacks.tsx";
import type { PrototypeNode } from "../../../shared/types.ts";

export interface RenderProps {
  node: PrototypeNode | null;
  /** Click handler — invoked with the clicked node id so the chat can ask the
   *  explainer about it. Tracked at the wrapping span layer; lets atoms keep
   *  rendering as <button>/<input> without re-routing their onClick. */
  onNodeClick?: (nodeId: string, component: string) => void;
  /** Currently focused node — highlighted via outline. */
  focusedNodeId?: string | null;
}

export function PrototypeRender({ node, onNodeClick, focusedNodeId }: RenderProps): React.ReactElement | null {
  if (!node) return null;
  return <RenderNode node={node} onNodeClick={onNodeClick} focusedNodeId={focusedNodeId ?? null} />;
}

function RenderNode({
  node,
  onNodeClick,
  focusedNodeId,
}: {
  node: PrototypeNode;
  onNodeClick?: (nodeId: string, component: string) => void;
  focusedNodeId: string | null;
}): React.ReactElement {
  const Comp = COMPONENT_MAP[node.component];
  if (!Comp) return <UnknownComponentFallback id={node.component} />;

  // Build props with rendered children/slots.
  const componentProps: Record<string, unknown> = { ...node.props };
  const flatChildren =
    node.children?.map((c) => <RenderNode key={c.nodeId} node={c} onNodeClick={onNodeClick} focusedNodeId={focusedNodeId} />) ?? null;

  if (node.slots) {
    for (const [slotName, slotNodes] of Object.entries(node.slots)) {
      componentProps[slotName] = (
        <>
          {slotNodes.map((c) => (
            <RenderNode key={c.nodeId} node={c} onNodeClick={onNodeClick} focusedNodeId={focusedNodeId} />
          ))}
        </>
      );
    }
  }

  const rendered = (
    <Comp {...componentProps}>{flatChildren}</Comp>
  );

  return (
    <span
      data-node-id={node.nodeId}
      data-component={node.component}
      onClick={(e) => {
        e.stopPropagation();
        onNodeClick?.(node.nodeId, node.component);
      }}
      style={{
        display: "contents",
        outline: focusedNodeId === node.nodeId ? "2px solid var(--color-brand-primary, #ffdd2d)" : undefined,
      }}
    >
      {rendered}
    </span>
  );
}
