import { test, expect } from "@playwright/test";
import { setupMocks, openTestWorkspace } from "./helpers";

test.beforeEach(async ({ page }) => {
  await setupMocks(page);
  await page.goto("/");
  await openTestWorkspace(page);
});

test("activity bar is always visible with correct width", async ({ page }) => {
  const activityBar = page.getByTestId("activity-bar");
  await expect(activityBar).toBeVisible();

  const box = await activityBar.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeCloseTo(40, 0);
});

test("workspace view renders with sidebar and editor area", async ({
  page,
}) => {
  const workspaceView = page.getByTestId("workspace-view");
  const sidebar = page.getByTestId("sidebar");
  const editorArea = page.getByTestId("editor-area");

  await expect(workspaceView).toBeVisible();
  await expect(sidebar).toBeVisible();
  await expect(editorArea).toBeVisible();
});

test("sidebar fills full height of parent", async ({ page }) => {
  const sidebar = page.getByTestId("sidebar");
  const workspaceView = page.getByTestId("workspace-view");

  const sidebarBox = await sidebar.boundingBox();
  const parentBox = await workspaceView.boundingBox();

  expect(sidebarBox).not.toBeNull();
  expect(parentBox).not.toBeNull();
  expect(sidebarBox!.height).toBeCloseTo(parentBox!.height, 0);
});

test("switching to VCS view shows vcs-view and hides workspace", async ({
  page,
}) => {
  // Click Source Control tab
  await page.getByRole("tab", { name: "Source Control" }).click();

  const vcsView = page.getByTestId("vcs-view");
  const workspaceView = page.getByTestId("workspace-view");

  await expect(vcsView).toBeVisible();
  await expect(workspaceView).not.toBeVisible();
});

test("switching back to workspace view restores layout", async ({ page }) => {
  // Switch to VCS
  await page.getByRole("tab", { name: "Source Control" }).click();
  await expect(page.getByTestId("vcs-view")).toBeVisible();

  // Switch back to workspace
  await page.getByRole("tab", { name: "Files" }).click();

  const workspaceView = page.getByTestId("workspace-view");
  const sidebar = page.getByTestId("sidebar");
  const vcsView = page.getByTestId("vcs-view");

  await expect(workspaceView).toBeVisible();
  await expect(sidebar).toBeVisible();
  await expect(vcsView).not.toBeVisible();
});
