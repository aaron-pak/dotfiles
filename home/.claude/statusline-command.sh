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

# Effort level — env var takes precedence, then settings.json
effort="${CLAUDE_CODE_EFFORT_LEVEL:-}"
if [ -z "$effort" ]; then
    settings_file="$HOME/.claude/settings.json"
    if [ -f "$settings_file" ]; then
        effort=$(jq -r '.effortLevel // "auto"' "$settings_file" 2>/dev/null)
    fi
fi
effort="${effort:-auto}"

case "$effort" in
    low)  effort_icon="○"; effort_color="\033[34m" ;;
    medium|auto) effort_icon="◑"; effort_color="\033[33m" ;;
    high) effort_icon="●"; effort_color="\033[32m" ;;
    max)  effort_icon="✦"; effort_color="\033[35m" ;;
    xhigh) effort_icon="◉"; effort_color="\033[95m" ;;
    *)    effort_icon="○"; effort_color="\033[2m" ;;
esac

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
line1="\033[38;2;217;119;87m${model}\033[0m ${effort_color}${effort_icon} ${effort}\033[0m \033[2m|\033[0m \033[36m${dir}\033[0m"
[ -n "$git_info" ] && line1="${line1} ${git_info}"
line1="${line1} \033[2m|\033[0m ${bar_color}${bar} ${pct}%\033[0m"

# Rate limits (claude.ai subscription — only present after first API response)
# One pie glyph per limit (○ ◔ ◑ ◕ ●); calm thresholds: green <75 / yellow 75–89 / red 90+
five_pct=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
week_pct=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')

rl_color() {
    if [ "$1" -ge 90 ]; then printf '%s' '\033[31m'
    elif [ "$1" -ge 75 ]; then printf '%s' '\033[33m'
    else printf '%s' '\033[32m'
    fi
}

pie() {
    local q=$(( ($1 + 12) / 25 ))
    [ "$q" -gt 4 ] && q=4
    case "$q" in
        0) printf '○' ;;
        1) printf '◔' ;;
        2) printf '◑' ;;
        3) printf '◕' ;;
        4) printf '●' ;;
    esac
}

rate_info=""
if [ -n "$five_pct" ]; then
    five_int=$(printf '%.0f' "$five_pct")
    fc=$(rl_color "$five_int")
    fd="${fc/\\033[/\\033[2;}"   # label: dim echo of the value's status color
    rate_info="${fd}5h\033[0m ${fc}$(pie "$five_int") ${five_int}%\033[0m"
fi
if [ -n "$week_pct" ]; then
    week_int=$(printf '%.0f' "$week_pct")
    wc=$(rl_color "$week_int")
    wd="${wc/\\033[/\\033[2;}"
    [ -n "$rate_info" ] && rate_info="${rate_info} \033[2m·\033[0m "
    rate_info="${rate_info}${wd}7d\033[0m ${wc}$(pie "$week_int") ${week_int}%\033[0m"
fi

# --- Line 2: vim | lines | cost | duration | rate limits ---
line2="  "
[ -n "$vim_info" ] && line2="${line2}${vim_info} \033[2m|\033[0m "
[ -n "$lines_info" ] && line2="${line2}${lines_info} \033[2m|\033[0m "
line2="${line2}\033[2;33m${cost_fmt}\033[0m \033[2m|\033[0m \033[2;35m${mins}m ${secs}s\033[0m"
[ -n "$rate_info" ] && line2="${line2} \033[2m|\033[0m ${rate_info}"

printf '%b\n%b\n' "$line1" "$line2"
