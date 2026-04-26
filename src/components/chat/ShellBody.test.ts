import { describe, it, expect } from "vitest";
import { render } from "@testing-library/svelte";
import ShellBody from "./ShellBody.svelte";

describe("ShellBody", () => {
  it("renders the command with a $ prompt prefix", () => {
    const { getByText } = render(ShellBody, {
      props: {
        command: "ls -la",
        output: "",
        exitCode: 0,
      },
    });
    expect(getByText("$ ls -la")).toBeTruthy();
  });

  it("renders the output block", () => {
    const { container } = render(ShellBody, {
      props: { command: "echo hi", output: "hi\n", exitCode: 0 },
    });
    const pre = container.querySelector("pre");
    expect(pre).toBeTruthy();
    expect(pre!.textContent).toBe("hi\n");
  });

  it("shows exit <code> when exitCode is non-zero, colored as error", () => {
    const { getByText } = render(ShellBody, {
      props: { command: "false", output: "", exitCode: 1 },
    });
    const exitEl = getByText("exit 1");
    expect(exitEl.getAttribute("style")).toContain("--color-error");
  });

  it("colors exit 0 with fg-disabled (silent, per em-tool-calls.jsx:333-334)", () => {
    const { getByText } = render(ShellBody, {
      props: { command: "true", output: "", exitCode: 0 },
    });
    const exitEl = getByText("exit 0");
    expect(exitEl.getAttribute("style")).toContain("--color-fg-disabled");
  });

  it("hides the exit line when exitCode is null", () => {
    const { queryByText } = render(ShellBody, {
      props: { command: "true", output: "", exitCode: null },
    });
    expect(queryByText(/^exit /)).toBeNull();
  });

  it("omits the command row when command is empty", () => {
    const { queryByText } = render(ShellBody, {
      props: { command: "", output: "just output", exitCode: 0 },
    });
    expect(queryByText(/^\$ /)).toBeNull();
  });
});
