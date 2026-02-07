#!/bin/bash
# PostToolUse hook: format CLI .ts files after edit
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [[ "$FILE_PATH" == */cli/src/*.ts ]] || [[ "$FILE_PATH" == */cli/tests/*.ts ]]; then
  bun format 2>/dev/null || true
fi
