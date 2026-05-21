export class PathOutsideRepoRootError extends Error {
  constructor(path: string, repoRoot: string) {
    super(
      `path is outside repository root: path=${path} repoRoot=${repoRoot}`,
    );
    this.name = "PathOutsideRepoRootError";
  }
}

function normalize(input: string): string {
  if (input.length === 0) return ".";
  const isAbsolute = input.startsWith("/");
  const segments = input.split("/").filter((s) => s.length > 0 && s !== ".");
  const stack: string[] = [];
  for (const seg of segments) {
    if (seg === "..") {
      if (stack.length > 0 && stack[stack.length - 1] !== "..") {
        stack.pop();
      } else if (!isAbsolute) {
        stack.push("..");
      }
    } else {
      stack.push(seg);
    }
  }
  const joined = stack.join("/");
  if (isAbsolute) return "/" + joined;
  return joined.length === 0 ? "." : joined;
}

function withTrailingSep(p: string): string {
  return p.endsWith("/") ? p : p + "/";
}

export function isInsideRepoRoot(path: string, repoRoot: string): boolean {
  const np = normalize(path);
  const nr = normalize(repoRoot);
  if (np === nr) return true;
  return np.startsWith(withTrailingSep(nr));
}

export function assertInsideRepoRoot(path: string, repoRoot: string): void {
  if (!isInsideRepoRoot(path, repoRoot)) {
    throw new PathOutsideRepoRootError(path, repoRoot);
  }
}
