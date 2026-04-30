import { useWorkflowStore } from "../../stores/workflowStore";

export function PropertiesPanel() {
  const selectedNode = useWorkflowStore((s) =>
    s.selectedNodeId
      ? s.nodes.find((n) => n.id === s.selectedNodeId) ?? null
      : null,
  );

  return (
    <aside className="workspace__props" data-testid="node-properties-panel">
      <div className="panel-header">Properties</div>
      {!selectedNode ? (
        <div className="empty-state">Select a node or edge to inspect.</div>
      ) : (
        <dl className="properties">
          <dt>Label</dt>
          <dd>{selectedNode.data.label}</dd>
          <dt>Provider</dt>
          <dd>{selectedNode.data.skillRef.provider}</dd>
          <dt>Skill File</dt>
          <dd>
            <code>{selectedNode.data.skillRef.skillFile}</code>
          </dd>
        </dl>
      )}
    </aside>
  );
}
