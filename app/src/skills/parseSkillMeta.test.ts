import { describe, expect, it } from "vitest";
import { parseSkillMeta } from "./parseSkillMeta";

describe("parseSkillMeta", () => {
  it("P1: reads name and description from frontmatter", () => {
    const content = `---\nname: Foo Skill\ndescription: Does foo things\n---\n\n# Body\n`;
    expect(parseSkillMeta(content, "foo")).toEqual({
      name: "Foo Skill",
      description: "Does foo things",
    });
  });

  it("P2: strips matching surrounding quotes from frontmatter values", () => {
    const content = `---\nname: "Quoted Name"\ndescription: 'single quoted'\n---\n`;
    expect(parseSkillMeta(content, "x")).toEqual({
      name: "Quoted Name",
      description: "single quoted",
    });
  });

  it("P3: falls back to first H1 heading when frontmatter has no name", () => {
    const content = `---\ndescription: only desc\n---\n\n# Heading Title\n\nbody\n`;
    expect(parseSkillMeta(content, "ignored")).toEqual({
      name: "Heading Title",
      description: "only desc",
    });
  });

  it("P4: uses first H1 when there is no frontmatter at all", () => {
    const content = `# Hello World\n\nsome text\n`;
    expect(parseSkillMeta(content, "ignored")).toEqual({
      name: "Hello World",
      description: "",
    });
  });

  it("P5: falls back to dirName when no frontmatter and no H1", () => {
    const content = `just some text\n## subheading\n`;
    expect(parseSkillMeta(content, "my-dir")).toEqual({
      name: "my-dir",
      description: "",
    });
  });

  it("P6: malformed frontmatter (no closing ---) falls back to H1", () => {
    const content = `---\nname: Never Closed\n\n# Real Heading\n`;
    expect(parseSkillMeta(content, "dir")).toEqual({
      name: "Real Heading",
      description: "",
    });
  });

  it("P7: ignores unknown frontmatter keys", () => {
    const content = `---\nname: Skill\nversion: 1.2\nauthor: kai\n---\n`;
    expect(parseSkillMeta(content, "dir")).toEqual({
      name: "Skill",
      description: "",
    });
  });

  it("P8: empty content yields dirName + empty description", () => {
    expect(parseSkillMeta("", "fallback-name")).toEqual({
      name: "fallback-name",
      description: "",
    });
  });
});
