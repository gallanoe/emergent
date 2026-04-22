import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/svelte";
import { getCliLogo } from "../agent-logos";
import AgentAvatar from "./AgentAvatar.svelte";

describe("AgentAvatar", () => {
  it("renders img with correct src for known CLI", () => {
    const { container } = render(AgentAvatar, { props: { cli: "claude" } });
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe(getCliLogo("claude"));
  });

  it("renders monogram span for unknown CLI", () => {
    render(AgentAvatar, { props: { cli: "unknown" } });
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("U")).toBeTruthy();
  });

  it("forwards size to width and height on img", () => {
    const { container } = render(AgentAvatar, {
      props: { cli: "gemini", size: 32 },
    });
    const img = container.querySelector("img");
    expect(img?.getAttribute("width")).toBe("32");
    expect(img?.getAttribute("height")).toBe("32");
  });
});
