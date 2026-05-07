import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ApprovalPrompt } from "./ApprovalPrompt";
import type { PendingApproval } from "../../runner/runLogStore";

const trustRequest: PendingApproval = {
  requestId: "rq-1",
  nodeId: "n-1",
  prompt: "Do you trust this directory?",
  approvalKind: "trust",
  createdAt: "t-0",
};

const freeformRequest: PendingApproval = {
  requestId: "rq-2",
  nodeId: "n-2",
  prompt: "Enter API key:",
  approvalKind: "freeform",
  createdAt: "t-0",
};

describe("ApprovalPrompt", () => {
  it("trust kind: Allow sends 'y\\n' via onRespond", async () => {
    const onRespond = vi.fn(async () => {});
    render(<ApprovalPrompt request={trustRequest} onRespond={onRespond} />);
    fireEvent.click(screen.getByTestId("approval-allow"));
    await Promise.resolve();
    expect(onRespond).toHaveBeenCalledWith("y\n");
  });

  it("trust kind: Deny sends 'n\\n' and is not the same call as Allow", async () => {
    const onRespond = vi.fn(async () => {});
    render(<ApprovalPrompt request={trustRequest} onRespond={onRespond} />);
    fireEvent.click(screen.getByTestId("approval-deny"));
    await Promise.resolve();
    expect(onRespond).toHaveBeenCalledWith("n\n");
  });

  it("freeform kind: typing + Send sends '<text>\\n' through onRespond", async () => {
    const onRespond = vi.fn(async () => {});
    render(<ApprovalPrompt request={freeformRequest} onRespond={onRespond} />);
    const input = screen.getByTestId("approval-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "secret-token" } });
    fireEvent.click(screen.getByTestId("approval-send"));
    await Promise.resolve();
    expect(onRespond).toHaveBeenCalledWith("secret-token\n");
  });

  it("dismiss button only appears when onDismiss is provided and triggers it", () => {
    const onRespond = vi.fn(async () => {});
    const onDismiss = vi.fn();
    const { rerender } = render(
      <ApprovalPrompt request={trustRequest} onRespond={onRespond} />,
    );
    expect(screen.queryByTestId("approval-dismiss")).toBeNull();
    rerender(
      <ApprovalPrompt
        request={trustRequest}
        onRespond={onRespond}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByTestId("approval-dismiss"));
    expect(onDismiss).toHaveBeenCalled();
  });
});
