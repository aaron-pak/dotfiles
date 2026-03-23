#!/bin/bash
# PostToolUse hook: typecheck CLI after editing .ts files
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [[ "$FILE_PATH" == */src/*.ts ]] || [[ "$FILE_PATH" == */tests/*.ts ]]; then
  bun run typecheck
fi
