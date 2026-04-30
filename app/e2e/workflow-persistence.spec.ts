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
}

async function addSkillByButton(page: Page, skillName: string | RegExp) {
  const item = page
    .getByTestId("skill-list__item")
    .filter({ hasText: skillName });
  await item.getByRole("button", { name: /Add .+ to canvas/i }).click();
}

async function connectFirstTwoNodes(page: Page) {
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
}

test("F6: save workflow, reload page, restore graph from disk", async ({ page }) => {
  await openWorkspace(page);

  await addSkillByButton(page, "Implement Feature");
  await addSkillByButton(page, "Review Code");
  await connectFirstTwoNodes(page);

  await expect(page.getByTestId("workflow-node")).toHaveCount(2);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);

  // Capture node ids and positions before save so we can compare after reload.
  const before = await page.evaluate(() => {
    const w = window as unknown as {
      __WORKFLOW_STORE__: {
        getState: () => {
          nodes: Array<{ id: string; position: { x: number; y: number } }>;
          edges: Array<{ id: string; source: string; target: string }>;
        };
      };
    };
    const s = w.__WORKFLOW_STORE__.getState();
    return {
      nodeIds: s.nodes.map((n) => n.id),
      positions: s.nodes.map((n) => ({ x: n.position.x, y: n.position.y })),
      edges: s.edges.map((e) => ({ source: e.source, target: e.target })),
    };
  });

  // Set a recognizable workflow name and save.
  const nameInput = page.getByTestId("workflow-name-input");
  await nameInput.fill("Persisted flow");
  await page.getByTestId("workflow-save").click();

  await expect(page.getByTestId("workflow-save-status")).toContainText(/Saved/i);

  // Reload — canvas resets, but the JSON survives in the mock bridge's localStorage.
  await page.reload();

  await expect(page.getByTestId("workspace-root")).toBeVisible();
  // Drop into the workspace fresh — no nodes yet.
  await expect(page.getByTestId("workflow-node")).toHaveCount(0);

  // The saved entry should now appear in the workflow menu.
  const menu = page.getByTestId("workflow-menu");
  await expect(menu.locator("option", { hasText: "Persisted flow" })).toHaveCount(1);

  await menu.selectOption({ label: "Persisted flow" });

  await expect(page.getByTestId("workflow-node")).toHaveCount(2);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await expect(nameInput).toHaveValue("Persisted flow");

  const after = await page.evaluate(() => {
    const w = window as unknown as {
      __WORKFLOW_STORE__: {
        getState: () => {
          nodes: Array<{ id: string; position: { x: number; y: number } }>;
          edges: Array<{ id: string; source: string; target: string }>;
        };
      };
    };
    const s = w.__WORKFLOW_STORE__.getState();
    return {
      nodeIds: s.nodes.map((n) => n.id),
      positions: s.nodes.map((n) => ({ x: n.position.x, y: n.position.y })),
      edges: s.edges.map((e) => ({ source: e.source, target: e.target })),
    };
  });

  expect(after.nodeIds.sort()).toEqual(before.nodeIds.sort());
  expect(after.positions).toEqual(before.positions);
  expect(after.edges).toEqual(before.edges);
});
