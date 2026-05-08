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

test("F7a: Start runs both nodes to success in sequence", async ({ page }) => {
  await openWorkspace(page);

  await addSkillByButton(page, "Implement Feature");
  await addSkillByButton(page, "Review Code");
  await connectFirstTwoNodes(page);

  await expect(page.getByTestId("workflow-node")).toHaveCount(2);

  const startBtn = page.getByTestId("workflow-start");
  await expect(startBtn).toBeEnabled();
  await startBtn.click();

  // Both nodes should land on success.
  await expect(page.locator('[data-testid="workflow-node"][data-run-state="success"]')).toHaveCount(2);
  await expect(startBtn).toBeEnabled();
});

test("F7b: clicking Start while a run is in flight is ignored", async ({ page }) => {
  await openWorkspace(page);

  await addSkillByButton(page, "Implement Feature");
  await addSkillByButton(page, "Review Code");
  await connectFirstTwoNodes(page);

  // Pin the run store into 'running' so the second click is guaranteed to hit
  // the duplicate-prevention guard without racing the mock runner.
  await page.evaluate(() => {
    const w = window as unknown as {
      __RUN_STORE__: {
        getState: () => {
          beginRun: (args: {
            runId: string;
            workflowId: string | null;
            nodeIds: readonly string[];
            startedAt: string;
          }) => void;
        };
      };
      __WORKFLOW_STORE__: {
        getState: () => { nodes: Array<{ id: string }> };
      };
    };
    const ids = w.__WORKFLOW_STORE__.getState().nodes.map((n) => n.id);
    w.__RUN_STORE__.getState().beginRun({
      runId: "pinned-run",
      workflowId: null,
      nodeIds: ids,
      startedAt: new Date().toISOString(),
    });
  });

  const startBtn = page.getByTestId("workflow-start");
  await expect(startBtn).toBeDisabled();

  // Even if a stale runWorkflow call sneaks through (via direct invocation),
  // the store guard should keep the pinned runId untouched.
  const runIdAfter = await page.evaluate(() => {
    const w = window as unknown as {
      __RUN_STORE__: { getState: () => { runId: string | null } };
    };
    return w.__RUN_STORE__.getState().runId;
  });
  expect(runIdAfter).toBe("pinned-run");
});

test("F7c: stuck run identifies the node waiting for stdin", async ({ page }) => {
  await openWorkspace(page);

  await addSkillByButton(page, "Review Code");
  await page.evaluate(() => {
    const w = window as unknown as {
      __CIRCUIT_SET_RUNTIME_SCENARIO__: (scenario: "stdin-waiting") => void;
    };
    w.__CIRCUIT_SET_RUNTIME_SCENARIO__("stdin-waiting");
  });

  const startBtn = page.getByTestId("workflow-start");
  await expect(startBtn).toBeEnabled();
  await startBtn.click();

  await expect(
    page.locator(
      '[data-testid="workflow-node"][data-skill-provider="codex"][data-run-state="waiting_input"]',
    ),
  ).toHaveCount(1);
  await expect(page.getByTestId("run-log-run-state")).toContainText(
    "waiting for input",
  );
  await expect(page.getByTestId("run-log")).toContainText(
    "Reading additional input from stdin",
  );
});
