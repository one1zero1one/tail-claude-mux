# Sidebar Visuals + Interaction Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the leading `✕` with a status glyph that carries state via color+shape, color window headers like the tmux status bar, indent panes under their window, and collapse the dual-panel keyboard model down to a single navigable list.

**Architecture:** One server-side data addition (`windowActive: boolean` on `PaneRow`, sourced from `#{window_active}`). All other work is in the TUI: a `paneStatus(pane)` helper that returns `{ glyph, color }`, restyled `WindowGroupHeader`, indented `PaneRowItem`, and a much smaller `useKeyboard` handler with `panelFocus` deleted.

**Tech Stack:** Bun + TypeScript, SolidJS via `@opentui/solid`, Catppuccin Mocha palette (`C` in `packages/runtime/src/shared.ts`), Nerd Font glyph constants in `apps/tui/src/vocab.ts`.

**Spec:** [`docs/superpowers/specs/2026-05-13-sidebar-visuals-design.md`](../specs/2026-05-13-sidebar-visuals-design.md)

**Predecessor commits:** `854c3ec` (prep commit) on branch `dani/per-session-overview`.

---

## File map

- **Modify:** `packages/runtime/src/shared.ts` — add `windowActive: boolean` to `PaneRow`.
- **Modify:** `packages/runtime/src/server/index.ts` — extend `scanAllTmuxPanes` format with `#{window_active}`; thread it through `PaneScan` and the `paneRows` map (~line 1281 and ~line 572).
- **Create:** `packages/runtime/test/pane-row-window-active.test.ts` — regression test that `windowActive` is a boolean on every `PaneRow`.
- **Modify:** `apps/tui/src/vocab.ts` — add `SEV_SHELL_RUNNING` (`◆` teal-meaning) for foreground non-shell commands.
- **Modify:** `apps/tui/src/index.tsx` — heavy edits:
  - Add `paneStatus(pane, spinIdx)` helper in the same file (private to the TUI; near `PaneRowItem`).
  - Rewrite `PaneRowItem` body: drop the leading dismiss `✕`, drop the trailing status, drop the `#hash` tail, prepend the new status glyph, add 2-col leading pad.
  - Restyle `WindowGroupHeader`: colored-pill background (teal=active, yellow=activity, plain otherwise) + revert the hide-when-name-matches `Show` guard at the call site (~line 2263).
  - Delete the `panelFocus` signal (~line 860), the reset `createEffect` (~line 1287), all `panelFocus()` reads in the `useKeyboard` handler (~lines 1340-1444), the prop on `SessionCardProps` (line 2068), and the three call sites (~lines 1486, 1531, 1594).
  - Collapse `useKeyboard` to only the surviving keys (`j/k`/arrows/Enter/`r`/`?`/`q`).
  - Rewrite the footer hint (`~line 1634`) and the help modal contents (`~line 1739`).

---

## Task 1: Server — add `windowActive` to `PaneRow`

**Files:**
- Modify: `packages/runtime/src/shared.ts:5-14`
- Modify: `packages/runtime/src/server/index.ts:1267-1276` (PaneScan type)
- Modify: `packages/runtime/src/server/index.ts:1286` (tmux format)
- Modify: `packages/runtime/src/server/index.ts:1290-1302` (parse)
- Modify: `packages/runtime/src/server/index.ts:1329-1337` (push to scan result)
- Modify: `packages/runtime/src/server/index.ts:578-587` (map to PaneRow)
- Create: `packages/runtime/test/pane-row-window-active.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/runtime/test/pane-row-window-active.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import type { PaneRow } from "../src/shared";

describe("PaneRow.windowActive", () => {
  test("is a required boolean field", () => {
    const row: PaneRow = {
      paneId: "%1",
      windowId: "@1",
      windowName: "work",
      windowActivityFlag: false,
      windowActive: false,
      paneCurrentCommand: "zsh",
      paneCurrentPath: "/tmp",
    };
    expect(typeof row.windowActive).toBe("boolean");
  });

  test("PaneRow without windowActive is a type error", () => {
    // @ts-expect-error windowActive is required
    const row: PaneRow = {
      paneId: "%1",
      windowId: "@1",
      windowName: "work",
      windowActivityFlag: false,
      paneCurrentCommand: "zsh",
      paneCurrentPath: "/tmp",
    };
    expect(row.paneId).toBe("%1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails (type error)**

Run: `cd packages/runtime && bun test test/pane-row-window-active.test.ts`
Expected: tsc-style fail — "Property 'windowActive' is missing in type" on the first object literal (because `PaneRow` doesn't have the field yet).

- [ ] **Step 3: Add the field to `PaneRow`**

Edit `packages/runtime/src/shared.ts:5-14`. The new interface:

```typescript
export interface PaneRow {
  paneId: string;
  windowId: string;
  windowName: string;
  windowActivityFlag: boolean;
  windowActive: boolean;
  paneCurrentCommand: string;
  paneCurrentPath: string;
  branch?: string;
  agent?: AgentEvent;
}
```

- [ ] **Step 4: Extend the tmux format and the parser**

Edit `packages/runtime/src/server/index.ts:1286` — append `|#{window_active}` to the format string. New line:

```typescript
      "-F", "#{session_name}|#{pane_id}|#{pane_pid}|#{pane_current_command}|#{window_id}|#{window_name}|#{window_activity_flag}|#{pane_current_path}|#{window_active}",
```

Then edit the parser at lines 1290-1302 to capture `parts[8]`. The new shape:

```typescript
    const panes = raw.split("\n").filter(Boolean).map((line) => {
      const parts = line.split("|");
      return {
        session: parts[0] ?? "",
        paneId: parts[1] ?? "",
        pid: parseInt(parts[2] ?? "0", 10),
        cmd: parts[3] ?? "",
        windowId: parts[4] ?? "",
        windowName: parts[5] ?? "",
        windowActivityFlag: parts[6] === "1",
        paneCurrentPath: parts[7] ?? "",
        windowActive: parts[8] === "1",
      };
    });
```

- [ ] **Step 5: Extend the `PaneScan` type**

Edit `packages/runtime/src/server/index.ts:1267-1276` — add `windowActive: boolean;`:

```typescript
  type PaneScan = {
    paneId: string;
    windowId: string;
    windowName: string;
    windowActivityFlag: boolean;
    windowActive: boolean;
    paneCurrentCommand: string;
    paneCurrentPath: string;
    /** Agent name if process-tree match found, else undefined. */
    agent?: string;
  };
```

- [ ] **Step 6: Push `windowActive` into the scan result**

Edit `packages/runtime/src/server/index.ts:1329-1337`:

```typescript
      sessionPanes.push({
        paneId: pane.paneId,
        windowId: pane.windowId,
        windowName: pane.windowName,
        windowActivityFlag: pane.windowActivityFlag,
        windowActive: pane.windowActive,
        paneCurrentCommand: pane.cmd,
        paneCurrentPath: pane.paneCurrentPath,
        agent,
      });
```

- [ ] **Step 7: Map `windowActive` into the `PaneRow` payload**

Edit `packages/runtime/src/server/index.ts:578-587`:

```typescript
      const paneRows: PaneRow[] = sessionScan.map((scan) => ({
        paneId: scan.paneId,
        windowId: scan.windowId,
        windowName: scan.windowName,
        windowActivityFlag: scan.windowActivityFlag,
        windowActive: scan.windowActive,
        paneCurrentCommand: scan.paneCurrentCommand,
        paneCurrentPath: scan.paneCurrentPath,
        branch: getGitInfo(scan.paneCurrentPath).branch || undefined,
        agent: agentByPaneId.get(scan.paneId),
      }));
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd packages/runtime && bun test test/pane-row-window-active.test.ts`
Expected: 2 pass, 0 fail.

- [ ] **Step 9: Run the full runtime test suite to confirm no regression**

Run: `cd packages/runtime && bun test`
Expected: all tests pass.

- [ ] **Step 10: Build check**

Run: `bun run build`
Expected: `Build complete!`, no type errors.

- [ ] **Step 11: Commit**

```bash
git add packages/runtime/src/shared.ts packages/runtime/src/server/index.ts packages/runtime/test/pane-row-window-active.test.ts
git commit -m "feat(runtime): surface windowActive on PaneRow

Add the tmux #{window_active} flag to scanAllTmuxPanes and propagate
it through PaneScan and PaneRow. The TUI uses this to color the
window-header pill teal for the active window."
```

---

## Task 2: TUI — add `SEV_SHELL_RUNNING` glyph

**Files:**
- Modify: `apps/tui/src/vocab.ts:28-33`

The status vocabulary calls for a teal `◆` on shell panes running a foreground command (anything other than `zsh`/`bash`/`fish`). Add it next to the other `SEV_*` constants.

- [ ] **Step 1: Look up the Nerd Font diamond glyph**

Run: `just glyph-search 'diamond' --prefix md | head -20`
Expected: a list of `md-*-diamond` glyph names with codepoints. Pick `md-rhombus` (`U+F0C0E`, a filled diamond) for shape clarity, or a similar simple solid diamond. To verify visually:

Run: `just glyph-render F0C0E && read -p "open /tmp/glyph-render.png and inspect, press enter when done"`

Then read the rendered PNG to confirm shape. If `F0C0E` looks wrong, repeat with another candidate from the search.

- [ ] **Step 2: Add the constant**

Edit `apps/tui/src/vocab.ts` — insert after `SEV_IDLE_DOT` (line 33):

```typescript
export const SEV_SHELL_RUNNING = "\u{F0C0E}"; // nf-md-rhombus — foreground command in a shell pane
```

- [ ] **Step 3: Build check**

Run: `bun run build`
Expected: `Build complete!`

- [ ] **Step 4: Commit**

```bash
git add apps/tui/src/vocab.ts
git commit -m "feat(tui): add SEV_SHELL_RUNNING glyph for foreground shell commands"
```

---

## Task 3: TUI — `paneStatus()` helper

Centralise the status-glyph + color logic in one helper so `PaneRowItem` stays small.

**Files:**
- Modify: `apps/tui/src/index.tsx` — add helper above `PaneRowItem` (around line 1939), import the new `SEV_SHELL_RUNNING` constant.

- [ ] **Step 1: Extend the vocab import**

Edit `apps/tui/src/index.tsx:24-29` to add `SEV_SHELL_RUNNING`:

```typescript
import {
  SEV_WORKING_SPINNER,
  SEV_WAITING,
  SEV_READY,
  SEV_STOPPED,
  SEV_ERROR,
  SEV_IDLE_DOT,
  SEV_SHELL_RUNNING,
```

- [ ] **Step 2: Add the helper**

Insert above `function PaneRowItem` (around line 1939):

```typescript
type PaneStatus = { glyph: string; color: string };

/** Map a pane (and current spinner frame) to the single leading glyph + color
 *  used at the head of each row. See spec "Status vocabulary" table. */
function paneStatus(
  pane: PaneRow,
  spinIdx: number,
  palette: ThemePalette,
): PaneStatus {
  const agent = pane.agent;
  if (agent) {
    if (agent.status === "running") {
      return { glyph: SEV_WORKING_SPINNER[spinIdx % SEV_WORKING_SPINNER.length]!, color: palette.blue };
    }
    if (agent.status === "waiting") return { glyph: SEV_WAITING, color: palette.yellow };
    if (agent.status === "error")   return { glyph: SEV_ERROR,   color: palette.red };
    // done / interrupted / idle — split by liveness
    if (agent.liveness === "alive") return { glyph: SEV_READY, color: palette.green };
    if (agent.liveness === "exited") return { glyph: SEV_STOPPED, color: palette.overlay0 };
    // unknown liveness — for terminal statuses lean stopped, otherwise ready
    if (agent.status === "done" || agent.status === "interrupted") {
      return { glyph: SEV_STOPPED, color: palette.overlay0 };
    }
    return { glyph: SEV_READY, color: palette.green };
  }
  // No agent — shell pane.
  const cmd = pane.paneCurrentCommand;
  const isDefaultShell = cmd === "zsh" || cmd === "bash" || cmd === "fish";
  if (isDefaultShell) return { glyph: SEV_IDLE_DOT, color: palette.overlay0 };
  return { glyph: SEV_SHELL_RUNNING, color: palette.teal };
}
```

- [ ] **Step 3: Build check**

Run: `bun run build`
Expected: `Build complete!`

- [ ] **Step 4: Commit**

```bash
git add apps/tui/src/index.tsx
git commit -m "feat(tui): extract paneStatus() helper for sidebar status glyphs

One function mapping pane → { glyph, color } that implements the
Status vocabulary table from the design spec. Not wired in yet."
```

---

## Task 4: TUI — rewrite `PaneRowItem` to use `paneStatus()`

Drop the leading dismiss `✕`, drop the trailing status icon, drop the `#hash` tail, drop the `label()` and `icon()` helpers (now subsumed by `paneStatus()`). Prepend the status glyph and add a 2-col leading pad.

**Files:**
- Modify: `apps/tui/src/index.tsx:1929-2054` (the entire `PaneRowItem`)

- [ ] **Step 1: Rewrite `PaneRowItem`**

Replace lines 1929-2054 with:

```typescript
interface PaneRowItemProps {
  pane: PaneRow;
  palette: Accessor<ThemePalette>;
  spinIdx: Accessor<number>;
  isKeyboardFocused: boolean;
  onFocusPane: () => void;
}

function PaneRowItem(props: PaneRowItemProps) {
  const P = () => props.palette();
  const [isFlash, setIsFlash] = createSignal(false);

  const isUnseen = () => props.pane.agent?.unseen === true;

  const status = () => paneStatus(props.pane, props.spinIdx(), P());

  // Unseen recolors the glyph to teal; the shape stays whatever it was.
  const glyphColor = () => (isUnseen() ? P().teal : status().color);

  const triggerFlash = () => {
    setIsFlash(true);
    setTimeout(() => setIsFlash(false), 150);
  };

  const bgColor = () => {
    if (isFlash()) return P().surface1;
    if (props.isKeyboardFocused) return P().surface0;
    return "transparent";
  };

  const label = () => {
    const agent = props.pane.agent;
    if (agent) return agent.threadName || "claude-code";
    return props.pane.paneCurrentCommand;
  };

  const truncatedLabel = () => {
    const raw = label();
    return raw.length > 18 ? raw.slice(0, 17) + "…" : raw;
  };

  return (
    <box flexDirection="column" flexShrink={0} onMouseDown={() => {
      appendFileSync("/tmp/tcm-tui-agent-click.log",
        `[${new Date().toISOString()}] clicked paneId=${props.pane.paneId} agent=${props.pane.agent?.agent ?? "(none)"}\n`);
      triggerFlash();
      props.onFocusPane();
    }}>
      <box
        flexDirection="row"
        backgroundColor={bgColor()}
        paddingLeft={2}
        paddingRight={1}
      >
        <text flexShrink={0}>
          <span style={{ fg: glyphColor() }}>{status().glyph}</span>
          <span>{" "}</span>
        </text>
        <text flexShrink={0}>
          <span style={{ fg: P().overlay0, attributes: DIM }}>{
            props.pane.agent ? "cc " : "sh "
          }</span>
        </text>
        <text flexGrow={1} truncate>
          <span style={{
            fg: isUnseen()
              ? P().teal
              : (props.isKeyboardFocused ? P().text : P().subtext1),
            attributes: props.isKeyboardFocused ? BOLD : undefined,
          }}>{truncatedLabel()}</span>
        </text>
      </box>
    </box>
  );
}
```

Note what's gone vs. before:
- `treeTick` prop removed (no `├`/`└` ticks on pane rows).
- `onDismiss` prop removed (no dismiss `✕`).
- `label()` / `icon()` / `color()` helpers replaced by `paneStatus()`.
- Trailing status icon (`<text flexShrink={0}><span style={{ fg: color() }}>{icon()}</span></text>`) gone.
- Trailing `#hash` `<Show when={props.pane.agent?.threadId}>` gone.
- Leading dismiss `✕` `<Show when={props.pane.agent}>...</Show>` gone.

- [ ] **Step 2: Update the call site to match the new props**

Edit `apps/tui/src/index.tsx:2270-2281` (the `PaneRowItem` invocation inside the `windowGroups` loop). Drop `treeTick` and `onDismiss`:

```tsx
                    <For each={panesInWindow}>
                      {(pane, i) => (
                        <PaneRowItem
                          pane={pane}
                          palette={() => P()}
                          spinIdx={props.spinIdx}
                          isKeyboardFocused={props.panelFocus() === "agents" && flatIndex(windowId, i()) === props.focusedAgentIdx()}
                          onFocusPane={() => props.onPaneFocus(pane)}
                        />
                      )}
                    </For>
```

(`panelFocus` is still on `SessionCardProps` here — Task 7 deletes it.)

- [ ] **Step 3: Drop the `onPaneDismiss` prop from `SessionCardProps`**

Find the `SessionCardProps` interface (`apps/tui/src/index.tsx` ~line 2060-2075). Remove the `onPaneDismiss` field. Then remove `onPaneDismiss={...}` from the three `SessionCard` call sites (`~lines 1486-1518`, `~1531-1556`, `~1594-1620`) — search for `onPaneDismiss` in `apps/tui/src/index.tsx` and delete every line.

Run: `grep -n onPaneDismiss apps/tui/src/index.tsx`
Expected after edits: no matches.

- [ ] **Step 4: Drop the `dismissFocusedAgent` function and any references**

Run: `grep -n dismissFocusedAgent apps/tui/src/index.tsx`

Delete the function definition and every call site. (One call site is in the `case "d":` branch in `useKeyboard` — that whole branch goes in Task 6, so it's fine to leave the call there for one step. If `dismissFocusedAgent` is also referenced elsewhere — e.g. the previous `onDismiss` prop wiring — delete those too.)

- [ ] **Step 5: Build check**

Run: `bun run build`
Expected: `Build complete!`. If a stray `onPaneDismiss` or `treeTick` reference still exists, fix and re-run.

- [ ] **Step 6: Visual smoke test**

Run: `bun run dev:server` in one terminal and `bun run dev:tui` in another (or whatever the user's normal launch is — see README).

Visually confirm:
- Each Claude row begins with a single colored status glyph (spinner / `?` / check / alert / stop / dot) followed by `cc ` and the threadName.
- Each shell row begins with `·` (idle) or the teal rhombus (foreground command) followed by `sh ` and the command name.
- No `✕` at the head of any row.
- No icon at the trailing edge of any row.
- No `#xxxx` hash on any row.

- [ ] **Step 7: Commit**

```bash
git add apps/tui/src/index.tsx
git commit -m "feat(tui): single leading status glyph on pane rows

Rewrite PaneRowItem to use the new paneStatus() helper. Drop the
leading dismiss button, trailing duplicate status, #hash tail, and
the per-row dismiss action. Pane rows are now: <glyph> <cc|sh>
<label>, indented 2 cols under the window header."
```

---

## Task 5: TUI — color the `WindowGroupHeader`

Pill it: teal bg + crust fg for the current tmux window, yellow bg + crust fg for windows with the activity flag, plain otherwise. Revert the hide-when-same-name guard.

**Files:**
- Modify: `apps/tui/src/index.tsx:1914-1927` (`WindowGroupHeader`)
- Modify: `apps/tui/src/index.tsx:2263-2269` (the call site — remove the `Show` guard, pass `windowActive`)

- [ ] **Step 1: Rewrite `WindowGroupHeader`**

Replace lines 1914-1927:

```typescript
function WindowGroupHeader(props: {
  windowName: string;
  windowActive: boolean;
  windowActivityFlag: boolean;
  palette: Accessor<ThemePalette>;
}) {
  const P = () => props.palette();

  const bg = () => {
    if (props.windowActive) return P().teal;
    if (props.windowActivityFlag) return P().yellow;
    return "transparent";
  };

  const fg = () => {
    if (props.windowActive || props.windowActivityFlag) return P().crust;
    return P().subtext1;
  };

  return (
    <box flexDirection="row">
      <text>
        <span style={{ fg: fg(), bg: bg() }}>{` ${props.windowName} `}</span>
      </text>
    </box>
  );
}
```

If `@opentui/solid`'s `span` style doesn't accept a `bg` key (the project may name it differently — e.g. `backgroundColor`), check the surrounding code for the right key and use that instead. Search: `grep -n "bg:" apps/tui/src/index.tsx | head -5`.

- [ ] **Step 2: Update the call site — remove the `Show` guard, pass `windowActive`**

Edit `apps/tui/src/index.tsx:2263-2269`. New shape:

```tsx
                    <WindowGroupHeader
                      windowName={panesInWindow[0]!.windowName}
                      windowActive={panesInWindow.some((p) => p.windowActive)}
                      windowActivityFlag={panesInWindow.some((p) => p.windowActivityFlag)}
                      palette={() => P()}
                    />
```

(The outer `<Show when={panesInWindow[0]!.windowName !== props.session.name}>` wrapper goes away — the colored pill is the hierarchy now, even when names match.)

- [ ] **Step 3: Build check**

Run: `bun run build`
Expected: `Build complete!`

- [ ] **Step 4: Visual smoke test**

Launch the TUI. Confirm:
- The current tmux window's header renders as a teal pill with dark text.
- A window with the activity flag (e.g. trigger by typing in a different window) renders as a yellow pill.
- Other window headers render plain (no background fill).
- Window headers always show, even when the window name matches the session name (no more disappearing header).

- [ ] **Step 5: Commit**

```bash
git add apps/tui/src/index.tsx
git commit -m "feat(tui): color window-header pill from tmux flags

Teal pill = #{window_active}, yellow pill = #{window_activity_flag},
plain otherwise. Matches the user's tmux status-bar colors. Revert
the hide-when-name-matches guard; the colored pill is now the
hierarchy."
```

---

## Task 6: TUI — collapse keybindings to the six survivors

Strip `tab`/`⇧tab`, `1`-`9`, `n`/`c`, `u`, `d`, `x`, `t`, `=`, `⌥↑↓`, `h`/`l` from `useKeyboard`. Rewrite the help modal and the footer hint.

**Files:**
- Modify: `apps/tui/src/index.tsx:1324-1446` (`useKeyboard` body)
- Modify: `apps/tui/src/index.tsx:1720-1766` (help modal)
- Modify: `apps/tui/src/index.tsx:1627-1660` (footer hint)

This is the largest deletion; do it in three small steps.

- [ ] **Step 1: Collapse `useKeyboard`**

Replace the body of `useKeyboard` starting at the comment `// --- Normal mode keybindings ---` (~line 1324) through the closing `});` (~line 1447). The surviving handler:

```typescript
    // --- Normal mode keybindings ---
    switch (key.name) {
      case "q":
        send({ type: "quit" });
        break;
      case "up":
      case "k":
        moveAgentFocus(-1);
        break;
      case "down":
      case "j":
        moveAgentFocus(1);
        break;
      case "return":
        activateFocusedAgent();
        break;
      case "r":
        send({ type: "refresh" });
        flash("refreshed");
        break;
      case "?":
        setModal("help");
        break;
    }
  });
```

What goes:
- The `⌥↑↓` reorder branch (lines ~1325-1332).
- `escape` panelFocus reset.
- `left`/`h` panelFocus reset.
- `right`/`l` panelFocus swap.
- `tab` cycle.
- `=` equalize-width.
- `t` theme picker.
- `u` show-all.
- `d` (both branches — `dismissFocusedAgent` and `hide-session`).
- `x` (both branches — `killFocusedAgentPane` and `confirm-kill`).
- `n`/`c` new-session.
- The `key.number` default branch (jump-to-session 1-9).

Also the modal-handling early returns at the top of the handler — `theme-picker`, `confirm-kill` — keep them for now if they're used by anything else, **but**: the `confirm-kill` modal is only opened from the deleted `x` branch; the `theme-picker` modal only from the deleted `t` branch. So after deletion both modals are unreachable. Delete the modal handling for both. The handler shape becomes:

```typescript
  useKeyboard((key) => {
    const currentModal = modal();

    // --- Help modal: any key dismisses ---
    if (currentModal === "help") {
      setModal("none");
      return;
    }

    // --- Normal mode keybindings ---
    switch (key.name) {
      case "q":
        send({ type: "quit" });
        break;
      case "up":
      case "k":
        moveAgentFocus(-1);
        break;
      case "down":
      case "j":
        moveAgentFocus(1);
        break;
      case "return":
        activateFocusedAgent();
        break;
      case "r":
        send({ type: "refresh" });
        flash("refreshed");
        break;
      case "?":
        setModal("help");
        break;
    }
  });
```

- [ ] **Step 2: Build & fix orphan references**

Run: `bun run build`

Expected fail list — fix each by deleting the now-unused function or removing the now-dead site. Common orphans:
- `dismissFocusedAgent`, `killFocusedAgentPane`, `createNewSession`, `switchToSession` (only if no other site uses it — keep if mouse handlers do), `setKillTarget`, `killTarget`, `themeBeforePreview`.
- The `<Show when={modal() === "theme-picker"}>` block (~line 1664).
- The `<Show when={modal() === "confirm-kill"}>` block (~line 1686).
- The `ThemePicker` component definition (~line 1780+).

Run `grep -n` for each suspect identifier; if zero call sites remain, delete the definition.

Run: `bun run build` again. Expected: `Build complete!`

- [ ] **Step 3: Rewrite the help modal contents**

Edit `apps/tui/src/index.tsx:1739-1761`. The new list:

```tsx
            {([
              ["j/k", "navigate panes"],
              ["⏎", "focus pane"],
              ["r", "refresh"],
              ["?", "this help"],
              ["q", "quit"],
            ] as const).map(([k, v]) => (
              <text>
                <span style={{ fg: P().text }}>{k.padEnd(7)}</span>
                <span style={{ fg: P().subtext0 }}>{v}</span>
              </text>
            ))}
```

- [ ] **Step 4: Rewrite the footer hint**

Edit `apps/tui/src/index.tsx:1627-1660`. Replace the whole `(() => { ... })()` IIFE with a fixed footer:

```tsx
      {/* Footer */}
      {(() => {
        const keyFg = () => paneFocused() ? P().subtext0 : P().surface2;
        const labelFg = () => paneFocused() ? P().overlay1 : P().surface2;
        return (
          <box flexDirection="column" paddingLeft={1} paddingBottom={1} paddingTop={0} flexShrink={0}>
            <box height={1}><text style={{ fg: paneFocused() ? P().overlay0 : P().surface2 }}>{"─".repeat(200)}</text></box>
            <text>
              <span style={{ fg: keyFg() }}>{"⏎"}</span>
              <span style={{ fg: labelFg() }}>{" focus  "}</span>
              <span style={{ fg: keyFg() }}>{"r"}</span>
              <span style={{ fg: labelFg() }}>{" refresh  "}</span>
              <span style={{ fg: keyFg() }}>{"?"}</span>
              <span style={{ fg: labelFg() }}>{" help"}</span>
            </text>
          </box>
        );
      })()}
```

- [ ] **Step 5: Build check**

Run: `bun run build`
Expected: `Build complete!`

- [ ] **Step 6: Visual smoke test**

Launch the TUI. Confirm:
- `j`/`k`/arrows move keyboard focus through pane rows.
- `↩` focuses the pane in tmux (visible: the corresponding tmux pane gets activated).
- `r` refreshes (flash hint appears briefly).
- `?` opens the help modal; any key closes it; help lists only `j/k`, `⏎`, `r`, `?`, `q`.
- `q` quits.
- Pressing `t`, `d`, `x`, `n`, `tab`, `1-9` does nothing.

- [ ] **Step 7: Commit**

```bash
git add apps/tui/src/index.tsx
git commit -m "feat(tui): collapse keybindings to navigate+activate+help+quit

Drop the keys that are no-ops under lock-to-local: session
cycle/jump (tab, 1-9), session lifecycle (n/c/d/x/u), reorder,
width, theme picker, panel-mode swap (h/l/escape). Update the
help modal and footer hint to list only the surviving keys."
```

---

## Task 7: TUI — delete the `panelFocus` dual-panel model

The keyboard handler no longer reads `panelFocus`, but the signal still exists and gates rendering. Delete it everywhere.

**Files:**
- Modify: `apps/tui/src/index.tsx:860` (the signal declaration)
- Modify: `apps/tui/src/index.tsx:1286-1294` (the reset `createEffect`)
- Modify: `apps/tui/src/index.tsx:2068` (the `panelFocus` prop on `SessionCardProps`)
- Modify: `apps/tui/src/index.tsx:1486, 1531, 1594` (the three `SessionCard` call sites)
- Modify: `apps/tui/src/index.tsx:2277` (the `isKeyboardFocused` derivation inside the pane loop)

- [ ] **Step 1: Find every site that mentions `panelFocus`**

Run: `grep -n "panelFocus\|setPanelFocus\|PanelFocus" apps/tui/src/index.tsx`

Make a checklist of every line. Expected list (after Task 6's deletions): the signal declaration, the type alias `PanelFocus`, the reset effect, the prop, the three call sites, the `isKeyboardFocused` derivation.

- [ ] **Step 2: Delete the signal + type**

At line 860, delete `const [panelFocus, setPanelFocus] = createSignal<PanelFocus>("sessions");`. Also delete the `PanelFocus` type alias (likely a few lines above).

- [ ] **Step 3: Delete the reset effect (and keep the `focusedAgentIdx` clamp)**

Edit lines 1286-1294. The reset-to-sessions branch goes; the index clamp stays:

```typescript
  // Clamp focused agent index when pane rows shrink.
  createEffect(() => {
    const data = focusedData();
    const rows = data?.paneRows ?? [];
    setFocusedAgentIdx((idx) => Math.min(idx, Math.max(0, rows.length - 1)));
  });
```

- [ ] **Step 4: Delete the prop from `SessionCardProps` and the three call sites**

Remove `panelFocus: Accessor<"sessions" | "agents">;` (or whatever the literal is) from `SessionCardProps` (~line 2068).

Remove `panelFocus={panelFocus}` from each of the three `SessionCard` call sites. After this, `grep -n panelFocus apps/tui/src/index.tsx` should only return the one remaining derivation inside the card body.

- [ ] **Step 5: Simplify the `isKeyboardFocused` derivation**

Edit `apps/tui/src/index.tsx:2277`. The current line is:

```tsx
isKeyboardFocused={props.panelFocus() === "agents" && flatIndex(windowId, i()) === props.focusedAgentIdx()}
```

Replace with:

```tsx
isKeyboardFocused={flatIndex(windowId, i()) === props.focusedAgentIdx()}
```

(Pane rows are always the navigable target now; no "sessions" mode to gate on.)

- [ ] **Step 6: Final sweep**

Run: `grep -n "panelFocus\|setPanelFocus\|PanelFocus" apps/tui/src/index.tsx`
Expected: no matches.

- [ ] **Step 7: Build check**

Run: `bun run build`
Expected: `Build complete!`

- [ ] **Step 8: Visual smoke test**

Launch the TUI. Confirm:
- On startup, keyboard focus is on the first pane row (not "in the session list").
- `j`/`k`/arrows move through pane rows; the focused row is visually distinguished (surface0 background, bold text).
- `↩` focuses the corresponding tmux pane.
- The previous "press `l` to enter the pane list, `h` to leave" flow is gone — there's nothing else to be focused on.

- [ ] **Step 9: Commit**

```bash
git add apps/tui/src/index.tsx
git commit -m "refactor(tui): delete panelFocus dual-panel model

Pane rows are always the navigable target; sessions are not a
separate keyboard panel anymore. Removes the panelFocus signal,
its reset effect, the SessionCardProps field, and the derived
isKeyboardFocused condition."
```

---

## Task 8: End-to-end visual smoke + commit pause for review

The plan is done. Do one full pass and stop.

- [ ] **Step 1: Cold launch**

Kill any running tcm processes:

```bash
pkill -f tcm || true
```

Launch fresh. Open at least three tmux windows in the session, one with an active Claude (`bun run …` or similar), one with `tail -f` running, one idle.

- [ ] **Step 2: Walk through the spec checklist**

For each section of `docs/superpowers/specs/2026-05-13-sidebar-visuals-design.md`, visually verify the rendered TUI matches:
- Status vocabulary — every glyph + color combo appears as described.
- Row layout — `<glyph> <type> <label>`, no trailing icon, no `#hash`, no `✕`.
- Window headers — teal pill for the current tmux window, yellow pill for one with activity, plain otherwise. Header is always present.
- Hierarchy — pane rows indented 2 cols under their header.
- Keybindings — only `j/k`/arrows/`↩`/`r`/`?`/`q` do anything; help and footer reflect.
- Mouse — click a pane row activates it.

- [ ] **Step 3: Cross-tab focus check**

In tmux, switch away from the current window. In the TUI, click a pane row in a different window. Expected: tmux switches to that window AND the pane gets focused (the `854c3ec` prep commit fix carries this).

- [ ] **Step 4: Final commit (only if any tweak was needed)**

If steps 1-3 surfaced any small issue, fix it and commit:

```bash
git commit -m "fix(tui): <one-line description of the tweak>"
```

If everything passed, no commit needed. Push (only when the user OKs):

```bash
# When user says go:
git push -u origin dani/per-session-overview
```

---

## Notes for the executing agent

- **Don't add tests beyond the one in Task 1.** The spec explicitly says C0-C4 set the policy: visual smoke after each step, no render tests.
- **Don't refactor adjacent code.** If you see something that looks improveable nearby, leave it. This redesign is already touching ~150 lines of `index.tsx`.
- **The `cc`/`sh` two-char prefix stays.** The user approved the brainstorm mockups that show it. An advisor pass suggested dropping it; the user's prior approval wins.
- **If a build fails after a step,** read the error, fix the immediate cause (likely an orphan reference from the previous deletion), and re-run. Don't roll back the step.
- **If a visual smoke step reveals the glyph rendering wrong** (e.g. `SEV_SHELL_RUNNING` looks bad in the user's font), pause and surface it. Don't pick a different glyph silently — the user has strong opinions and a `glyph` tool for this exact case.
