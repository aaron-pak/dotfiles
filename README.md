# Dotfiles

Personal configuration maintained with an agent. Open this repository in Codex or Claude Code and ask for the change you want: “install eli5 for Claude in this project,” “update my global instructions,” or “set up this Mac.”

On a new Mac, install and sign into the intended harness, clone this repository to `~/projects/dotfiles`, open it as the working directory, and ask the agent to finish setup. [AGENTS.md](AGENTS.md) and the [configure-machine skill](.codex/skills/configure-machine/SKILL.md) explain the ownership and workflow.

## Where things live

- `.codex/skills/configure-machine/`: the skill for maintaining this repository, also exposed to Claude through a link in `.claude/skills/`.
- `skills/`: distributable skills, currently `artifact-design`, `create-verification-skill`, `eli5`, `maintain-verification-skill`, and `show-me`. Install each for the selected tool and user or project scope. Keeping a skill here does not activate it in this project.
- `home/`: native application configs and global instructions. `home/.claude/CLAUDE.md` imports `home/.codex/AGENTS.md`.
- `Brewfile`: portable Homebrew packages.

Harness settings, plugin installations, and authentication stay local. There is no settings synchronization, installation registry, compiled CLI, or GNU Stow requirement.

`create-verification-skill` and `maintain-verification-skill` come from Lauren Tan's [pstack](https://github.com/cursor/plugins/tree/f5bdd6826fd0a0d9cbc4347134c3a74a200b9d9d/pstack), revision `f5bdd6826fd0a0d9cbc4347134c3a74a200b9d9d`, under the MIT licenses included in their directories. Only the hardcoded Cursor skill paths are generalized to the project's skills directory; the remaining skill text and feature-map examples match upstream.

## Linking and verification

The agent inspects existing files and chooses explicit sources and destinations. A small [Python helper](.codex/skills/configure-machine/scripts/link.py) handles link creation with conflict checks; its usage and examples live in the configuration skill. Python 3 is its only runtime requirement, with no third-party packages.

Linked skills follow updates to this checkout. A project that needs a portable, committed skill can carry a copy instead. Installation scope and update behavior are chosen for the request.

To test the helper:

```sh
python3 -W error -m unittest discover -s .codex/skills/configure-machine/tests -v
git diff --check
```
