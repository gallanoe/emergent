---
name: desktop-utility-design
description: >
  Design and build utility-focused desktop application interfaces that prioritize function, information density,
  keyboard-first interaction, and perceived performance over visual flair. Use this skill when the user asks to
  build desktop app UIs, Electron or Tauri app interfaces, productivity tool layouts, developer tool interfaces,
  data-dense dashboards, admin panels, IDE-like interfaces, database GUIs, or any application where the user
  will spend hours daily and needs efficient, professional, responsive UI — not a marketing page or landing page.
  Also trigger when the user mentions "Linear-style", "VS Code-like", "native-feeling", "utility app", or
  asks for compact/dense/professional desktop layouts. This skill is the opposite of landing-page or marketing
  design — it optimizes for the thousandth use, not the first impression.
---

# Desktop Utility Design

Build professional, functional desktop application interfaces where the UI disappears and the user's work takes center stage. This skill produces interfaces that feel fast, dense, keyboard-navigable, and native — optimized for power users who spend hours in the app daily.

**This skill is NOT for**: marketing pages, landing pages, portfolios, blogs, or any context where first impressions and visual delight are the primary goal. For those, use the frontend-design skill instead.

## Philosophy

The core metric is **temporal density** — how much meaningful work a user accomplishes per unit of time. Every design decision serves this metric. Dense layouts show more data per screen. Keyboard-first interaction eliminates the mouse detour. Sub-100ms responses maintain the illusion of direct manipulation. Muted palettes reserve visual emphasis for what actually matters.

The four major platform HIGs (Apple, Microsoft Fluent, GNOME, KDE) converge on one principle: **the interface exists to serve the user's work, never to showcase itself.** Microsoft's heuristic captures the approach: "Focus on what is likely; reduce, hide, or remove what is unlikely; eliminate what is impossible."

## Design Thinking

Before coding, understand the application context:

- **Task model**: What does the user do repeatedly? What's the critical path? Design for the 80% workflow.
- **Information needs**: What data must be visible simultaneously? How dense should the default view be?
- **Interaction mode**: Keyboard-heavy (code editor, terminal)? Mouse-heavy (canvas tool)? Mixed (project tracker)?
- **Platform targets**: macOS only? Cross-platform? Electron or Tauri? Native framework?
- **Density level**: Developer-tool dense (VS Code) or structured-dense (Linear) or medium-dense (Notion)?

Then implement working code that is: functional and production-grade, information-dense but scannable, keyboard-navigable with visible shortcuts, fast and responsive in all interactions, and platform-aware in structural chrome.

## Design Language

Utility apps are constrained — muted palettes, dense layouts, functional animation — but constrained does not mean identical. VS Code, Linear, Warp, Zed, Raycast, and Things 3 all follow similar technical rules yet feel unmistakably different from each other. The difference is design language: a coherent set of visual decisions that give the app its own quiet personality. Establish this BEFORE writing any component code.

**Step 1 — Choose an aesthetic posture.** Utility apps occupy a narrower spectrum than marketing sites, but there is still meaningful range. Pick one:

- **Polished minimal** (Linear, Raycast): Precise spacing, smooth micro-transitions, refined hover states. Every detail feels considered. The app whispers competence. Cool grays, generous but not wasteful whitespace within dense structures, subtle depth through background layering.
- **Engineering austere** (Zed, Sublime Text): Stripped to the absolute minimum. No transitions, no rounded corners, no decorative elements. Monospace energy extends beyond code blocks. The app feels like a precision instrument — fast, sharp, unapologetic about density.
- **Warm productivity** (Things 3, Notion): Slightly softer edges, warmer gray tones, gentle transitions. Inviting without being playful. Human-feeling without sacrificing utility. Larger touch targets, slightly more spacing, natural metaphors.
- **Terminal modern** (Warp, Fig/Amazon Q): Dark-first with vivid accent colors, glowing highlights on dark surfaces, monospace-heavy, command-line heritage with modern polish. High contrast, high energy, developer-native.
- **Quiet tool** (Obsidian, iA Writer): Near-invisible UI chrome. Maximum content, minimum interface. The app aims to disappear entirely. Extremely muted colors, thin or absent borders, typography does all the heavy lifting.

Don't blend these arbitrarily. Commit to one posture and let it drive every subsequent decision.

**Step 2 — Define surface treatment.** How are containers, panels, and cards distinguished from each other? Pick ONE primary strategy and use it consistently:

- **Background shifts**: Containers differ by subtle background color steps (Linear's approach). No visible borders between panels — depth is created by lightness differences. Clean but requires a well-structured gray scale.
- **Borders**: Thin 1px borders define every container edge (VS Code's approach). Crisp and explicit. Works well at high density where background shifts would be too subtle to read.
- **Shadows**: Elevated surfaces cast soft shadows (macOS-native feel, Things 3). Warmer, more dimensional, but heavier to render and harder to get right in dark mode.
- **Negative space**: No borders, no background shifts — containers are defined purely by spacing and alignment (iA Writer). Requires disciplined spacing and only works at lower density.

Mixing these signals (borders AND background shifts AND shadows on the same surface) creates visual noise. Choose one as the primary, and use a second sparingly for emphasis (e.g., borders for structure + shadow only on floating overlays).

**Step 3 — Establish corner radius.** This is a small decision with outsized impact on personality. Pick a value and apply it everywhere — buttons, inputs, cards, tooltips, menus, modals.

- **0px** (sharp): Technical, precise, engineering-coded. (Zed, terminal apps.)
- **4px** (slight): Professional, modern default. (Linear, VS Code.)
- **6–8px** (soft): Friendlier, warmer, more approachable. (Notion, Things 3.)
- **Pill/full radius**: Only for specific elements like tags, badges, and status indicators — never for containers or panels.

Inconsistent corner radii (4px on buttons, 8px on cards, 12px on modals) is one of the fastest ways to make a UI feel undesigned.

**Step 4 — Set the emotional temperature.** Two axes define the feeling:

- **Warm ↔ Cool**: Determined by gray undertone. Warm grays (slight yellow/brown tint) feel approachable and organic. Cool grays (slight blue/slate tint) feel precise and technical. Most utility apps lean cool. Things 3 and Notion are exceptions that lean warm.
- **High energy ↔ Low energy**: Determined by contrast between accent and background, vibrancy of status colors, and presence/absence of animated flourishes. Warp is high energy (vivid gradients, glowing selections). Obsidian is low energy (everything is muted, nothing demands attention).

**Step 5 — Define the motion personality.** Even within the constraint of "animation restraint," there's expressive range:

- **No animation**: Instant state changes. Maximum perceived speed. Appropriate for engineering-austere posture. (Zed, Sublime.)
- **Functional easing**: 100–150ms transitions on hover states, panel open/close, view switches. ease-out for elements entering, ease-in for elements leaving. (Linear, VS Code.)
- **Tactile response**: Slightly longer (150–200ms) with spring-like easing. Subtle scale transforms on press (0.98 scale-down on click). Feels physically responsive, like pressing a real button. (Things 3, Raycast.)

Choose one and use it for ALL transitions. A 100ms ease-out on one button and a 300ms spring on another creates an incoherent experience.

**Step 6 — Write it down.** Before coding, state the design language in 2–3 sentences. This is the creative brief that guides all implementation. Examples:

- *"Polished minimal with cool slate grays, 4px radius, background-shift surfaces, and 120ms ease-out transitions. One blue accent. The app should feel like a well-organized workspace — clean, efficient, quietly sophisticated."*
- *"Engineering austere with neutral grays, 0px radius, thin border surfaces, and zero animation. Monospace type for all data. The app should feel like a precision instrument — nothing decorative, nothing slow."*
- *"Warm productivity with slightly warm grays, 6px radius, subtle shadow surfaces, and 150ms spring transitions. Green accent. The app should feel inviting and calm — a tool you enjoy returning to."*

This statement is the north star. When making any visual decision during implementation, check it against this brief. If a decision doesn't serve the stated personality, change the decision — not the brief.

## Layout

Desktop utility apps use persistent, multi-panel layouts — not single-column scrolling pages.

**Standard structures** (pick one, adapt as needed):

- **Sidebar + Content**: The default for most apps. Sidebar at 200–280px (full) or 48–64px (icon-only). Content fills remaining space. Use for apps with 5–15 top-level sections.
- **Sidebar + List + Detail** (three-column): For email clients, issue trackers, database GUIs. Master list at ~320–400px, detail pane takes remaining width. Below ~720px, collapse to stacked view.
- **Canvas + Panels**: For design tools, node editors. Infinite central workspace flanked by layers/navigation (left) and properties/inspector (right). Panels are collapsible and resizable.
- **Editor + Auxiliary Panels**: For IDEs and writing tools. Central editor with togglable bottom panel (terminal, output, problems) and side panels (file tree, outline, extensions).

**Panel behaviors**:

- All panel dividers should be draggable with min/max width constraints.
- Persist panel sizes, collapsed states, and scroll positions across sessions.
- Provide keyboard shortcuts to toggle each panel (e.g., `Cmd+B` for sidebar).
- Collapsed panels should be recoverable via shortcut or a minimal icon strip.

**Navigation**:

- Place quick search/filter at the top of sidebars.
- Highlight the active selection persistently — the user should always know where they are.
- Support drag-and-drop for reordering within navigation trees.
- Use tree views for hierarchical data (files, nested categories). Arrow keys expand/collapse nodes.

For detailed layout specifications and component patterns, read `references/layout-patterns.md`.

## Typography and Spacing

Desktop apps use tighter typography than the web. These values are deliberate, not arbitrary.

**Font sizes** (these are smaller than web defaults — that's intentional):

- UI labels and captions: 10–12px
- Body text and list items: 13–14px (macOS native is 13pt)
- Section headings: 14–16px semibold
- Page/view titles: 18–24px
- Code and monospace content: 12–14px
- Status bar text: 10–12px

**Font choice**:

- Native apps: use the platform system font (SF Pro on macOS, Segoe UI on Windows).
- Cross-platform Electron/Tauri apps: use Inter (designed for screen readability at small sizes, tall x-height, tabular numbers) or the system font stack: `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
- Monospace (code, IDs, shortcuts): SF Mono, Cascadia Code, JetBrains Mono, or Fira Code.
- Do NOT use display fonts, decorative fonts, or multiple font families for aesthetic variety. One sans-serif family for UI, one monospace family for code. That's it.

**Line height**: 1.2–1.35× for dense UI chrome. Reserve 1.5× only for long-form content areas (documentation, notes, descriptions).

**Hierarchy**: Use weight as the primary hierarchy tool before changing size. Regular (400) for body → Medium (500) for emphasis → Semibold (600) for headings → Bold (700) for titles. Avoid using more than 3 weights in a single view.

**Spacing scale** — use a 4px base unit:

- 2px: micro gaps, tight borders
- 4px: internal component padding
- 8px: standard padding between elements
- 12px: related section gaps
- 16px: section boundaries
- 24–32px: page-level margins

This is tighter than web conventions. That's the point. Desktop users have precise cursors and large screens — whitespace should serve Gestalt grouping, not aesthetics.

## Color and Theming

Color in utility apps is a **communication tool**, not decoration. 90%+ of the interface should be neutral. The remaining accent color carries all the semantic weight.

**Palette construction**:

- **Background layers**: 2–3 neutral tones for depth (base surface, elevated surface, overlay). Never use pure black (#000000) — use #1A1A1A to #1E1E1E for dark mode base. Never use pure white (#FFFFFF) as dark-mode text — use #E0E0E0 to #F0F0F0.
- **Foreground hierarchy**: 3–4 text tones (primary, secondary, muted, disabled) with clear contrast steps.
- **One accent color**: Used for primary actions, active states, focus rings, and links. Desaturate it in dark mode.
- **Semantic colors**: Success (green), warning (amber), error (red), info (blue). Keep these consistent and reserved for their semantic purpose.
- **Interactive states**: Hover, active, focus, disabled — each needs a distinct but subtle visual change. Use background shifts (lighter/darker by one step), not color hue changes.

**Dark mode** is standard for developer and productivity tools. If the app serves technical users, dark mode should be the default with a light mode toggle. Key rules:

- Use cool-tinted grays (slight blue/slate undertone) — warmer and more refined than pure neutral gray.
- Desaturate all accent and semantic colors for dark backgrounds — saturated hues "vibrate."
- Test contrast against WCAG AA: 4.5:1 for normal text, 3:1 for large text and UI components.
- Respect `prefers-color-scheme` and `prefers-reduced-motion` system preferences.

**Theming architecture** — use two token layers:

```css
/* Global tokens — raw values */
--gray-1: #111113;
--gray-2: #18191b;
--blue-9: #0090ff;

/* Semantic tokens — functional meaning */
--color-bg-base: var(--gray-1);
--color-bg-elevated: var(--gray-2);
--color-fg-default: #ECECEF;
--color-fg-muted: #8B8D98;
--color-accent: var(--blue-9);
--color-border: rgba(255,255,255,0.06);
```

For comprehensive color scale guidance, Radix Colors' 12-step system is the gold standard — read `references/color-and-theming.md`.

## Keyboard-First Interaction

Every action in a utility app should be reachable without a mouse. Keyboard support is not an accessibility add-on — it's the primary interaction path for power users.

**Command palette** — implement one. It's table stakes for any complex desktop app.

- Trigger: `Cmd+K` (search + commands) or `Cmd+Shift+P` (commands only, VS Code convention).
- Show recent/suggested commands on launch, not an empty input.
- Fuzzy search across all registered commands.
- Display keyboard shortcuts inline next to each command — this is how users discover and graduate to direct shortcuts.
- Context-aware: available commands change based on current view/selection.
- Dismiss returns focus to the previously focused element.

**Shortcut conventions** — respect platform expectations:

- macOS: `Cmd` is primary modifier. `Cmd+,` for Preferences. `Cmd+Q` to quit. Never override these.
- Windows/Linux: `Ctrl` is primary modifier.
- `Shift` universally means "complement" or "reverse" (Shift+Tab = back).
- Favor mnemonic keys near the modifier key (Q, W, E, A, S, D zone).
- Multi-chord shortcuts (e.g., `Cmd+K Cmd+S`) expand the namespace for complex apps.

**Focus management** — use the two-tier model:

- `Tab` / `Shift+Tab`: moves between major UI regions (sidebar, content, panel).
- Arrow keys: navigate within composite widgets (lists, trees, grids, tabs).
- Only one element in a composite widget has `tabindex="0"` at any time (roving tabindex).
- Show focus rings only for keyboard navigation (`:focus-visible`), not mouse clicks.

For detailed keyboard architecture patterns, read `references/keyboard-interaction.md`.

## Performance and Perceived Speed

A utility app must feel instant. Users who spend hours in the app feel every millisecond of delay.

**Response time targets**:

- Keystroke to character: <16ms (one frame at 60fps)
- Command palette appearance: <100ms
- View/panel switching: <200ms
- Search results: <300ms
- Any operation >1s: show a progress indicator

**Optimistic UI**: Update the interface immediately assuming success; roll back on failure. Apply to: toggles, status changes, CRUD operations with high success rates, drag-and-drop reordering. Do NOT apply to: financial transactions, operations with common failure, cascading side effects.

**Animation restraint** — this is critical. Utility apps are NOT websites.

- Transitions should serve navigation context (where did I come from, where am I going), not visual delight.
- Maximum 150ms for frequent operations (panel open/close, view switch, tooltip appear).
- 200–300ms only for infrequent, significant transitions (modal open, page navigation).
- Prefer `opacity` and `transform` (GPU-accelerated) over `height`, `width`, `margin` animations.
- Always respect `prefers-reduced-motion` — provide an instant alternative.
- When in doubt, skip the animation entirely. Instant is always acceptable; slow never is.

**Technical performance** for Electron/Tauri apps:

- Virtual scroll any list over ~100 items. Render only visible items plus a small buffer.
- Bundle fonts and assets locally — never fetch from CDN at runtime.
- Create BrowserWindow with `show: false`, reveal on `ready-to-show` to prevent white flash.
- Set `backgroundColor` on the window to match your dark mode base color.
- Use Web Workers for computation that could block the main thread.

## Cross-Platform Behaviors

Desktop apps built with web technology (Electron, Tauri) must feel native. This means specific CSS and behavioral adjustments.

**Global CSS for desktop apps**:

```css
body {
  font-size: 14px;                    /* Not 16px */
  line-height: 1.3;                   /* Not 1.5 */
  cursor: default;                    /* Not pointer */
  user-select: none;                  /* Re-enable on content areas */
  -webkit-app-region: no-drag;
  overflow: hidden;                   /* App manages its own scrolling */
}

/* Pointer cursor ONLY for external links */
a[href^="http"] { cursor: pointer; }

/* Re-enable text selection in content areas */
.content-area,
textarea,
input,
[contenteditable] {
  user-select: text;
}
```

**Platform-specific adaptations**:

- **Window controls**: Traffic lights on the left (macOS), min/max/close buttons on the right (Windows/Linux). In frameless windows, add padding-left on macOS for traffic light inset.
- **Keyboard modifiers**: Map `Cmd` ↔ `Ctrl` between platforms. Display platform-correct symbols in shortcuts (⌘, ⌃, ⇧, ⌥ on macOS; Ctrl, Alt, Shift on Windows).
- **Menu bar**: macOS apps should use the native menu bar (top of screen). Windows/Linux can use in-window menu bars.
- **System tray**: Use for background processes, notifications, and quick-access actions.
- **State persistence**: Remember and restore window position, size, and workspace across restarts.
- **Scrollbar styling**: Match platform conventions. macOS overlays auto-hiding scrollbars; Windows shows persistent track scrollbars.

**Tauri vs Electron considerations**:

- Tauri uses the OS WebView (~2–25MB binary) but rendering may differ slightly across platforms (WebKit on macOS, WebView2 on Windows, WebKitGTK on Linux). Test on all targets.
- Electron bundles Chromium (150MB+) but guarantees rendering consistency. Higher resource usage.
- Both: avoid `-webkit-` prefixed properties when standard equivalents exist.

## Data Display

Utility apps frequently present tables, lists, trees, and property panels. Dense data display is a core competency.

**Tables**:

- Offer configurable row density: condensed (32–40px), regular (48–52px), relaxed (56–64px).
- Use tabular/monospaced figures for numeric columns.
- Right-align numbers (counts, currency, percentages). Left-align text.
- Sticky headers. Consider frozen first columns for wide tables.
- Hover-reveal row actions (edit, delete, duplicate) to avoid button clutter.
- Virtual scroll for datasets over ~100 rows.
- Support column resizing, reordering, and show/hide. Persist user preferences.
- Sortable columns with clear sort direction indicators.

**Lists**:

- Compact item height: 28–36px for simple items, 48–64px for multi-line with metadata.
- Keyboard navigable: arrow keys move selection, Enter opens/activates.
- Multi-select with Shift+Click (range) and Cmd/Ctrl+Click (individual).
- Inline status indicators (colored dots, icons) rather than text labels where possible.

**Trees**:

- Indentation: 16–20px per nesting level.
- Expand/collapse with arrow keys (Right to expand, Left to collapse).
- Disclosure triangles, not plus/minus icons (follows platform convention).
- Lazy-load children for large trees.

**Property panels / inspectors**:

- Label-value pairs in a compact two-column layout.
- Labels at 11–12px muted text, values at 13–14px default text.
- Group related properties with subtle section dividers.
- Inline editing where possible — click a value to edit in place.

## Dialogs and Overlays

- Prefer **non-modal** approaches: inline expansion, slide-in panels, toast notifications.
- Use modals ONLY for irreversible destructive actions or blocking information requirements.
- Better yet: allow destructive actions to be undone rather than confirming them.
- Command palette is a special dialog: it should NOT activate the parent window — dismissal returns focus to whatever was active before.
- Toast notifications for success/error feedback: bottom-right or top-right, auto-dismiss after 3–5 seconds, include an undo action when applicable.

## Anti-Patterns to Avoid

These are the most common mistakes when building desktop app UIs:

- **Importing web spacing**: 16px base font, 1.5× line height, 24–48px padding — all wrong for desktop utility. Use the tighter values specified above.
- **Pointer cursor everywhere**: Desktop apps use `cursor: default` on interactive elements. `cursor: pointer` is for hyperlinks only.
- **Decorative animations**: If an animation runs thousands of times daily, its cumulative delay is a performance cost. Remove it.
- **Overusing modals**: Every confirmation dialog trains users to click "OK" reflexively. Use undo instead.
- **Hamburger menus**: Desktop screens have space. Show navigation permanently in sidebars or tab bars.
- **Ignoring keyboard navigation**: If an action requires a mouse, power users will resent your app.
- **Pure black backgrounds**: #000000 causes halation and OLED smearing. Use #1A1A1A to #1E1E1E.
- **Gratuitous color**: If everything is colorful, nothing communicates. Restrict color to functional meaning.
- **Losing state on restart**: Window position, scroll positions, collapsed panels, open tabs — all must persist.
- **Neglecting text selection**: Content areas must allow text selection even when the rest of the UI has `user-select: none`.

## Reference Files

For detailed guidelines on specific topics, read these files from the `references/` directory:

- `references/layout-patterns.md` — Detailed specs for sidebar, three-column, canvas, and editor layouts with responsive breakpoints.
- `references/keyboard-interaction.md` — Full keyboard architecture: command registry, keybinding layers, focus management, and shortcut discovery patterns.
- `references/color-and-theming.md` — Complete color scale construction, Radix-style 12-step scales, dark mode rules, semantic token architecture, and accessibility testing.
