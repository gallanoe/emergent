import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/svelte";
import { getLogoUrlForProvider, getLogoUrlForAgent } from "../agent-logos";
import AgentAvatar from "./AgentAvatar.svelte";

describe("AgentAvatar", () => {
  it("renders img when provider has a logo", () => {
    const { container } = render(AgentAvatar, {
      props: { provider: "claude", name: "My agent" },
    });
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe(getLogoUrlForProvider("claude"));
  });

  it("renders monogram from name when provider has no logo", () => {
    render(AgentAvatar, { props: { provider: null, name: "Local" } });
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("L")).toBeTruthy();
  });

  it("renders img from cli when provider is missing but command is known", () => {
    const { container } = render(AgentAvatar, {
      props: {
        provider: null,
        cli: "bunx @zed-industries/claude-agent-acp",
        name: "Reviewer",
      },
    });
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe(
      getLogoUrlForAgent(null, "bunx @zed-industries/claude-agent-acp"),
    );
  });

  it("forwards size to width and height on img", () => {
    const { container } = render(AgentAvatar, {
      props: { provider: "gemini", name: "G", size: 32 },
    });
    const img = container.querySelector("img");
    expect(img?.getAttribute("width")).toBe("32");
    expect(img?.getAttribute("height")).toBe("32");
  });
});
