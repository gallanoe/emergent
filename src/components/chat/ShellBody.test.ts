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

  it("omits the output block when output is empty", () => {
    const { container } = render(ShellBody, {
      props: { command: "true", output: "", exitCode: 0 },
    });
    expect(container.querySelector("pre")).toBeNull();
  });

  // ── Command resolution from rawInput ───────────────────────────────────────
  // Agents key the shell command differently per tool definition, so the
  // component sniffs a set of aliases off `rawInput` when no explicit
  // `command` prop is given.

  describe("resolving the command from rawInput", () => {
    it.each([
      ["command", "ls -la"],
      ["cmd", "git status"],
      ["script", "make build"],
      ["input", "echo hi"],
      ["bash", "pwd"],
    ])("picks up the %s key", (key, value) => {
      const { getByText } = render(ShellBody, {
        props: { rawInput: { [key]: value }, output: "", exitCode: 0 },
      });
      expect(getByText(`$ ${value}`)).toBeTruthy();
    });

    it("prefers the explicit command prop over anything in rawInput", () => {
      const { getByText, queryByText } = render(ShellBody, {
        props: { command: "explicit", rawInput: { command: "from-raw" }, output: "", exitCode: 0 },
      });
      expect(getByText("$ explicit")).toBeTruthy();
      expect(queryByText("$ from-raw")).toBeNull();
    });

    it("prefers earlier aliases over later ones", () => {
      const { getByText } = render(ShellBody, {
        props: {
          rawInput: { bash: "last", cmd: "second", command: "first" },
          output: "",
          exitCode: 0,
        },
      });
      expect(getByText("$ first")).toBeTruthy();
    });

    it("skips an alias whose value is an empty string", () => {
      const { getByText } = render(ShellBody, {
        props: { rawInput: { command: "", cmd: "fallback" }, output: "", exitCode: 0 },
      });
      expect(getByText("$ fallback")).toBeTruthy();
    });

    it("skips an alias whose value is not a string", () => {
      const { getByText } = render(ShellBody, {
        props: { rawInput: { command: 42, script: "real-command" }, output: "", exitCode: 0 },
      });
      expect(getByText("$ real-command")).toBeTruthy();
    });

    it("joins an argv-style args array with spaces", () => {
      const { getByText } = render(ShellBody, {
        props: { rawInput: { args: ["git", "log", "--oneline"] }, output: "", exitCode: 0 },
      });
      expect(getByText("$ git log --oneline")).toBeTruthy();
    });

    it("ignores an args array holding non-string entries", () => {
      const { queryByText } = render(ShellBody, {
        props: { rawInput: { args: ["git", 3] }, output: "", exitCode: 0 },
      });
      expect(queryByText(/^\$ /)).toBeNull();
    });

    it("renders no command row when rawInput has no recognizable key", () => {
      const { queryByText } = render(ShellBody, {
        props: { rawInput: { unrelated: "value" }, output: "out", exitCode: 0 },
      });
      expect(queryByText(/^\$ /)).toBeNull();
    });

    it.each([
      ["undefined", undefined],
      ["null", null],
      ["a bare string", "not-an-object"],
      ["a number", 7],
    ])("renders no command row when rawInput is %s", (_label, rawInput) => {
      const { queryByText } = render(ShellBody, {
        props: { rawInput, output: "out", exitCode: 0 },
      });
      expect(queryByText(/^\$ /)).toBeNull();
    });
  });
});
