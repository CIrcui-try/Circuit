import { describe, expect, it } from "vitest";
import sampleWorkflow from "../../../fixtures/workflows/sample-agent-handoff.json";
import tutorialTicketLoop from "../../../fixtures/workflows/tutorial-ticket-loop.json";
import { validateWorkflow } from "./validate";

describe("workflow/validate", () => {
  it("V1: sample-agent-handoff fixture passes validation", () => {
    const result = validateWorkflow(sampleWorkflow);
    expect(result).toEqual({ ok: true });
  });

  it("V1b: tutorial ticket loop fixture passes validation", () => {
    const result = validateWorkflow(tutorialTicketLoop);
    expect(result).toEqual({ ok: true });
  });

  it("V2: missing repositoryId fails", () => {
    const wf = { ...sampleWorkflow, repositoryId: "" };
    const result = validateWorkflow(wf);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("repositoryId"))).toBe(true);
    }
  });

  it("V3: unsupported provider fails", () => {
    const wf = JSON.parse(JSON.stringify(sampleWorkflow));
    wf.nodes[0].skillRef.provider = "openai";
    const result = validateWorkflow(wf);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("provider"))).toBe(true);
    }
  });

  it("V4: dangling edge fails", () => {
    const wf = JSON.parse(JSON.stringify(sampleWorkflow));
    wf.edges[0].target = "node_does_not_exist";
    const result = validateWorkflow(wf);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("target"))).toBe(true);
    }
  });

  it("V5: missing skillRef fails", () => {
    const wf = JSON.parse(JSON.stringify(sampleWorkflow));
    delete wf.nodes[0].skillRef;
    const result = validateWorkflow(wf);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("skillRef"))).toBe(true);
    }
  });

  it("V6: placeholder referencing unknown node fails", () => {
    const wf = JSON.parse(JSON.stringify(sampleWorkflow));
    wf.nodes[1].input.diff = "${steps.node_ghost.output}";
    const result = validateWorkflow(wf);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some((e) => e.includes("node_ghost") && e.includes("references unknown source node")),
      ).toBe(true);
    }
  });

  it("V7: malformed placeholder shape fails", () => {
    const wf = JSON.parse(JSON.stringify(sampleWorkflow));
    wf.nodes[1].input.diff = "${steps.node_implement}";
    const result = validateWorkflow(wf);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("malformed placeholder"))).toBe(true);
    }
  });

  it("V8: duplicate node ids fail", () => {
    const wf = JSON.parse(JSON.stringify(sampleWorkflow));
    wf.nodes[1].id = wf.nodes[0].id;
    const result = validateWorkflow(wf);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("duplicated"))).toBe(true);
    }
  });

  it("V9: system skill refs pass with systemSkillId instead of skillFile", () => {
    const wf = JSON.parse(JSON.stringify(sampleWorkflow));
    wf.nodes[0].skillRef = {
      source: "system",
      provider: "codex",
      systemSkillId: "codex:imagegen",
    };

    expect(validateWorkflow(wf)).toEqual({ ok: true });
  });

  it("V10: system skill refs reject skillFile paths", () => {
    const wf = JSON.parse(JSON.stringify(sampleWorkflow));
    wf.nodes[0].skillRef = {
      source: "system",
      provider: "codex",
      systemSkillId: "codex:imagegen",
      skillFile: "/Users/example/.codex/skills/.system/imagegen/SKILL.md",
    };

    const result = validateWorkflow(wf);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("must be omitted"))).toBe(true);
    }
  });

  it("V11: continueOnFailure accepts booleans and rejects other values", () => {
    expect(validateWorkflow({ ...sampleWorkflow, continueOnFailure: true })).toEqual({
      ok: true,
    });

    const result = validateWorkflow({
      ...sampleWorkflow,
      continueOnFailure: "true",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("continueOnFailure"))).toBe(true);
    }
  });
});
