#!/bin/bash
# PostToolUse hook: typecheck CLI after editing .ts files in cli/
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [[ "$FILE_PATH" == */cli/src/*.ts ]] || [[ "$FILE_PATH" == */cli/tests/*.ts ]]; then
  cd cli && bun run typecheck
fi
