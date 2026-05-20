import { describe, expect, it } from "vitest";
import { parseSkillMeta } from "./parseSkillMeta";

describe("parseSkillMeta", () => {
  it("P1: reads name and description from frontmatter", () => {
    const content = `---\nname: Foo Skill\ndescription: Does foo things\n---\n\n# Body\n`;
    expect(parseSkillMeta(content, "foo")).toEqual({
      name: "Foo Skill",
      description: "Does foo things",
      inputHints: [],
    });
  });

  it("P2: strips matching surrounding quotes from frontmatter values", () => {
    const content = `---\nname: "Quoted Name"\ndescription: 'single quoted'\n---\n`;
    expect(parseSkillMeta(content, "x")).toEqual({
      name: "Quoted Name",
      description: "single quoted",
      inputHints: [],
    });
  });

  it("P3: falls back to first H1 heading when frontmatter has no name", () => {
    const content = `---\ndescription: only desc\n---\n\n# Heading Title\n\nbody\n`;
    expect(parseSkillMeta(content, "ignored")).toEqual({
      name: "Heading Title",
      description: "only desc",
      inputHints: [],
    });
  });

  it("P4: uses first H1 when there is no frontmatter at all", () => {
    const content = `# Hello World\n\nsome text\n`;
    expect(parseSkillMeta(content, "ignored")).toEqual({
      name: "Hello World",
      description: "",
      inputHints: [],
    });
  });

  it("P5: falls back to dirName when no frontmatter and no H1", () => {
    const content = `just some text\n## subheading\n`;
    expect(parseSkillMeta(content, "my-dir")).toEqual({
      name: "my-dir",
      description: "",
      inputHints: [],
    });
  });

  it("P6: malformed frontmatter (no closing ---) falls back to H1", () => {
    const content = `---\nname: Never Closed\n\n# Real Heading\n`;
    expect(parseSkillMeta(content, "dir")).toEqual({
      name: "Real Heading",
      description: "",
      inputHints: [],
    });
  });

  it("P7: ignores unknown frontmatter keys", () => {
    const content = `---\nname: Skill\nversion: 1.2\nauthor: kai\n---\n`;
    expect(parseSkillMeta(content, "dir")).toEqual({
      name: "Skill",
      description: "",
      inputHints: [],
    });
  });

  it("P8: empty content yields dirName + empty description", () => {
    expect(parseSkillMeta("", "fallback-name")).toEqual({
      name: "fallback-name",
      description: "",
      inputHints: [],
    });
  });

  it("P9: extracts command-style arguments placeholder from $ARGUMENTS format", () => {
    const content = [
      "# boarding",
      "",
      "## Command Template",
      "",
      "`$ARGUMENTS` 형식: `<ISSUE-ID> [--force]`. 예: `/boarding CIR-15`.",
    ].join("\n");

    expect(parseSkillMeta(content, "boarding").inputHints).toEqual([
      {
        kind: "command",
        key: "arguments",
        label: "ISSUE-ID",
        placeholder: "<ISSUE-ID> [--force]",
      },
    ]);
  });

  it("P10: reads explicit argument-hint frontmatter before body inference", () => {
    const content = [
      "---",
      "name: planning",
      "argument-hint: <task, request, or issue>",
      "---",
      "",
      "## Command Template",
      "`$ARGUMENTS` format: `<TASK>`.",
    ].join("\n");

    expect(parseSkillMeta(content, "planning").inputHints).toEqual([
      {
        kind: "command",
        key: "arguments",
        label: "task, request, or issue",
        placeholder: "<task, request, or issue>",
      },
    ]);
  });

  it("P11: does not infer command input when no explicit hint exists", () => {
    const content = "## Command Template\n\nRun this command carefully.";

    expect(parseSkillMeta(content, "command").inputHints).toEqual([]);
  });

  it("P12: reads default node input and model from frontmatter", () => {
    const content = [
      "---",
      "name: Custom Skill",
      "description: Runs with defaults",
      "default-arguments: CIR-94 --force",
      "default-prompt: Check the implementation",
      "default-model: gpt-5.4",
      "---",
    ].join("\n");

    expect(parseSkillMeta(content, "custom")).toEqual({
      name: "Custom Skill",
      description: "Runs with defaults",
      inputHints: [],
      defaultInput: {
        arguments: "CIR-94 --force",
        prompt: "Check the implementation",
      },
      defaultModel: "gpt-5.4",
    });
  });
});
