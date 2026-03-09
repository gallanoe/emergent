import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { RouterProvider, createRouter, createMemoryHistory } from "@tanstack/react-router";
import { routeTree } from "../../src/routeTree.gen";

describe("heading", () => {
  it("renders Overstory heading", async () => {
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    render(<RouterProvider router={router} />);

    await vi.waitFor(
      () => {
        const heading = document.querySelector("h1");
        expect(heading).toBeTruthy();
        expect(heading!.textContent).toBe("Overstory");
      },
      { timeout: 5_000 },
    );
  });
});
