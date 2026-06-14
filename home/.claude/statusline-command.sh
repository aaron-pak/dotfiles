#!/bin/bash

input=$(cat)

# Extract fields using proper API fields from docs
session=$(echo "$input" | jq -r '.session_id // ""')
cwd=$(echo "$input" | jq -r '.workspace.current_dir // "."')
dir=$(basename "$cwd")
model=$(echo "$input" | jq -r '.model.display_name // "unknown"')

# Cost fields (provided directly by Claude Code)
cost=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')
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

# Lines changed — always shown (+0/-0 when none)
lines_info="\033[2;32m+${lines_added}\033[0m\033[2m/\033[0m\033[2;31m-${lines_removed}\033[0m"

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

# Pie glyph (○ ◔ ◑ ◕ ●) by percentage — shared by the context window and the usage limits
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

# Context window color — green/yellow/red
if [ "$pct" -ge 80 ]; then
    ctx_color="\033[31m"
elif [ "$pct" -ge 50 ]; then
    ctx_color="\033[33m"
else
    ctx_color="\033[32m"
fi

# Cost formatting
cost_fmt=$(printf '$%.2f' "$cost")

# --- Line 1: model · effort | directory [branch] | context% | lines changed ---
line1="\033[38;2;217;119;87m${model}\033[0m ${effort_color}${effort_icon} ${effort}\033[0m \033[2m|\033[0m \033[36m${dir}\033[0m"
[ -n "$git_info" ] && line1="${line1} ${git_info}"
line1="${line1} \033[2m|\033[0m ${ctx_color}$(pie "$pct") ${pct}%\033[0m"
line1="${line1} \033[2m|\033[0m ${lines_info}"

# Rate limits (claude.ai subscription — only present after first API response)
# One pie glyph per limit (○ ◔ ◑ ◕ ●); calm thresholds: green <75 / yellow 75–89 / red 90+
five_pct=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
week_pct=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')
five_reset=$(echo "$input" | jq -r '.rate_limits.five_hour.resets_at // empty')
week_reset=$(echo "$input" | jq -r '.rate_limits.seven_day.resets_at // empty')

rl_color() {
    if [ "$1" -ge 90 ]; then printf '%s' '\033[31m'
    elif [ "$1" -ge 75 ]; then printf '%s' '\033[33m'
    else printf '%s' '\033[32m'
    fi
}

# Time left until a window resets, from a Unix epoch (seconds). Compact: 5d 3h / 2h 14m / 47m.
countdown() {
    [ -z "$1" ] && return
    local now remaining d h m
    now=$(date +%s)
    remaining=$(( $1 - now ))
    [ "$remaining" -le 0 ] && { printf 'now'; return; }
    d=$(( remaining / 86400 ))
    h=$(( (remaining % 86400) / 3600 ))
    m=$(( (remaining % 3600) / 60 ))
    if   [ "$d" -gt 0 ]; then printf '%dd %dh' "$d" "$h"
    elif [ "$h" -gt 0 ]; then printf '%dh %dm' "$h" "$m"
    else printf '%dm' "$m"
    fi
}

# Layout — variant K:  5h · ◕ 82% · ↻ 1h 40m | 7d · ○ 12% · ↻ 5d 3h
# label (dim status color) · glyph+% (status color) · ↻ reset, windows joined by |.
# Separators and the reset use dimmed default foreground (\033[2m) so they track the terminal
# theme — a hardcoded grey read as off-palette (too cool and too bright) against a warm theme.
rsep='\033[2m'   # · inner and | window separators
rrst='\033[2m'   # ↻ reset countdown
rate_info=""
if [ -n "$five_pct" ]; then
    five_int=$(printf '%.0f' "$five_pct")
    fc=$(rl_color "$five_int")
    fd="${fc/\\033[/\\033[2;}"   # label: dim echo of the value's status color
    rate_info="${fd}5h\033[0m ${rsep}·\033[0m ${fd}$(pie "$five_int") ${five_int}%\033[0m"
    [ -n "$five_reset" ] && rate_info="${rate_info} ${rsep}·\033[0m ${rrst}↻ $(countdown "$five_reset")\033[0m"
fi
if [ -n "$week_pct" ]; then
    week_int=$(printf '%.0f' "$week_pct")
    wc=$(rl_color "$week_int")
    wd="${wc/\\033[/\\033[2;}"
    [ -n "$rate_info" ] && rate_info="${rate_info} ${rsep}|\033[0m "
    rate_info="${rate_info}${wd}7d\033[0m ${rsep}·\033[0m ${wd}$(pie "$week_int") ${week_int}%\033[0m"
    [ -n "$week_reset" ] && rate_info="${rate_info} ${rsep}·\033[0m ${rrst}↻ $(countdown "$week_reset")\033[0m"
fi

# --- Line 2: vim | cost | rate limits ---
line2="  "
[ -n "$vim_info" ] && line2="${line2}${vim_info} \033[2m|\033[0m "
line2="${line2}\033[2;33m${cost_fmt}\033[0m"
[ -n "$rate_info" ] && line2="${line2} \033[2m|\033[0m ${rate_info}"

printf '%b\n%b\n' "$line1" "$line2"
