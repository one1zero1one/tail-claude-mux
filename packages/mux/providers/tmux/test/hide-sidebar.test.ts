import { describe, test, expect, beforeAll, beforeEach, afterAll } from "bun:test";

// ─── Socket isolation guard ──────────────────────────────────────────────
// These tests run tmux commands that create and kill sessions. They MUST
// run against a throwaway tmux server, never the user's real one.
//
// The provider spawns `tmux` with inherited env, so isolation works via
// TMUX_TMPDIR — but it must be exported BEFORE the bun process starts:
// Bun.spawnSync does NOT see runtime mutations of process.env (children
// get the env snapshot from process start). Mutating process.env here
// would silently leave every tmux call pointed at the REAL server.
// That is exactly how an earlier version of this test killed a live
// tmux server with all its panes. Run via test/run.sh, which exports
// TMUX_TMPDIR and unsets TMUX before invoking `bun test`.
//
// The guard below verifies isolation empirically and aborts the whole
// file before any destructive command if it doesn't hold.

const STASH = "_tcm_stash";

function sh(args: string[]): { out: string; err: string; code: number } {
  const r = Bun.spawnSync(["tmux", ...args], { stdout: "pipe", stderr: "pipe" });
  return { out: r.stdout.toString().trim(), err: r.stderr.toString().trim(), code: r.exitCode };
}

let isolated = false;

beforeAll(() => {
  const tmpdirEnv = process.env.TMUX_TMPDIR ?? "";
  if (!tmpdirEnv || process.env.TMUX) {
    throw new Error(
      "REFUSING TO RUN: needs TMUX_TMPDIR set (and TMUX unset) before bun starts. Run via test/run.sh.",
    );
  }
  // Start a server on whatever socket tmux actually resolves, then ask it
  // where its socket lives. Creating a session is harmless on any server;
  // killing is what we gate.
  sh(["new-session", "-d", "-s", "_tcm_isolation_guard", "-x", "80", "-y", "24"]);
  const sock = sh(["display-message", "-p", "#{socket_path}"]).out;
  if (!sock.startsWith(tmpdirEnv + "/")) {
    sh(["kill-session", "-t", "_tcm_isolation_guard"]);
    throw new Error(
      `REFUSING TO RUN: tmux socket is ${sock}, outside TMUX_TMPDIR=${tmpdirEnv} — env did not propagate; this is the REAL server.`,
    );
  }
  isolated = true;
});

afterAll(() => {
  if (isolated) sh(["kill-server"]);
});

import { TmuxProvider } from "../src/provider";

function listPanes(target: string): string[] {
  const r = sh(["list-panes", "-s", "-t", target, "-F", "#{pane_id} #{pane_title}"]);
  return r.code === 0 && r.out ? r.out.split("\n") : [];
}

/** Reset to: one `main` session with one shell pane plus one marked
 *  sidebar pane, no stash session. Returns the sidebar's pane id. */
function setupMainSession(): string {
  if (!isolated) throw new Error("isolation guard did not pass");
  // Kill only the named test sessions — the guard session keeps the test
  // server alive across tests (kill-server here races the new-session
  // that follows it).
  sh(["kill-session", "-t", "main"]);
  sh(["kill-session", "-t", STASH]);
  sh(["new-session", "-d", "-s", "main", "-x", "200", "-y", "50"]);
  return setupSidebarPane();
}

/** Split a new marked sidebar pane off the main session's first window. */
function setupSidebarPane(): string {
  const r = sh(["split-window", "-hb", "-l", "40", "-t", "main:", "-P", "-F", "#{pane_id}"]);
  const paneId = r.out;
  if (!paneId) throw new Error(`split-window produced no pane: ${r.err}`);
  sh(["select-pane", "-t", paneId, "-T", "tcm-sidebar"]);
  sh(["set-option", "-p", "-t", paneId, "@tcm-sidebar", "1"]);
  return paneId;
}

describe("hideSidebar", () => {
  let provider: TmuxProvider;
  let sidebarPane: string;

  beforeEach(() => {
    provider = new TmuxProvider();
    sidebarPane = setupMainSession();
  });

  test("stashes the pane when the stash session doesn't exist yet", () => {
    // Regression: ensureStash created the stash with a bootstrap shell
    // pane, pruneStashOrphans immediately killed it — destroying the
    // session — and join-pane then failed against a dead target. The
    // sidebar stayed visible while the server believed it was hidden.
    const ok = provider.hideSidebar(sidebarPane);

    expect(ok).toBe(true);
    const mainPanes = listPanes("main");
    expect(mainPanes.some((p) => p.startsWith(sidebarPane))).toBe(false);
    const stashPanes = listPanes(STASH);
    expect(stashPanes.some((p) => p.startsWith(sidebarPane))).toBe(true);
  });

  test("prunes the stash bootstrap shell pane after stashing", () => {
    provider.hideSidebar(sidebarPane);

    const stashPanes = listPanes(STASH);
    expect(stashPanes.length).toBe(1);
    expect(stashPanes[0]).toBe(`${sidebarPane} tcm-sidebar`);
  });

  test("returns false when the pane doesn't exist", () => {
    const ok = provider.hideSidebar("%9999");

    expect(ok).toBe(false);
  });

  test("stashes many panes without running out of space", () => {
    // Regression: joining every sidebar into one shared stash window
    // halves the target pane each time (99→49→…→1) — the 9th join dies
    // with "create pane failed: pane too small". A 9-window session is
    // a normal day, not an edge case.
    const hidden: string[] = [];
    for (let i = 0; i < 12; i++) {
      const ok = provider.hideSidebar(sidebarPane);
      expect(ok).toBe(true);
      hidden.push(sidebarPane);
      sidebarPane = setupSidebarPane();
    }

    const stashPanes = listPanes(STASH);
    for (const paneId of hidden) {
      expect(stashPanes.some((p) => p.startsWith(`${paneId} `))).toBe(true);
    }
  });

  test("stashes into an existing stash session with prior orphans", () => {
    // An orphan (non-sidebar title) already sits in the stash from an
    // earlier cycle — hide must still stash, and the orphan must go.
    sh(["new-session", "-d", "-s", STASH, "-x", "80", "-y", "24"]);

    const ok = provider.hideSidebar(sidebarPane);

    expect(ok).toBe(true);
    const stashPanes = listPanes(STASH);
    expect(stashPanes.length).toBe(1);
    expect(stashPanes[0]).toBe(`${sidebarPane} tcm-sidebar`);
  });
});
