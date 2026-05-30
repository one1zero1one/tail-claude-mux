# Spec: pane-focus-driven attention colouring

**Status:** approved (Dani, 2026-05-30) — implementing
**Branch:** `dani`

## Problem

tcm tracks "focused session" and "unseen" at **session granularity** (`listAttachedSessions()`).
A user who runs many agents as **windows inside one tmux session** (one session attached
the whole time) gets three broken behaviours:

1. **Unseen never fires.** The `applyEvent` gate suppresses unseen when the agent's session
   is attached. With one always-attached session, every terminal/waiting event reads as seen.
2. **The "current" highlight never moves** between windows — it's keyed to `currentSession`,
   and there's only one session.
3. No way to see, in the sidebar, "this window changed while I wasn't looking at it."

The signal to fix all three already arrives: tmux's `pane-focus-in` hook POSTs the focused
`paneId` to `/pane-focus`. Today the server only re-broadcasts it to the TUI for dimming.
Each agent already carries its own `paneId`. The fix is to use that signal at pane granularity.

## Design

**Vocabulary (locked with Dani): colour = attention, glyph = reason.**

| State | Colour | Meaning |
|---|---|---|
| current | `text` (bright) | the pane you're focused on now — follows window switches |
| seen | `overlay0` (gray) | visited since it last changed; nothing new |
| unseen | `red` | reached done/waiting/error while you were in a different pane |

The gutter glyph **shape** is unchanged (spinner/bell/check/stop/alert = the reason).
Only its colour changes. This mirrors the bottom tmux bar's gray/red/current model.

### Server (`packages/runtime/src/agents/tracker.ts`)

- Add `private focusedPaneId: string | null`.
- Add `setFocusedPane(paneId)`: store it **and** clear `unseen` for every instance whose
  `paneId === paneId` (visiting a window marks its agent seen — instant, event-driven).
- Change the unseen gate in `applyEvent`: when an event has a known `paneId`, suppress
  unseen iff `event.paneId === focusedPaneId`. When `paneId` is unknown (pre-resolution),
  fall back to the existing session-level `this.active` check. (No reinvention — same
  "what counts as unseen" rule: terminal statuses + `waiting`.)

### Server (`packages/runtime/src/server/index.ts`)

- `/pane-focus` handler: in addition to broadcasting the message, call
  `tracker.setFocusedPane(paneId)` and `broadcastState()` if it cleared anything.

### TUI (`apps/tui/src/index.tsx`)

- Track `currentPaneId` from the `pane-focus` message, ignoring the sidebar's own pane
  (`muxCtx.paneId`) so navigating the sidebar doesn't drop the highlight.
- Thread `currentPaneId` through `SessionCard` → `PaneRowItem`.
- `PaneRowItem.glyphColor`: `isCurrent ? text : isUnseen ? red : overlay0`.
- Align the row label tint with the same model (replace the existing teal-unseen tint).

## Scope guard

- No new glyphs, layout, or config options.
- Bottom bar untouched (already works).
- "What counts as a notable state" unchanged — reuse existing done/waiting/error logic.
- Session-level `active` retained as the unknown-pane fallback (not removed).

## Verification

- Unit: tracker tests — focused pane suppresses unseen; non-focused pane sets it;
  `setFocusedPane` clears it. (`packages/runtime/test/agent-tracker.test.ts`)
- Live: switch tmux windows, watch a background agent finish → red; visit it → clears;
  current window glyph stays bright and follows the switch.
