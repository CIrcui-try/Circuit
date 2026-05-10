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

test("F6: save workflow, reload page, restore the last edited graph and input", async ({ page }) => {
  await openWorkspace(page);

  await addSkillByButton(page, "Implement Feature");
  await addSkillByButton(page, "boarding");
  await connectFirstTwoNodes(page);
  await page
    .getByTestId("workflow-node")
    .filter({ hasText: "Implement Feature" })
    .getByTestId("skill-node-input-edit")
    .click();
  await page
    .getByTestId("skill-node-input-prompt")
    .fill("Implement the persistence regression");
  await page
    .getByLabel("Close input editor")
    .click();
  await page
    .getByTestId("workflow-node")
    .filter({ hasText: "boarding" })
    .getByTestId("skill-node-input-edit")
    .click();
  await page
    .getByTestId("skill-node-input-issue")
    .fill("CIR-46");
  await page
    .getByTestId("skill-node-input-force")
    .check();
  await page
    .getByLabel("Close input editor")
    .click();

  await expect(page.getByTestId("workflow-node")).toHaveCount(2);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);

  // Capture node ids and positions before save so we can compare after reload.
  const before = await page.evaluate(() => {
    const w = window as unknown as {
      __WORKFLOW_STORE__: {
        getState: () => {
          nodes: Array<{
            id: string;
            position: { x: number; y: number };
            data: { input?: Record<string, unknown> };
          }>;
          edges: Array<{ id: string; source: string; target: string }>;
        };
      };
    };
    const s = w.__WORKFLOW_STORE__.getState();
    return {
      nodeIds: s.nodes.map((n) => n.id),
      positions: s.nodes.map((n) => ({ x: n.position.x, y: n.position.y })),
      inputs: s.nodes.map((n) => n.data.input),
      edges: s.edges.map((e) => ({ source: e.source, target: e.target })),
    };
  });

  // Set a recognizable workflow name and save.
  const nameInput = page.getByTestId("workflow-name-input");
  await nameInput.fill("Persisted flow");
  await page.getByTestId("workflow-save").click();

  await expect(page.getByTestId("workflow-save-status")).toContainText(/Saved/i);

  // Reload — the local draft should restore the last edited workflow immediately.
  await page.reload();

  await expect(page.getByTestId("workspace-root")).toBeVisible();
  await expect(page.getByTestId("workflow-node")).toHaveCount(2);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await expect(nameInput).toHaveValue("Persisted flow");
  await expect(page.getByText("CIR-46 --force")).toBeVisible();

  // The saved entry should now appear in the workflow menu.
  const menu = page.getByTestId("workflow-menu");
  await expect(menu.locator("option", { hasText: "Persisted flow" })).toHaveCount(1);

  const after = await page.evaluate(() => {
    const w = window as unknown as {
      __WORKFLOW_STORE__: {
        getState: () => {
          nodes: Array<{
            id: string;
            position: { x: number; y: number };
            data: { input?: Record<string, unknown> };
          }>;
          edges: Array<{ id: string; source: string; target: string }>;
        };
      };
    };
    const s = w.__WORKFLOW_STORE__.getState();
    return {
      nodeIds: s.nodes.map((n) => n.id),
      positions: s.nodes.map((n) => ({ x: n.position.x, y: n.position.y })),
      inputs: s.nodes.map((n) => n.data.input),
      edges: s.edges.map((e) => ({ source: e.source, target: e.target })),
    };
  });

  expect(after.nodeIds.sort()).toEqual(before.nodeIds.sort());
  expect(after.positions).toEqual(before.positions);
  expect(after.inputs).toEqual(before.inputs);
  expect(after.edges).toEqual(before.edges);

  await page.getByTestId("workflow-start").click();
  await expect(page.locator('[data-testid="workflow-node"][data-run-state="success"]')).toHaveCount(2);
  const prompts = await page.evaluate(() => {
    const w = window as unknown as {
      __CIRCUIT_RUNTIME_SPAWN_CALLS__: Array<{ args?: string[] }>;
    };
    return w.__CIRCUIT_RUNTIME_SPAWN_CALLS__
      .map((call) => call.args?.join("\n") ?? "")
      .filter((value) => value.includes("# Input"));
  });
  expect(prompts.join("\n")).toContain('"arguments": "CIR-46 --force"');
  expect(prompts.join("\n")).toContain('"prompt": "Implement the persistence regression"');
});
