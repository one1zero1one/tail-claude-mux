# tcm

> **This is a personal fork of [kylesnowschwartz/tail-claude-mux](https://github.com/kylesnowschwartz/tail-claude-mux).**
> All credit for the original concept, architecture, and the bulk of the code goes to Kyle.
> This fork tailors the sidebar to one very specific workflow — see "Why this fork" below.
> If you want the upstream tool, install Kyle's version. This one is opinionated and likely
> to diverge further over time.

A tmux sidebar I built for myself. **Personal tool — fork at your own risk.**

Shows the session list, agent state for Claude Code and pi, and the git branch for each session — in one small pane that lives inside your existing tmux workflow.

## Why this fork

I run a tight 1:1 mapping between **Ghostty windows / AeroSpace workspaces / tmux sessions** — each Ghostty window lives on its own AeroSpace workspace and attaches to one named tmux session. The names are aligned across all three layers so switching context is one AeroSpace shortcut, and the sidebar I'm looking at is always for the session I'm working in.

The upstream tcm assumes you cycle between sessions inside a single Ghostty/tmux client; this fork assumes you don't — you switch workspaces (AeroSpace) instead of sessions (tmux). That difference cascades into a bunch of small choices:

- **Lock-to-local session.** The focused-session cursor is pinned to the local session; cross-monitor sidebars don't drag each other around.
- **Per-pane tree.** The sidebar shows windows → panes → Claude/shell per window, instead of one row per agent. Two Claudes in the same tmux window render as two rows.
- **Status glyph at the front, not the end.** Every pane row starts with a single colored glyph carrying state (running / waiting / done / errored / stopped / shell-foreground / shell-idle). Window headers use the same color scheme as my tmux status bar: teal pill for the active window, yellow pill for activity.
- **Collapsed keybindings.** The session-management keybindings are gone (create, kill, hide, reorder, theme picker, etc.) since I do all of that in tmux/AeroSpace directly. The TUI keeps only `j/k` navigation, `↩` to focus a pane, `r` refresh, `?` help, `q` quit.
- **Threadname-from-rename.** `/rename` inside a Claude Code session propagates to the sidebar via the JSONL `custom-title` watcher (with a fix for a race where the hook fires before the JSONL is on disk).

Nothing here is criticism of upstream — these choices only make sense for my exact setup. The upstream design covers more ground.

## Install

Requires `tmux`, `bun`, and [TPM](https://github.com/tmux-plugins/tpm).

```tmux
set -g @plugin 'kylesnowschwartz/tail-claude-mux'
```

Reload tmux, run `~/.tmux/plugins/tpm/bin/install_plugins`, then open the sidebar with `prefix o → s`.

TPM clones the repo into `~/.tmux/plugins/tail-claude-mux/`. There is no standalone binary — `tcm` runs from that checkout against your local `bun`.

## Update

`prefix + U` (TPM update). The plugin auto-restarts the server so it picks up new code.

## Uninstall

Run the cleanup script **before** removing the plugin or you'll leak tmux hooks, keybindings, and panes:

```bash
sh ~/.tmux/plugins/tail-claude-mux/integrations/tmux-plugin/scripts/uninstall.sh
```

Then remove the `set -g @plugin` line from `~/.tmux.conf` and run `prefix + alt + u`.

## Docs

- [Get started in tmux](./docs/tutorials/get-started-in-tmux.md)
- [Configuration](./docs/reference/configuration.md)
- [Keybindings](./docs/reference/features-and-keybindings.md)
- [Programmatic API](./docs/reference/programmatic-api.md) — push status / progress / logs to the sidebar over HTTP
- [Internal contracts](./CONTRACTS.md)

## License

MIT — see [LICENSE](./LICENSE).
