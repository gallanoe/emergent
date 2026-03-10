import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { Route } from "../../src/routes/index.tsx";

describe("heading", () => {
  it("renders emergent heading", async () => {
    const Component = Route.options.component!;
    const screen = await render(<Component />);
    await expect.element(screen.getByText("emergent")).toBeVisible();
  });
});
