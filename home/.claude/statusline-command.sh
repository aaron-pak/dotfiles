#!/bin/bash

input=$(cat)

# Extract fields using proper API fields from docs
session=$(echo "$input" | jq -r '.session_id // ""')
cwd=$(echo "$input" | jq -r '.workspace.current_dir // "."')
dir=$(basename "$cwd")
model=$(echo "$input" | jq -r '.model.display_name // "unknown"')

# Cost fields (provided directly by Claude Code)
cost=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')
duration_ms=$(echo "$input" | jq -r '.cost.total_duration_ms // 0')
lines_added=$(echo "$input" | jq -r '.cost.total_lines_added // 0')
lines_removed=$(echo "$input" | jq -r '.cost.total_lines_removed // 0')

# Context window
pct=$(echo "$input" | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)

# Git branch — green [branch] clean, yellow [branch*] dirty (original colors)
git_info=""
if git -C "$cwd" rev-parse --git-dir >/dev/null 2>&1; then
    branch=$(git -C "$cwd" --no-optional-locks branch --show-current 2>/dev/null || echo "detached")
    if ! git -C "$cwd" --no-optional-locks diff --quiet 2>/dev/null || ! git -C "$cwd" --no-optional-locks diff --cached --quiet 2>/dev/null; then
        git_info="\033[33m[${branch}*]\033[0m"
    else
        git_info="\033[32m[${branch}]\033[0m"
    fi
fi

# Lines changed
lines_info=""
if [ "$lines_added" -gt 0 ] || [ "$lines_removed" -gt 0 ]; then
    lines_info="\033[2;32m+${lines_added}\033[0m\033[2m/\033[0m\033[2;31m-${lines_removed}\033[0m"
fi

# Vim mode
vim_info=""
vim_mode=$(echo "$input" | jq -r '.vim.mode // empty')
if [ -n "$vim_mode" ]; then
    case "$vim_mode" in
        INSERT) vim_info="\033[32mINSERT\033[0m" ;;
        VISUAL) vim_info="\033[36mVISUAL\033[0m" ;;
        *)      vim_info="\033[34mNORMAL\033[0m" ;;
    esac
fi

# Context progress bar — color-coded green/yellow/red
if [ "$pct" -ge 80 ]; then
    bar_color="\033[31m"
elif [ "$pct" -ge 50 ]; then
    bar_color="\033[33m"
else
    bar_color="\033[32m"
fi

bar_width=10
filled=$((pct * bar_width / 100))
empty=$((bar_width - filled))
bar=""
[ "$filled" -gt 0 ] && bar=$(printf "%${filled}s" | tr ' ' '●')
[ "$empty" -gt 0 ] && bar="${bar}$(printf "%${empty}s" | tr ' ' '○')"

# Duration formatting
duration_sec=$((duration_ms / 1000))
mins=$((duration_sec / 60))
secs=$((duration_sec % 60))

# Cost formatting
cost_fmt=$(printf '$%.2f' "$cost")

# --- Line 1: model | directory [branch] | lines | vim ---
line1="\033[38;2;217;119;87m${model}\033[0m \033[2m|\033[0m \033[36m${dir}\033[0m"
[ -n "$git_info" ] && line1="${line1} ${git_info}"
line1="${line1} \033[2m|\033[0m ${bar_color}${bar} ${pct}%\033[0m"

# --- Line 2: vim | cost | duration | lines ---
line2="  "
[ -n "$vim_info" ] && line2="${line2}${vim_info} \033[2m|\033[0m "
[ -n "$lines_info" ] && line2="${line2}${lines_info} \033[2m|\033[0m "
line2="${line2}\033[2;33m${cost_fmt}\033[0m \033[2m|\033[0m \033[2;35m${mins}m ${secs}s\033[0m"

printf '%b\n%b\n' "$line1" "$line2"
