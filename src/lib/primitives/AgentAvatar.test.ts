import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/svelte";
import { getLogoUrlForProvider } from "../agent-logos";
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

  it("falls back to a monogram when provider is missing", () => {
    const { container } = render(AgentAvatar, {
      props: {
        provider: null,
        name: "Reviewer",
      },
    });
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("R")).toBeTruthy();
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
