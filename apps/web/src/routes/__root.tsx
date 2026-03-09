import { createRootRoute, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: () => (
    <div className="flex min-h-screen flex-col">
      <Outlet />
    </div>
  ),
});
