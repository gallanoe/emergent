import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { RouterProvider, createRouter, createMemoryHistory } from "@tanstack/react-router";
import { routeTree } from "../../src/routeTree.gen";

describe("heading", () => {
  it("renders Overstory heading", async () => {
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    const screen = render(<RouterProvider router={router} />);
    await expect.element(screen.getByText("Overstory")).toBeVisible();
  });
});
