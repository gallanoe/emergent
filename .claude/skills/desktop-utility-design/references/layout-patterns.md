# Layout Patterns for Desktop Utility Applications

Detailed specifications for the core layout patterns used in utility-focused desktop apps.

---

## Table of Contents

1. Sidebar + Content
2. Three-Column (Sidebar + List + Detail)
3. Canvas + Panels
4. Editor + Auxiliary Panels
5. Panel Behaviors and Resizing
6. Responsive Breakpoints for Desktop
7. Status Bars and Toolbars
8. Command Palette Placement

---

## 1. Sidebar + Content

The most common desktop app layout. Used by Linear, Notion, Obsidian, 1Password, Slack.

**Sidebar specifications**:

- Full sidebar: 200–280px width. Shows icon + label for each navigation item.
- Compact sidebar: 48–64px width. Icon-only, with tooltips on hover.
- Collapsible via `Cmd+B` or a toggle button at the sidebar edge.
- Sidebar items: 32–36px height, 8px vertical padding, 12px horizontal padding.
- Active item: subtle background highlight (not a bold color block). Use `--color-bg-elevated` or similar.
- Hover state: lighter background tint, 150ms transition.
- Nested sections: collapsible groups with a section header (11–12px uppercase muted text).
- Quick search input pinned at the top of the sidebar.
- Scrollable independently from main content.

**Content area**:

- Fills remaining width. Apply max-width only for long-form text content (640–720px); data views (tables, boards, grids) should use full width.
- Top area: view title + contextual actions (filter, sort, view toggle). 48–56px height.
- Scroll behavior: content scrolls independently. Sticky headers for tables.

**Resize handle**:

- 4px draggable divider between sidebar and content.
- Change cursor to `col-resize` on hover.
- Min sidebar width: 180px. Max: 400px.
- Double-click to reset to default width.

---

## 2. Three-Column (Sidebar + List + Detail)

Used by email clients, issue trackers, database GUIs, file managers. Examples: Apple Mail, Linear issue view, TablePlus.

**Column specifications**:

- Navigation sidebar: 200–240px (collapsible to 48px icon strip).
- List/master column: 320–400px. Shows item summaries in a compact list.
- Detail column: remaining width. Shows full content for selected item.

**List column**:

- Item rows: 48–64px for two-line items (title + metadata). 32–40px for single-line.
- Selected item: distinct background highlight, not just a border.
- Keyboard: Up/Down arrows to navigate list. Enter to open in detail. Escape to deselect.
- Unread/new indicators: subtle dot or bold title weight.

**Detail column**:

- Minimum useful width: 400px.
- If window narrows below ~960px, collapse to a two-column layout (hide sidebar, show list + detail).
- Below ~720px, collapse to single-column stacked view (list OR detail, with back navigation).

**Breakpoint cascade**:

```
Window > 1200px  →  Three columns visible
Window 960–1200px →  Sidebar collapses to icons, list + detail visible
Window 720–960px  →  Sidebar hidden, list + detail visible
Window < 720px    →  Single column, stacked navigation
```

---

## 3. Canvas + Panels

Used by design tools, node editors, map applications. Examples: Figma, Blender, Node-RED.

**Canvas**:

- Infinite (or very large) scrollable/pannable area.
- Zoom: `Cmd+Scroll` or pinch. Display current zoom level in status bar.
- Pan: Space+Drag or middle-click drag.
- Grid/snap options toggleable from toolbar or shortcut.

**Panel specifications**:

- Left panel (layers/navigation): 240–320px. Shows object hierarchy.
- Right panel (properties/inspector): 280–360px. Shows properties for selected object(s).
- Both panels: independently collapsible, resizable, with keyboard toggle shortcuts.
- Floating panels (optional): for auxiliary tools. Remember position and auto-snap to edges.

**Toolbar**:

- Horizontal toolbar above canvas: 40–48px height.
- Tool selection: icon buttons, 32×32px hit target minimum.
- Active tool: highlighted background or underline indicator.
- Keyboard shortcuts for each tool displayed in tooltips.

---

## 4. Editor + Auxiliary Panels

Used by IDEs, text editors, terminal emulators. Examples: VS Code, Zed, Warp.

**Editor area**:

- Central, takes maximum available space.
- Tab bar for open files/documents: 32–36px height. Scrollable when tabs overflow.
- Tabs show filename, modified indicator (dot), close button on hover.
- Split views: horizontal and vertical splitting. `Cmd+\` to split.

**Activity bar** (VS Code pattern):

- Vertical icon strip: 48px wide, left edge.
- Icons for major sections: Explorer, Search, Source Control, Extensions, etc.
- Active indicator: colored left border or background highlight.
- Clicking the active icon toggles the sidebar panel.

**Bottom panel**:

- Terminal, Output, Problems, Debug Console — tabbed.
- Default height: 200–300px. Resizable via drag handle.
- Toggle with `` Cmd+` `` or `Cmd+J`.
- Maximizable to take full content area.

**Minimap / outline**:

- Optional right-side minimap for long documents (VS Code).
- Outline panel for document structure/symbols.

---

## 5. Panel Behaviors and Resizing

These behaviors apply to ALL layout patterns.

**Drag handles**:

- Width: 1–4px visual, but 8–12px hit target (invisible padding).
- Cursor: `col-resize` for vertical dividers, `row-resize` for horizontal.
- Visual feedback: highlight the handle on hover (subtle background or border color change).

**Constraints**:

- Every panel needs min-width and max-width (or min-height/max-height).
- When a panel reaches its minimum, further dragging should collapse it entirely (with animation, <150ms).
- Double-click a handle to reset the panel to its default size.

**State persistence**:

- Save panel sizes to localStorage or app settings.
- Save collapsed/expanded states.
- Save scroll positions within panels.
- Restore all state on app restart.

**Keyboard panel management**:

- `Cmd+B`: Toggle primary sidebar.
- `Cmd+J` or `` Cmd+` ``: Toggle bottom panel.
- `Cmd+Shift+E`: Focus file explorer.
- `Cmd+Shift+F`: Focus search panel.
- `Ctrl+Number` (1–5): Focus specific panel by position.

---

## 6. Responsive Breakpoints for Desktop

Desktop apps aren't truly "responsive" like web apps, but they should handle window resizing gracefully.

**Width breakpoints**:

- **Large** (>1440px): All panels visible at comfortable widths. Consider offering a wider content area or showing an additional panel.
- **Standard** (1024–1440px): Primary layout. All panels visible at default widths.
- **Narrow** (768–1024px): Collapse secondary panels to icons or hide. Prioritize content area.
- **Minimum** (640–768px): Set as minimum window width. Single-panel view with navigation via overlays.

**Minimum window size**: Set explicitly — don't let the window shrink to a point where the UI breaks.

```javascript
// Electron
mainWindow = new BrowserWindow({
  minWidth: 720,
  minHeight: 480,
  // ...
});

// Tauri (tauri.conf.json)
{
  "windows": [{
    "minWidth": 720,
    "minHeight": 480
  }]
}
```

**Multi-monitor**: Remember which monitor the window was on and restore to the same monitor. Handle cases where the saved monitor is no longer connected.

---

## 7. Status Bars and Toolbars

**Status bar** (bottom of window):

- Height: 22–28px.
- Font size: 10–12px.
- Background: slightly different from main content background (one step darker/lighter).
- Content: contextual information — cursor position, file encoding, branch name, connection status, sync state.
- Left-aligned: contextual info. Right-aligned: global status indicators.
- Clickable items open relevant settings or views.

**Toolbars** (top of content area):

- Height: 40–48px.
- Contains: view title, breadcrumbs, contextual action buttons, filter/sort controls, view mode toggle (list/board/grid).
- Actions: icon buttons (with tooltips showing name + shortcut) or compact text buttons.
- Overflow: use a "more actions" dropdown (`...`) for items that don't fit.
- Sticky: toolbar stays fixed when content scrolls.

---

## 8. Command Palette Placement

- Position: centered horizontally, offset 15–25% from the top of the window. NOT vertically centered.
- Width: 560–640px (or 50% of window width, whichever is smaller).
- Max visible results: 8–12 items before scrolling.
- Shadow: prominent shadow to float above content. Backdrop overlay at 50% opacity.
- Animation: fade in + slight downward slide, <100ms total.
- Dismiss: Escape key, clicking outside, or selecting an item.
