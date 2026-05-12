export const TUTORIAL_REPOSITORY_NAME = "Circuit Tutorial";
export const TUTORIAL_RESULT_FILE = "hello_world.html";
export const TUTORIAL_BRIEFING_FILE = "tutorial_result.md";
export const TUTORIAL_STARTER_PROMPT =
  "Create hello_world.html with a friendly Hello from Circuit page.";

export function isTutorialRepositoryPath(path: string): boolean {
  return basename(path) === TUTORIAL_REPOSITORY_NAME;
}

export function tutorialResultPath(repoPath: string): string {
  return `${repoPath.replace(/\/+$/, "")}/${TUTORIAL_RESULT_FILE}`;
}

export function tutorialBriefingPath(repoPath: string): string {
  return `${repoPath.replace(/\/+$/, "")}/${TUTORIAL_BRIEFING_FILE}`;
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}
