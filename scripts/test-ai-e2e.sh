#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() {
  printf 'AI E2E failed: %s\n' "$1" >&2
  exit 1
}

require_contains() {
  local haystack="$1"
  local needle="$2"
  if [[ "$haystack" != *"$needle"* ]]; then
    fail "expected output to contain: $needle"
  fi
}

require_symlink() {
  local path_value="$1"
  [[ -L "$path_value" ]] || fail "expected symlink: $path_value"
}

require_absent() {
  local path_value="$1"
  [[ ! -e "$path_value" && ! -L "$path_value" ]] ||
    fail "expected path to be absent: $path_value"
}

require_file_contains() {
  local path_value="$1"
  local needle="$2"
  grep -F "$needle" "$path_value" >/dev/null ||
    fail "expected $path_value to contain: $needle"
}

command -v stow >/dev/null 2>&1 || fail "stow is required on PATH"
command -v rsync >/dev/null 2>&1 || fail "rsync is required on PATH"
command -v python3 >/dev/null 2>&1 || fail "python3 is required on PATH"

[[ -x "$repo_root/dot" ]] || fail "built dot binary not found at $repo_root/dot"

tmp_root="$(mktemp -d "${TMPDIR:-/tmp}/dot-ai-e2e.XXXXXX")"
trap 'rm -rf "$tmp_root"' EXIT

temp_repo="$tmp_root/repo"
home_a="$tmp_root/home-a"
home_b="$tmp_root/home-b"
dummy_skill_name="000-e2e-$RANDOM"

printf 'Creating isolated AI E2E workspace in %s\n' "$tmp_root"

mkdir -p "$temp_repo"
rsync -a --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '.DS_Store' \
  "$repo_root/" "$temp_repo"/

cp "$repo_root/dot" "$temp_repo/dot"
cp \
  "$repo_root/ai/state.toml" \
  "$repo_root/ai/claude-settings-shared.json" \
  "$repo_root/ai/codex-settings-shared.toml" \
  "$temp_repo/ai/"

shared_claude_skill="$(
  python3 - "$temp_repo/ai/state.toml" claude <<'PY'
import sys
import tomllib

state_path = sys.argv[1]
target = sys.argv[2]

with open(state_path, "rb") as handle:
    data = tomllib.load(handle)

for name, skill in sorted(data.get("skills", {}).items()):
    targets = skill.get("targets", [])
    if target in targets:
        print(name)
        break
else:
    raise SystemExit(f"no managed skill targets {target}")
PY
)"

shared_codex_skill="$(
  python3 - "$temp_repo/ai/state.toml" codex <<'PY'
import sys
import tomllib

state_path = sys.argv[1]
target = sys.argv[2]

with open(state_path, "rb") as handle:
    data = tomllib.load(handle)

for name, skill in sorted(data.get("skills", {}).items()):
    targets = skill.get("targets", [])
    if target in targets:
        print(name)
        break
else:
    raise SystemExit(f"no managed skill targets {target}")
PY
)"

shared_codex_probe="$(
  python3 - "$temp_repo/ai/codex-settings-shared.toml" <<'PY'
import sys
import tomllib

settings_path = sys.argv[1]

with open(settings_path, "rb") as handle:
    data = tomllib.load(handle)

for key, value in data.items():
    if isinstance(value, dict):
        print(f"[{key}]")
        break
    if isinstance(value, str):
        print(f'{key} = "{value}"')
        break
    if isinstance(value, bool):
        print(f"{key} = {'true' if value else 'false'}")
        break
    print(f"{key} = {value}")
    break
else:
    raise SystemExit("no shared Codex settings found")
PY
)"

mkdir -p "$home_a/.claude" "$home_a/.codex" "$home_a/.config/dot"
mkdir -p "$home_b/.claude" "$home_b/.codex" "$home_b/.config/dot"

printf '{\"localOnly\":true}\n' >"$home_a/.claude/settings.json"
printf '{}\n' >"$home_b/.claude/settings.json"
printf 'projects = { "/tmp/example" = { trust_level = "trusted" } }\n' >"$home_a/.codex/config.toml"
: >"$home_b/.codex/config.toml"

run_dot() {
  local home_dir="$1"
  shift
  HOME="$home_dir" PATH="$PATH" "$temp_repo/dot" "$@"
}

printf 'Checking AI help output...\n'
help_output="$(run_dot "$home_a" ai help)"
require_contains "$help_output" "dot ai"
require_contains "$help_output" "dot ai skills"
require_contains "$help_output" "dot ai settings pull"

printf 'Running sync on machine A...\n'
sync_a_output="$(cd "$temp_repo" && run_dot "$home_a" sync)"
require_contains "$sync_a_output" "Created these managed skill links:"
require_contains "$sync_a_output" "Applied these shared Claude settings:"
require_contains "$sync_a_output" "Applied these shared Codex settings:"
require_symlink "$home_a/.claude/skills/$shared_claude_skill"
require_symlink "$home_a/.codex/skills/$shared_codex_skill"
require_file_contains "$home_a/.claude/settings.json" '"localOnly": true'
require_file_contains "$home_a/.claude/settings.json" '"permissions"'
require_file_contains "$home_a/.codex/config.toml" 'projects."/tmp/example"'
require_file_contains "$home_a/.codex/config.toml" "$shared_codex_probe"

printf 'Running sync on machine B...\n'
sync_b_output="$(cd "$temp_repo" && run_dot "$home_b" sync)"
require_contains "$sync_b_output" "Created these managed skill links:"
require_symlink "$home_b/.claude/skills/$shared_claude_skill"
require_symlink "$home_b/.codex/skills/$shared_codex_skill"
require_file_contains "$home_b/.claude/settings.json" '"permissions"'
require_file_contains "$home_b/.codex/config.toml" "$shared_codex_probe"

printf 'Adopting a dummy local Codex skill...\n'
mkdir -p "$home_a/.codex/skills/$dummy_skill_name"
printf '# %s\n\nDummy skill body.\n' "$dummy_skill_name" >"$home_a/.codex/skills/$dummy_skill_name/SKILL.md"
adopt_output="$(cd "$temp_repo" && run_dot "$home_a" ai skills adopt "$dummy_skill_name" --from codex --targets claude,codex)"
require_contains "$adopt_output" "Adopted managed skill \"$dummy_skill_name\""
require_file_contains "$temp_repo/ai/state.toml" "[skills.$dummy_skill_name]"
require_file_contains "$temp_repo/ai/state.toml" "canonical_dir = \"ai/skills/$dummy_skill_name\""
require_symlink "$home_a/.claude/skills/$dummy_skill_name"
require_symlink "$home_a/.codex/skills/$dummy_skill_name"
require_file_contains "$temp_repo/ai/skills/$dummy_skill_name/SKILL.md" "Dummy skill body."

printf 'Propagating the adopted skill to machine B...\n'
sync_b_with_dummy_output="$(cd "$temp_repo" && run_dot "$home_b" sync)"
require_contains "$sync_b_with_dummy_output" "Created these managed skill links:"
require_symlink "$home_b/.claude/skills/$dummy_skill_name"
require_symlink "$home_b/.codex/skills/$dummy_skill_name"

printf 'Exercising the interactive AI hub...\n'
python3 - "$temp_repo" "$home_a" <<'PY'
import os
import pty
import select
import subprocess
import sys
import time

repo = sys.argv[1]
home = sys.argv[2]
cmd = [os.path.join(repo, "dot"), "ai"]
env = os.environ.copy()
env["HOME"] = home

master, slave = pty.openpty()
proc = subprocess.Popen(cmd, cwd=repo, env=env, stdin=slave, stdout=slave, stderr=slave)
os.close(slave)
buffer = b""

def read_until(needle: str, timeout: float = 10.0) -> None:
    global buffer
    deadline = time.time() + timeout
    encoded = needle.encode()
    while encoded not in buffer:
        if proc.poll() is not None:
            raise SystemExit(f"process exited early while waiting for {needle!r}\n{buffer.decode(errors='ignore')}")
        remaining = max(0.0, deadline - time.time())
        ready, _, _ = select.select([master], [], [], remaining)
        if not ready:
            raise SystemExit(f"timeout waiting for {needle!r}\n{buffer.decode(errors='ignore')}")
        chunk = os.read(master, 4096)
        if not chunk:
            raise SystemExit(f"terminal closed while waiting for {needle!r}")
        buffer += chunk

read_until("What do you want to manage?")
proc.terminate()
try:
    proc.wait(timeout=1)
except subprocess.TimeoutExpired:
    proc.kill()
    proc.wait(timeout=5)
os.close(master)
PY

printf 'Exercising interactive skill retargeting...\n'
DOT_E2E_SKILL_NAME="$dummy_skill_name" python3 - "$temp_repo" "$home_a" <<'PY'
import os
import pty
import select
import subprocess
import sys
import time

repo = sys.argv[1]
home = sys.argv[2]
cmd = [os.path.join(repo, "dot"), "ai", "skills"]
env = os.environ.copy()
env["HOME"] = home

master, slave = pty.openpty()
proc = subprocess.Popen(cmd, cwd=repo, env=env, stdin=slave, stdout=slave, stderr=slave)
os.close(slave)
buffer = b""

def read_until(needle: str, timeout: float = 10.0) -> None:
    global buffer
    deadline = time.time() + timeout
    encoded = needle.encode()
    while encoded not in buffer:
        if proc.poll() is not None:
            raise SystemExit(f"process exited early while waiting for {needle!r}\n{buffer.decode(errors='ignore')}")
        remaining = max(0.0, deadline - time.time())
        ready, _, _ = select.select([master], [], [], remaining)
        if not ready:
            raise SystemExit(f"timeout waiting for {needle!r}\n{buffer.decode(errors='ignore')}")
        chunk = os.read(master, 4096)
        if not chunk:
            raise SystemExit(f"terminal closed while waiting for {needle!r}")
        buffer += chunk

read_until("Which managed skill do you want to edit?")
os.write(master, b"\n")
read_until(f"Manage targets for {os.environ['DOT_E2E_SKILL_NAME']}")
os.write(master, b"\n")
read_until(f"Updated {os.environ['DOT_E2E_SKILL_NAME']}: disabled Claude")
read_until("Current targets: Codex")
read_until(f"Manage targets for {os.environ['DOT_E2E_SKILL_NAME']}")
proc.terminate()
try:
    proc.wait(timeout=1)
except subprocess.TimeoutExpired:
    proc.kill()
    proc.wait(timeout=5)
os.close(master)
PY

require_absent "$home_a/.claude/skills/$dummy_skill_name"
require_symlink "$home_a/.codex/skills/$dummy_skill_name"
require_file_contains "$temp_repo/ai/state.toml" "[skills.$dummy_skill_name]"
require_file_contains "$temp_repo/ai/state.toml" 'targets = [ "codex" ]'

printf 'Propagating target changes to machine B...\n'
sync_b_after_output="$(cd "$temp_repo" && run_dot "$home_b" sync)"
require_contains "$sync_b_after_output" "Removed these managed skill links:"
require_contains "$sync_b_after_output" "~/.claude/skills/$dummy_skill_name"
require_symlink "$home_b/.codex/skills/$dummy_skill_name"
require_absent "$home_b/.claude/skills/$dummy_skill_name"

printf 'Checking no-op sync after convergence...\n'
sync_b_final_output="$(cd "$temp_repo" && run_dot "$home_b" sync)"
require_contains "$sync_b_final_output" "Managed skills already match this machine."
require_contains "$sync_b_final_output" "Shared Claude settings already match this machine. Nothing changed."
require_contains "$sync_b_final_output" "Shared Codex settings already match this machine. Nothing changed."

printf 'AI E2E passed in %s\n' "$tmp_root"
