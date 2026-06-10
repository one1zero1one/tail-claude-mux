#!/bin/sh
# Test runner for the tmux provider. Isolation MUST be established here,
# in the shell, before bun starts: Bun.spawnSync children inherit the env
# snapshot from process start, so setting TMUX_TMPDIR inside the test
# file does nothing. The test file's beforeAll guard double-checks this
# and refuses to run if the socket resolves outside TMUX_TMPDIR.
set -eu
cd "$(dirname "$0")/.."

SOCK_DIR="$(mktemp -d /tmp/tcm-provider-test.XXXXXX)"
trap 'tmux kill-server 2>/dev/null || true; rm -rf "$SOCK_DIR"' EXIT

unset TMUX
export TMUX_TMPDIR="$SOCK_DIR"
bun test "$@"
