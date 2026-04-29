import { Background, Controls, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

export function Canvas() {
  return (
    <section className="workspace__canvas">
      <ReactFlow nodes={[]} edges={[]} colorMode="dark" fitView>
        <Background gap={16} />
        <Controls />
      </ReactFlow>
    </section>
  );
}
