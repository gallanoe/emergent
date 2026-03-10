import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

describe("heading", () => {
  it("renders emergent heading", async () => {
    const { default: Index } = await import("../../src/routes/index.tsx");
    const route = Index.options;
    const Component = route.component;
    const screen = render(<Component />);
    await expect.element(screen.getByText("emergent")).toBeVisible();
  });
});
