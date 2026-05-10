import { expect, test } from "@playwright/test";
import { FIXTURE_REPO_PATH, installMockBridge } from "./fixtures/installBridge";

test.beforeEach(async ({ page }) => {
  await installMockBridge(page);
});

test("E1: app loads and shows the Repositories heading", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Repositories" })).toBeVisible();
});

test("E2: empty state hint is visible when no repositories registered", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/No repositories yet/i)).toBeVisible();
  await expect(page.getByTestId("add-repository-button")).toBeVisible();
});

test("E3: clicking Add Repository (with mocked picker) adds the fixture repo", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("add-repository-button").click();

  const list = page.getByTestId("repository-list");
  await expect(list).toBeVisible();
  await expect(list).toContainText("sample-repo");
  await expect(list).toContainText(FIXTURE_REPO_PATH);
});

test("E4: workspace shows fixture skills from the sample repo", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("add-repository-button").click();
  await page.getByRole("link", { name: /sample-repo/ }).click();

  await expect(page.getByTestId("workspace-root")).toBeVisible();
  await expect(page.getByTestId("workflow-canvas")).toBeVisible();

  const skills = page.getByTestId("skill-list");
  await expect(skills).toBeVisible();
  await expect(skills).toContainText("Implement Feature");
  await expect(skills).toContainText("boarding");
  await expect(skills).toContainText("Review Code");
  await expect(skills.locator("li")).toHaveCount(3);
  await expect(skills.getByText("claude", { exact: true })).toBeVisible();
  await expect(skills.getByText("codex", { exact: true })).toHaveCount(2);
});

test("E5: arbitrary docs/ignored-skill SKILL.md is not surfaced", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("add-repository-button").click();
  await page.getByRole("link", { name: /sample-repo/ }).click();

  const skills = page.getByTestId("skill-list");
  await expect(skills).toBeVisible();
  await expect(skills).not.toContainText("Ignored Skill");
  await expect(skills).not.toContainText("ignored-skill");
});
