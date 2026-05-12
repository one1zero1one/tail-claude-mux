# Pane tree sidebar — design

**Status:** approved (2026-05-12)
**Branch:** `dani/per-session-overview`
**Predecessor commit:** `c89ae45` (label agent rows by tmux window name)

## Why

The current sidebar shows one row per Claude agent. In a one-Claude-per-pane workflow with worktrees and split panes, that model breaks down:

- The session-level branch chip resolves to the active pane's branch. With windows in different worktrees, it lies most of the time.
- Bare shell panes don't show up at all — they only appear once a Claude process runs in them, so "I just opened a new tab and a new worktree" is invisible until I start Claude.
- There's no signal that a non-current window in the same session emitted output while I was looking elsewhere.

Dani's setup amplifies all three: 1:1 Ghostty / AeroSpace workspace / tmux session, multiple windows per session, multiple panes per window, often in different worktrees of the same repo.

## Goals

- Every pane in every window of the session is a row, regardless of whether Claude is running in it.
- Each row carries its own branch + worktree info on a second line.
- Window headers group sibling panes and surface tmux's `monitor-activity` flag.
- Drop the misleading session-level branch chip.

## Out of scope

- Per-pane "unseen since I last looked" tracking (would require new state for last-focus timestamps; activity at the window level covers the common case).
- Cross-Ghostty / cross-AeroSpace unseen signals.
- Click-to-focus changes — leaf-row clicks reuse the existing `focus-agent-pane` path and work for non-Claude panes too (tmux can focus any pane).
- `OtherSessionRow` migration. Stays on `session.agentState` for now; can be migrated to derive from `panes` in a follow-up.

## Data model

Add a `panes: PaneRow[]` field to `SessionData`, alongside the existing `agents: AgentEvent[]`. The focused-card render switches to `panes`. The existing `agents` field stays because `tmux-header-sync` iterates it directly to map agent type → window; rewriting that is out of scope.

```ts
interface PaneRow {
  paneId: string;                // %29
  windowId: string;              // @5
  windowName: string;            // "drive-by-1"
  windowActivityFlag: boolean;   // tmux #{window_activity_flag}, duplicated per pane
  paneCurrentCommand: string;    // "zsh" / "node" / "2.1.139"
  paneCurrentPath: string;       // cwd
  branch?: string;               // from getGitInfo(cwd); undefined if cwd is not a repo
  agent?: AgentEvent;            // present when a Claude is tracked at this paneId
}
```

`worktreeLeaf` is derived render-side as `basename(paneCurrentPath)` — not stored.

`windowActivityFlag` is duplicated on every pane in the same window. This is deliberate. Window grouping happens render-side; rolling up the flag per group is one line. Introducing a `windows: WindowInfo[]` parallel structure would be cleaner but a larger refactor; defer.

`session.branch` stays on the type (other consumers may read it) but the focused card no longer renders it. Tech debt to clean up later.

Order: `panes` is emitted in `tmux list-panes -a` natural order (window-index ascending, pane-index ascending). No explicit index field.

## Server pipeline

### C0 — Tracker fix (precondition)

`packages/runtime/src/agents/tracker.ts:90-103` currently deletes every `:pane:`-keyed synthetic for the agent type when a watcher event arrives. With two Claudes in the same window, the loop arbitrarily inherits one synthetic's paneId and discards both, then the next pane scan re-creates a fresh synthetic for the orphaned pane. Result: row identity churns every Stop hook.

Fix: in the cleanup loop, only delete the synthetic whose `paneId` matches the incoming watcher event's `paneId` when the watcher provides one, or whose paneId is unbound. Leave sibling synthetics alone.

Add a regression test that drives two panes with the same agent type, fires a Stop hook from one of them, and asserts the other synthetic survives with its original paneId.

This commit ships independently of the rest of the feature. If we revert any later commit, C0 stays.

### C1 — Server emits `panes` (invisible change)

In `scanAllTmuxPaneAgents` (renamed to `scanAllTmuxPanes`), extend the `tmux list-panes -a -F` format to include `#{window_id}|#{window_activity_flag}|#{pane_current_path}`. Stop the `matchProcessTreeFast` filter — keep all panes except sidebar panes (existing filter retained).

For each pane, call `getGitInfo(paneCurrentPath)` (already 5s-cached) to populate `branch`.

In `broadcastState()` (around `packages/runtime/src/server/index.ts:574`), build the per-session `panes: PaneRow[]` array. After tracker's per-session agent state is resolved, walk the agents and build `Map<paneId, AgentEvent>`, then stamp `pane.agent` from the map. Linear pass.

Add `panes` to `SessionData` in `packages/runtime/src/shared.ts`. Default to `[]` for snapshots that predate this commit.

No render changes — TUI still iterates `session.agents`. State endpoint now carries the new field; tests assert it.

### C2 — Focused card uses `panes` for the single-pane case

In `apps/tui/src/index.tsx` `SessionCard` focused body, replace the `For each={agents()}` loop with `For each={singlePaneWindows()}`. For each pane in a single-pane window:

- Line 1: existing `AgentListItem` layout (✕ dismiss, window name, `#threadHash`, status icon). Only render dismiss for panes that have an `agent`.
- Line 2: `└ <branch> @ <worktreeLeaf>` in dim. If `branch` is empty, render `└ <worktreeLeaf>` only.

Drop the session-level branch chip render at `apps/tui/src/index.tsx:2213-2227`. `session.branch` stays on the type.

`AgentListItem` is renamed `PaneRowItem` and takes a `PaneRow` instead of `AgentEvent`. Its existing status/icon logic gates on `pane.agent` being present.

Multi-pane windows fall through to a placeholder render in this commit — they're addressed in C4. For C2, a multi-pane window renders one row per pane with no grouping, matching today's behavior.

### C3 — Non-Claude panes shown

`PaneRowItem` learns the no-agent state:
- Status icon: dim `·` (a new tier in `vocab.ts`).
- Thread-hash slot: `(<paneCurrentCommand>)` in dim.
- Dismiss `✕` hidden — there's no agent to dismiss.
- Line 2 unchanged (`└ branch @ leaf`).

This commit is mostly visual; the data is already in `panes` after C1.

### C4 — Window header grouping + activity flag

For every window in the session, emit a header row:

```
▸ <windowName>           <activityGlyph?>
```

`▸` is dim. `<activityGlyph>` is a dim teal `●` when any pane in the window has `windowActivityFlag === true`; absent otherwise.

Under each header, emit the panes as leaves using tree ticks: `├` for non-last pane in window, `└` for last.

Sort: by `windowId` (matches tmux insertion order).

The single-pane render from C2 is replaced by the uniform tree shape — single-pane windows get a header + one `└` leaf. Vertical space cost increases (~2× current); accepted.

`monitor-activity` must be enabled in tmux.conf for the flag to be set. The plugin's `tcm.tmux` boot script runs `tmux set-option -g monitor-activity on` if not already set. Idempotent.

## Commit sequence

| # | Commit | Visible? | Independently revertable? |
|---|--------|----------|---------------------------|
| C0 | `fix(runtime): scope synthetic-merge cleanup to matching paneId` | No (bug fix) | Yes |
| C1 | `feat(runtime): emit per-pane sidebar data` | No (data plumbing) | Yes |
| C2 | `feat(tui): per-row branch + worktree, drop session branch chip` | Yes | Yes |
| C3 | `feat(tui): show non-Claude panes` | Yes | Yes |
| C4 | `feat(tui): group panes by window, surface activity flag` | Yes | Yes |

Each commit passes typecheck and the runtime test suite. Each can be reverted without breaking the others.

## Risks & open notes

- **`windowActivityFlag` semantics.** tmux clears the flag on its own when the user views the window. We snapshot it once per pane scan tick; brief races are tolerable. If the flag flickers visibly, debounce render-side.
- **Pane scan throughput.** Removing the agent-filter doesn't change the tmux call count (still one `list-panes -a`). `getGitInfo` is cached. Net effect: a few extra forks per unique cwd per 5s.
- **Worktree leaf collisions.** Two different worktrees with the same basename render identically. Live with it for now; if it bites, fall back to a longer suffix.
- **`OtherSessionRow` parity.** Out of scope, but a follow-up should derive rollups from `panes` so we can eventually retire `agents` from the wire format. Tracked as tech debt.

## Testing

- C0: regression test in `packages/runtime/test/agent-tracker.test.ts` — two pane-keyed synthetics, watcher Stop for one, sibling survives.
- C1: snapshot tests on `broadcastState()` output assert `panes` shape and attachment.
- C2-C4: TUI changes verified manually via `tcm-restart`. No render tests today; not introducing one for this pass.
