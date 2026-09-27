# Dotfiles

Personal configuration maintained with an agent. Open this repository in Codex or Claude Code and ask for the change you want: “link my Ghostty config,” “install eli5 for Claude in this project,” or “set up this Mac.”

On a new Mac, install and sign into the intended harness, clone this repository to `~/projects/dotfiles`, open it as the working directory, and ask the agent to finish setup. [AGENTS.md](AGENTS.md) and the [configure-machine skill](.codex/skills/configure-machine/SKILL.md) explain the ownership and workflow.

## Where things live

- `.codex/skills/configure-machine/`: the skill for maintaining this repository, also exposed to Claude through a link in `.claude/skills/`.
- `home/`: native application configs.
- `Brewfile`: portable Homebrew packages.

Personal skills and the global agent instructions live in [aaron-pak/agent-plugins](https://github.com/aaron-pak/agent-plugins), cloned to `~/projects/agent-plugins`. Each skill there is its own plugin that Claude Code and Codex install from the marketplace, one plugin and one harness at a time. Its `instructions/AGENTS.md` and `instructions/CLAUDE.md` are linked by hand to `~/.codex/AGENTS.md` and `~/.claude/CLAUDE.md`. Its README also carries the pstack credit for the verification skills.

Harness settings, plugin installations, and authentication stay local. There is no settings synchronization, installation registry, compiled CLI, or GNU Stow requirement.

## Linking and verification

The agent inspects existing files and chooses explicit sources and destinations. A small [Python helper](.codex/skills/configure-machine/scripts/link.py) handles link creation with conflict checks; its usage and examples live in the configuration skill. Python 3 is its only runtime requirement, with no third-party packages.

To test the helper:

```sh
python3 -W error -m unittest discover -s .codex/skills/configure-machine/tests -v
git diff --check
```
