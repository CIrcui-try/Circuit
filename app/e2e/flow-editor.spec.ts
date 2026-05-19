import { expect, test, type Page } from "@playwright/test";
import { installMockBridge } from "./fixtures/installBridge";

test.beforeEach(async ({ page }) => {
  await installMockBridge(page);
});

async function openWorkspace(page: Page) {
  await page.goto("/");
  await page.getByTestId("add-repository-button").click();
  await page.getByRole("link", { name: /sample-repo/ }).click();
  await expect(page.getByTestId("workspace-root")).toBeVisible();
  await expect(page.getByTestId("workflow-canvas")).toBeVisible();
  await expect(page.getByTestId("skill-list")).toBeVisible();
}

async function addSkillByButton(page: Page, skillName: string | RegExp) {
  const item = page
    .getByTestId("skill-list__item")
    .filter({ hasText: skillName });
  await item.getByRole("button", { name: /Add .+ to canvas/i }).click();
}

test("F1: clicking the + button adds a skill node to the canvas", async ({ page }) => {
  await openWorkspace(page);

  await addSkillByButton(page, "Implement Feature");

  const node = page.getByTestId("workflow-node");
  await expect(node).toHaveCount(1);
  await expect(node).toContainText("Implement Feature");
  await expect(node).toContainText("claude");
});

test("F2: clicking a node populates the properties panel with skillRef", async ({ page }) => {
  await openWorkspace(page);
  await addSkillByButton(page, "Implement Feature");

  const node = page.getByTestId("workflow-node");
  await node.click();

  const panel = page.getByTestId("node-properties-panel");
  await expect(panel).toContainText("Implement Feature");
  await expect(panel).toContainText("claude");
  await expect(panel).toContainText(".claude/skills/implement-feature/SKILL.md");
});

test("F3: connecting two nodes via store creates one edge", async ({ page }) => {
  await openWorkspace(page);
  await addSkillByButton(page, "Implement Feature");
  await addSkillByButton(page, "Review Code");

  await expect(page.getByTestId("workflow-node")).toHaveCount(2);

  // Drive onConnect via the store directly. Real handle-to-handle dragging in
  // React Flow is timing-fragile under headless Chromium and depends on pane
  // dimensions; the store is the single source of truth for edges, so this
  // exercises the real production path.
  await page.evaluate(() => {
    const w = window as unknown as {
      __WORKFLOW_STORE__?: {
        getState: () => {
          nodes: Array<{ id: string }>;
          onConnect: (c: {
            source: string;
            target: string;
            sourceHandle: string | null;
            targetHandle: string | null;
          }) => void;
        };
      };
    };
    const store = w.__WORKFLOW_STORE__;
    if (!store) throw new Error("workflow store not exposed on window");
    const state = store.getState();
    const [a, b] = state.nodes;
    state.onConnect({
      source: a.id,
      target: b.id,
      sourceHandle: null,
      targetHandle: null,
    });
  });

  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
});

test("F5: dragging a sidebar skill onto the canvas creates a node", async ({ page }) => {
  await openWorkspace(page);

  const sourceItem = page
    .getByTestId("skill-list__item")
    .filter({ hasText: "Implement Feature" });
  const target = page.getByTestId("workflow-canvas");

  // Real HTML5 drag-and-drop with a shared DataTransfer so payload survives
  // (Playwright's high-level dragTo does NOT carry dataTransfer through).
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await sourceItem.dispatchEvent("dragstart", { dataTransfer });
  await target.dispatchEvent("dragenter", { dataTransfer });
  await target.dispatchEvent("dragover", { dataTransfer });
  await target.dispatchEvent("drop", { dataTransfer });

  const node = page.getByTestId("workflow-node");
  await expect(node).toHaveCount(1);
  await expect(node).toContainText("Implement Feature");
  await expect(node).toContainText("claude");
});

test("F4: selecting a node and pressing Backspace deletes node and incident edges", async ({ page }) => {
  await openWorkspace(page);
  await addSkillByButton(page, "Implement Feature");
  await addSkillByButton(page, "Review Code");

  // Wire an edge first so we can observe it gets removed too.
  await page.evaluate(() => {
    const w = window as unknown as {
      __WORKFLOW_STORE__?: {
        getState: () => {
          nodes: Array<{ id: string }>;
          onConnect: (c: {
            source: string;
            target: string;
            sourceHandle: string | null;
            targetHandle: string | null;
          }) => void;
        };
      };
    };
    const state = w.__WORKFLOW_STORE__!.getState();
    const [a, b] = state.nodes;
    state.onConnect({
      source: a.id,
      target: b.id,
      sourceHandle: null,
      targetHandle: null,
    });
  });

  await expect(page.locator(".react-flow__edge")).toHaveCount(1);

  const firstNode = page.getByTestId("workflow-node").first();
  await firstNode.click();
  await expect(page.getByTestId("node-properties-panel")).toContainText("Implement Feature");

  await page.keyboard.press("Backspace");

  await expect(page.getByTestId("workflow-node")).toHaveCount(1);
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  await expect(page.getByTestId("node-properties-panel")).toContainText(/Select a node or edge/i);
});

test("F6: dragging a canvas node onto the trash dropzone deletes it", async ({ page }) => {
  await openWorkspace(page);
  await addSkillByButton(page, "Implement Feature");

  const node = page.getByTestId("workflow-node");
  await expect(node).toHaveCount(1);

  const nodeBox = await node.boundingBox();
  if (!nodeBox) throw new Error("workflow node has no bounding box");

  await page.mouse.move(
    nodeBox.x + nodeBox.width / 2,
    nodeBox.y + nodeBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    nodeBox.x + nodeBox.width / 2,
    nodeBox.y + nodeBox.height / 2 + 24,
    { steps: 6 },
  );

  const trash = page.getByTestId("canvas-trash-dropzone");
  await expect(trash).toHaveAttribute("data-active", "true");

  const trashBox = await trash.boundingBox();
  if (!trashBox) throw new Error("trash dropzone has no bounding box");

  await page.mouse.move(
    trashBox.x + trashBox.width / 2,
    trashBox.y + trashBox.height / 2,
    { steps: 12 },
  );
  await expect(trash).toHaveAttribute("data-over", "true");
  await page.mouse.up();

  await expect(page.getByTestId("workflow-node")).toHaveCount(0);
  await expect(page.getByTestId("node-properties-panel")).toContainText(/Select a node or edge/i);
});

test("F7: canvas zoom caps at native scale to keep node text crisp", async ({ page }) => {
  await openWorkspace(page);
  await addSkillByButton(page, "Implement Feature");

  const node = page.getByTestId("workflow-node");
  await node.getByTestId("skill-node-input-edit").click();
  const popover = page.getByTestId("skill-node-input-popover");
  await expect(popover).toBeVisible();

  const popoverBefore = await popover.boundingBox();
  const nodeBefore = await node.boundingBox();
  if (!popoverBefore || !nodeBefore) {
    throw new Error("node or input popover has no bounding box before zoom");
  }

  await expect(page.locator(".react-flow__controls-zoomin")).toBeDisabled();

  const popoverAfter = await popover.boundingBox();
  const nodeAfter = await node.boundingBox();
  if (!popoverAfter || !nodeAfter) {
    throw new Error("node or input popover has no bounding box after zoom");
  }

  expect(Math.abs(nodeAfter.width - nodeBefore.width)).toBeLessThan(2);
  expect(Math.abs(nodeAfter.height - nodeBefore.height)).toBeLessThan(2);
  expect(Math.abs(popoverAfter.width - popoverBefore.width)).toBeLessThan(2);
  expect(Math.abs(popoverAfter.height - popoverBefore.height)).toBeLessThan(2);
});

test("F8: Auto layout restores a readable branch layout", async ({ page }) => {
  await openWorkspace(page);

  await page.evaluate(() => {
    const w = window as unknown as {
      __WORKFLOW_STORE__?: {
        getState: () => {
          replaceCanvas: (args: {
            nodes: Array<{
              id: string;
              type: "skill";
              position: { x: number; y: number };
              data: {
                label: string;
                skillRef: {
                  provider: "claude" | "codex";
                  skillFile: string;
                };
              };
            }>;
            edges: Array<{ id: string; source: string; target: string }>;
            workflowId: string | null;
            workflowName: string;
          }) => void;
        };
      };
    };
    const state = w.__WORKFLOW_STORE__!.getState();
    state.replaceCanvas({
      nodes: [
        {
          id: "root",
          type: "skill",
          position: { x: 900, y: 900 },
          data: {
            label: "Root",
            skillRef: {
              provider: "codex",
              skillFile: ".codex/skills/root/SKILL.md",
            },
          },
        },
        {
          id: "main",
          type: "skill",
          position: { x: -400, y: 200 },
          data: {
            label: "Main",
            skillRef: {
              provider: "claude",
              skillFile: ".claude/skills/main/SKILL.md",
            },
          },
        },
        {
          id: "side",
          type: "skill",
          position: { x: 40, y: -300 },
          data: {
            label: "Side",
            skillRef: {
              provider: "codex",
              skillFile: ".codex/skills/side/SKILL.md",
            },
          },
        },
      ],
      edges: [
        { id: "e-root-main", source: "root", target: "main" },
        { id: "e-root-side", source: "root", target: "side" },
      ],
      workflowId: null,
      workflowName: "Branch flow",
    });
  });

  await expect(page.getByTestId("workflow-node")).toHaveCount(3);

  await page.getByTestId("workflow-auto-layout").click();
  const positions = await page.evaluate<Record<string, { x: number; y: number }>>(() => {
    const w = window as unknown as {
      __WORKFLOW_STORE__?: {
        getState: () => {
          nodes: Array<{ data: { label: string }; position: { x: number; y: number } }>;
        };
      };
    };
    return Object.fromEntries(
      w.__WORKFLOW_STORE__!.getState().nodes.map((node) => [
        node.data.label,
        node.position,
      ]),
    );
  });

  expect(positions.Root.y).toBeLessThan(positions.Main.y);
  expect(positions.Root.y).toBeLessThan(positions.Side.y);
  expect(Math.abs(positions.Main.x - positions.Side.x)).toBeGreaterThan(250);
});
