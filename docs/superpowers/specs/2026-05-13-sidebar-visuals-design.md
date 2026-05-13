# Sidebar visuals + interaction polish — design

**Status:** approved (2026-05-13)
**Branch:** `dani/per-session-overview`
**Predecessor:** the pane-tree feature ended at `bb85613` + the simplifications already shipped uncommitted in the working tree.

## Why

After the pane-tree feature shipped, several visual decisions need to settle:

- The leading `✕` reads as a destructive close button but it actually just dismisses a terminal-state row from the list. Users mistake it for a kill action; rows that aren't dismissable have no leading mark, breaking visual alignment.
- Status today appears only at the row's trailing edge. With the front character used by `✕`, the eye has to scan to the right to learn anything about state.
- The window-header treatment doesn't match the tmux status bar's color scheme. Inconsistent.
- Several keybindings (`tab`/`1-9`/`n`/`u`/`=`/reorder/session-cycle) don't apply when the focused session is locked-to-local. Help shows them anyway.
- The dual-panel focus model (sessions ↔ agents) is leftover from the pre-lock UX. With one navigable list, it's overhead.
- The trailing `#hash` on every Claude row is visual noise — the threadName already identifies the thread.

## Goals

- Replace the leading `✕` with a status glyph carrying color and shape that communicate state at a glance.
- Drop the trailing duplicate status icon.
- Drop the per-row `#hash` from the row body (still available in data for future hover/expand use).
- Use the tmux status-bar color scheme on window headers (teal-bg = current, yellow-bg = activity).
- Indent pane rows 2 cols under their window header so the tree shape is visible.
- Collapse the keybinding set to the actually-used ones; drop the two-panel focus model.
- Single-list navigation via `j/k`/arrows/mouse with `↩` to activate.

## Out of scope

- Activity zone behavior — keep as-is (session-wide combined activity feed, source-tagged per thread).
- Cross-session / cross-Ghostty activity feed (future).
- Hover-revealed hash or other progressive-disclosure affordances.
- Dismiss / kill actions inside tcm — the user manages those in tmux directly.
- Session-card chrome (already simplified; no count badge, no branch chip).

## Status vocabulary

Each pane row begins with one status glyph that carries fg color. The glyph is computed from `pane.agent` and tmux flags. There is no trailing duplicate.

| State | Glyph | Color | Derivation |
|---|---|---|---|
| Claude running | `⠋` (spinner) | blue | `agent.status === "running"` |
| Claude waiting on permission | `?` | yellow | `agent.status === "waiting"` |
| Claude done at prompt | `✓` | green | `agent.status === "done"`, liveness=alive |
| Claude needs your eyes (unseen) | `!` | teal | `agent.unseen === true` |
| Claude errored | `✕` | red | `agent.status === "error"` |
| Claude stopped / exited | `·` | overlay0 dim | terminal status with liveness=exited |
| Shell, foreground command | `◆` | teal | no agent, `paneCurrentCommand !== "zsh"/"bash"/"fish"` |
| Shell, idle | `·` | overlay0 dim | no agent, default shell foreground |
| Tmux activity on pane | `↑` | peach | tmux's `#{window_activity_flag}` on the pane's window AND no agent override |

Precedence when multiple apply: agent state wins over activity flag. The activity glyph is only used on agentless rows that aren't running a foreground non-shell command — i.e. a quiet shell pane that received output while the user looked elsewhere.

## Row layout

Each pane is a single line:

```
<glyph> <type> <label>
```

where:

- `<glyph>` is from the vocabulary above, single cell, fg-colored.
- `<type>` is a dim two-char tag: `cc` for Claude, `sh` for shells. Stays dim regardless of focus.
- `<label>` is:
  - Claude with non-empty `threadName`: the threadName, truncated to 18 chars + `…`.
  - Claude with no threadName: literal `claude-code`.
  - Shell: `paneCurrentCommand`, truncated to 18 chars.

The trailing `#hash` is dropped. The trailing duplicate status glyph is dropped.

Dismiss `✕` button is dropped (action moves to tmux: the user kills panes via tmux, not via tcm).

No tree-tick (`├`/`└`) on pane rows. The 2-col indent under a window header carries the hierarchy alone.

## Window headers

Each window in the focused session renders one header row:

```
 <windowName> 
```

Padded with one space on each side. The header's background is colored per state:

- **Current tmux window** (`#{window_active}` is 1): bg = `palette.teal`, fg = `palette.crust` (Catppuccin teal pill — equivalent to your tmux config's `bg=cyan,fg=black` for `window-status-current-format`).
- **Window has activity** (`#{window_activity_flag}` is 1, and it isn't the current window): bg = `palette.yellow`, fg = `palette.crust` (equivalent to your tmux config's `bg=yellow,fg=black` for `window-status-activity-style`).
- **Otherwise**: no background; fg = `palette.subtext1`.

The previous "hide window header when name matches session name" rule is **reverted**. The colored pill is the visual hierarchy now and is informative even when names match.

## Hierarchy

Pane rows are indented 2 columns under their window header:

```
 work 
  ⠋ cc here-we are
  · sh zsh
 drive by 
  ✓ cc fix pubsub
```

No tree-tick. No window-aggregate glyphs at the header level (deferred — keep header clean).

## Keybindings

The handler is reduced to these:

| Key | Action |
|---|---|
| `j` / `↓` | move keyboard focus down one row |
| `k` / `↑` | move keyboard focus up one row |
| `↩` Enter | focus this row's pane in tmux (already reachable via mouse) |
| `r` | refresh (forces a pane scan) |
| `?` | open help modal |
| `q` | quit the TUI |

Removed: `tab` / `shift-tab`, `1`-`9`, `n`/`c`, `u`, `d`, `x`, `t`, `=`, `⌥↑↓`, `h`/`l` panel-mode swaps. The corresponding handler branches are deleted.

The dual-panel focus model goes with it: `panelFocus` signal and all its branches are removed. Keyboard navigation always moves through `paneRows`. The "back to sessions" path is gone (sessions panel is no longer a separate keyboard target).

Help modal lists only the surviving keys. Footer hint row shows `↩ focus · r refresh · ? help`.

## Mouse

Click anywhere on a pane row activates it (same as `↩`). No hover-revealed actions. Window-header rows are non-interactive.

## Wire model

The `PaneRow` interface gains no new fields. All new state derives from existing fields:

- Status glyph: from `pane.agent.status`, `pane.agent.unseen`, `pane.agent.liveness`, `pane.windowActivityFlag`, `pane.paneCurrentCommand`.
- Window-header color: from `pane.windowActivityFlag` (already on PaneRow) + a new `windowActive: boolean` (server-side `#{window_active}` add to the existing list-panes format).

`windowActive` is the only new field. One bit per pane. Trivial to wire through.

## Implementation outline

The plan will split this into discrete commits. Rough shape:

1. **Server: add `windowActive` to `PaneRow`** (one tmux format field, one type field).
2. **TUI: status glyph vocabulary** — extract into a single `paneStatus()` function returning `{ glyph, color }`. Apply at the head of each row.
3. **TUI: row layout** — drop the trailing status, drop the dismiss `✕`, drop the `#hash`, drop the `cc/sh` color treatment (keep dim).
4. **TUI: window header coloring** — teal for active, yellow for activity, plain otherwise. Remove the hide-when-same-name `Show`.
5. **TUI: indent pane rows** — 2-col leading pad under each window.
6. **TUI: keybinding cleanup** — strip the dropped branches from `handleKeyDown`, remove `panelFocus` signal + uses, update help modal text, update footer hint.

Each step is one commit, types and tests pass at each step, manual visual smoke after the visible ones.

## Risks

- Status glyph precedence is subtle. If `agent.unseen` and `agent.status === "running"` are both true, which wins? Decision: `unseen` overrides only terminal statuses (`done`/`error`/`interrupted`/`waiting`); a running thread keeps its spinner. Codify in the vocabulary table.
- Removing the panel-focus model changes keyboard navigation flow on the (no-lock-to-local) cold-boot screen. Acceptable — lock-to-local is the default and the working assumption.
- The `windowActive` field is a snapshot from the pane scan tick (default 3s). When the user switches tmux windows, the colored pill follows on the next tick. If feels stale, we can wire a `client-session-changed` hook → forced refresh; out of scope here.

## Testing

- C0-C4 didn't add render tests; we continue that policy. Visual smoke after each step.
- A regression test in `packages/runtime/test/...` covers the `windowActive` field appearing in `PaneRow` and being false by default.
- The keybinding cleanup is mechanical; no test.
