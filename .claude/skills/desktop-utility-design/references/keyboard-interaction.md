# Keyboard Interaction Architecture

Comprehensive guide to designing keyboard-first interaction for desktop utility applications.

---

## Table of Contents

1. Command Registry Pattern
2. Keybinding System Architecture
3. Standard Shortcut Conventions
4. Focus Management
5. Command Palette Design
6. Shortcut Discovery and Teaching
7. Composite Widget Navigation
8. Accessibility Considerations

---

## 1. Command Registry Pattern

Every action in the application should be registered as a named command. This decouples the action from its trigger, enabling keyboard shortcuts, command palette search, menu items, and toolbar buttons to invoke the same underlying operation.

**Structure**:

```typescript
interface Command {
  id: string;             // Unique identifier: 'editor.toggleWordWrap'
  title: string;          // Human-readable: 'Toggle Word Wrap'
  category?: string;      // Grouping: 'Editor', 'View', 'File'
  icon?: string;          // For toolbar/menu display
  keybinding?: string;    // Default shortcut: 'Alt+Z'
  when?: string;          // Context condition: 'editorFocus'
  handler: () => void;    // The actual action
}
```

**Naming conventions**:

- Use dot-separated namespaces: `file.save`, `file.saveAs`, `editor.find`, `view.toggleSidebar`.
- Keep IDs stable — users may reference them in custom keybinding configs.
- Categories map to command palette sections and menu groupings.

**Context conditions** (the `when` clause):

- Boolean expressions that determine whether a command is available in the current state.
- Examples: `editorFocus`, `sidebarVisible`, `listFocus && !inputFocus`, `hasSelection`.
- This allows key reuse: the same shortcut does different things in different contexts.
- VS Code's architecture uses a ContextKeyService that tracks boolean flags and evaluates `when` clauses against them.

---

## 2. Keybinding System Architecture

The keybinding system maps keyboard input to commands, resolving conflicts through context priority.

**Resolution order** (highest to lowest priority):

1. User-defined keybindings (custom overrides)
2. Extension/plugin keybindings
3. Application default keybindings

**Multi-chord keybindings**:

- First chord sets a "pending" state (show a visual indicator: "Waiting for second key...").
- Second chord completes the command.
- Example: `Cmd+K Cmd+S` (save all), `Cmd+K Cmd+C` (comment selection).
- Timeout after 2–3 seconds if no second chord is pressed.
- This dramatically expands the keybinding namespace for complex apps.

**Platform-aware mapping**:

```typescript
// Define keybindings with platform variants
{
  command: 'file.save',
  mac: 'Cmd+S',
  win: 'Ctrl+S',
  linux: 'Ctrl+S'
}
```

Display the correct symbols per platform:
- macOS: ⌘ (Command), ⌥ (Option), ⌃ (Control), ⇧ (Shift)
- Windows/Linux: Ctrl, Alt, Shift

---

## 3. Standard Shortcut Conventions

These shortcuts are deeply ingrained user expectations. Never override them.

**Universal (all platforms)**:

| Action           | macOS       | Windows/Linux |
|------------------|-------------|---------------|
| Save             | ⌘S          | Ctrl+S        |
| Undo             | ⌘Z          | Ctrl+Z        |
| Redo             | ⌘⇧Z         | Ctrl+Y        |
| Copy             | ⌘C          | Ctrl+C        |
| Paste            | ⌘V          | Ctrl+V        |
| Cut              | ⌘X          | Ctrl+X        |
| Select All       | ⌘A          | Ctrl+A        |
| Find             | ⌘F          | Ctrl+F        |
| Close tab/view   | ⌘W          | Ctrl+W        |
| Quit             | ⌘Q          | Alt+F4        |
| Preferences      | ⌘,          | Ctrl+,        |
| New              | ⌘N          | Ctrl+N        |

**Common desktop app shortcuts** (strong conventions):

| Action              | macOS           | Windows/Linux      |
|----------------------|-----------------|--------------------|
| Command palette      | ⌘⇧P or ⌘K      | Ctrl+Shift+P       |
| Quick open/search    | ⌘P              | Ctrl+P             |
| Toggle sidebar       | ⌘B              | Ctrl+B             |
| Toggle terminal      | ⌃` or ⌘J       | Ctrl+`             |
| Go to line           | ⌃G              | Ctrl+G             |
| Zoom in              | ⌘+              | Ctrl++             |
| Zoom out             | ⌘-              | Ctrl+-             |
| Reset zoom           | ⌘0              | Ctrl+0             |

**Choosing new shortcuts**:

- Use mnemonic letters when possible: `Cmd+E` for Export, `Cmd+D` for Duplicate.
- Favor keys in the left-hand zone (Q, W, E, A, S, D, Z, X, C) — reachable while the left hand is on modifiers.
- Layer modifiers for related variants: `Cmd+S` save, `Cmd+Shift+S` save as, `Cmd+Alt+S` save all.
- Use single-key shortcuts (no modifier) only in specific contexts where text input isn't expected — e.g., `J/K` for list navigation when no input is focused (Gmail, Linear pattern).

---

## 4. Focus Management

Focus management determines which element receives keyboard input. Poor focus management makes an app feel broken for keyboard users.

**Two-tier navigation model** (WAI-ARIA pattern):

- **Tab ring**: Tab/Shift+Tab moves between major UI regions (sidebar, content area, bottom panel, toolbar). Each region is one "tab stop."
- **Arrow navigation**: Within a region, arrow keys move between items (list items, tree nodes, grid cells, tab buttons).

**Roving tabindex**:

Within a composite widget (list, tree, radio group, tab bar), only ONE element has `tabindex="0"` at a time. All others have `tabindex="-1"`. When the user arrows to a new item, move `tabindex="0"` to it.

```html
<!-- Tab bar: only the active tab is in the tab order -->
<div role="tablist">
  <button role="tab" tabindex="0" aria-selected="true">Tab 1</button>
  <button role="tab" tabindex="-1">Tab 2</button>
  <button role="tab" tabindex="-1">Tab 3</button>
</div>
```

**Focus restoration**:

- When a dialog/modal/palette closes, return focus to the element that triggered it.
- When switching views, focus the primary content area of the new view.
- When deleting an item from a list, focus the next item (or previous if deleting the last).
- When collapsing a panel, do NOT move focus — it should remain where it was unless it was inside the collapsed panel.

**Focus indicators**:

- Use `:focus-visible` (not `:focus`) — shows focus rings for keyboard users, hides them for mouse users.
- Focus ring: 2px outline with a small offset (1–2px). Use the accent color or a high-contrast alternative.
- For dark themes: `outline: 2px solid var(--color-accent); outline-offset: 2px;`
- Ensure focus is always visible — never hide it behind overlapping elements or clipped containers.

**Focus trapping**:

- Modal dialogs should trap focus — Tab cycles within the modal, not back to the page behind it.
- The command palette should trap focus while open.
- Escape always closes the trapped context and restores focus to the previous element.

---

## 5. Command Palette Design

The command palette is the most important keyboard interaction pattern in modern desktop apps.

**Core behaviors**:

- Opens instantly (<100ms) on trigger.
- Input field is focused immediately — user can start typing without any additional click.
- Results update on every keystroke (debounce: 16–50ms, not more).
- Fuzzy matching: "tsb" matches "Toggle Sidebar". Highlight matched characters in results.
- Results ordered by: exact match > starts-with > fuzzy match > recently used (tiebreaker).
- Empty state: show recently used commands, pinned commands, or categorized suggestions.

**Result item structure**:

```
[Icon]  Command Name                    Keyboard Shortcut
        Category · Description (muted text)
```

- Primary text: command name, 14px.
- Secondary text: category and description, 12px muted.
- Shortcut badge: right-aligned, monospace, 12px, bordered/background.
- Selection highlight: background color change, not just a border.

**Advanced features**:

- **Scoped search**: Prefix with `>` for commands, `@` for symbols, `#` for headings, `:` for go-to-line (VS Code pattern). Show the mode indicator in the input.
- **Inline actions**: Selected result can have secondary actions (e.g., "Pin to favorites", "Copy shortcut") accessible via `Tab` or a right-click context.
- **Parameter input**: Some commands need arguments. After selecting "Go to Line", the palette should prompt for a line number in the same input.

**Activation behavior**:

- The palette should appear as an overlay on the current window — it should NOT steal focus from other applications.
- On dismiss (Escape or click outside), focus returns to the previously focused element.
- The window behind the palette should remain visible but dimmed (backdrop overlay).

---

## 6. Shortcut Discovery and Teaching

Users shouldn't need to read documentation to learn shortcuts. The app should teach them organically.

**Inline shortcut display**:

- Show shortcuts in menus, next to each menu item.
- Show shortcuts in command palette results (this is the #1 discovery mechanism).
- Show shortcuts in tooltips when hovering toolbar buttons (after a 500ms delay).
- Show shortcuts in context menus.

**Progressive teaching**:

- After a user performs an action via mouse or menu 3+ times, show a subtle toast: "Pro tip: Press ⌘B to toggle the sidebar" (non-blocking, bottom-right, auto-dismiss in 5s).
- Don't show more than one shortcut tip per session.
- Allow users to disable these hints in preferences.

**Shortcut reference sheet**:

- Provide a built-in shortcut reference view (accessible via `Cmd+/` or from Help menu).
- Organized by category (Navigation, Editing, View, etc.).
- Searchable.
- Print-friendly for users who want a physical reference.

---

## 7. Composite Widget Navigation

How arrow keys work inside complex components.

**Lists and menus**:

- Up/Down: move selection.
- Enter: activate/open the selected item.
- Home/End: jump to first/last item.
- Type-ahead: pressing a letter key jumps to the first item starting with that letter.
- Escape: deselect or close (if in a dropdown).

**Trees**:

- Up/Down: move between visible nodes.
- Right: expand a collapsed node; if already expanded, move to first child.
- Left: collapse an expanded node; if already collapsed, move to parent.
- Enter: activate the selected node.
- Home/End: first/last visible node.
- Asterisk (*): expand all siblings.

**Grids and tables**:

- Arrow keys: move cell by cell.
- Tab: move to next cell (left to right, then next row).
- Ctrl+Home: top-left cell. Ctrl+End: bottom-right cell.
- Shift+Arrow: extend selection.
- Enter: begin editing the current cell. Escape: cancel edit.

**Tabs**:

- Left/Right (or Up/Down for vertical tabs): move between tabs.
- Home/End: first/last tab.
- Enter or Space: activate the focused tab (if activation isn't automatic on focus).

---

## 8. Accessibility Considerations

Keyboard support is inherently tied to accessibility, but there are additional requirements.

**ARIA roles**: Apply correct roles to composite widgets — `role="tablist"`, `role="tree"`, `role="grid"`, `role="listbox"`. This tells assistive technology how to interpret the keyboard navigation.

**ARIA states**: `aria-selected`, `aria-expanded`, `aria-activedescendant`, `aria-disabled`. Keep these in sync with the visual state.

**Screen reader announcements**: Use `aria-live="polite"` regions to announce: search result counts, status changes, async operation completion, error messages. Don't announce routine navigation — screen readers handle that via roles.

**High contrast mode**: Test the app with OS-level high contrast settings enabled. Ensure all interactive elements remain distinguishable. Consider providing a dedicated high-contrast theme.

**Reduced motion**: Wrap all animations in `@media (prefers-reduced-motion: no-preference) { ... }` and provide instant alternatives.
