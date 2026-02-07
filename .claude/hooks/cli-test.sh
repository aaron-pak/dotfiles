#!/bin/bash
# Stop hook: run CLI tests if any CLI .ts files have uncommitted changes
CHANGED=$(git diff --name-only HEAD -- 'cli/src/**/*.ts' 'cli/tests/**/*.ts' 2>/dev/null)
UNTRACKED=$(git ls-files --others --exclude-standard -- 'cli/src/' 'cli/tests/' 2>/dev/null | grep '\.ts$')

if [[ -n "$CHANGED" ]] || [[ -n "$UNTRACKED" ]]; then
  cd cli && bun run test --run
fi
