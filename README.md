# Dotfiles

Personal configuration maintained with an agent. Open this repository in Codex or Claude Code and ask for the change you want—for example, “install eli5 for Claude,” “update my global instructions,” or “set up this Mac.”

The harness reads the repository instructions and discovers the `configure-machine` skill. On a new Mac, install and sign into a harness, clone this repository to `~/projects/dotfiles`, open it as the working directory, and ask the agent to finish setup. The skill is also readable directly at [.codex/skills/configure-machine/SKILL.md](.codex/skills/configure-machine/SKILL.md).

## Where things live

- `AGENTS.md`: instructions for maintaining this repository. `CLAUDE.md` imports it.
- `home/`: native dotfiles linked into the home directory.
- `home/.codex/AGENTS.md`: shared global agent instructions, imported by `home/.claude/CLAUDE.md`.
- `.codex/skills/`: canonical personal skills. Being in the repository does not install a skill globally. Selected skills get individual links under `~/.codex/skills/` or `~/.claude/skills/`.
- `Brewfile`: Homebrew packages.
- `scripts/dot.ts`: a small noninteractive helper for dotfile and skill links.

Harness settings and plugin installations are configured locally when needed. This repository does not store or synchronize them.

## Helper commands

These are available to an agent or for occasional direct use:

```sh
bun install
bun run dev link .tmux.conf --dry       # preview one owned file
bun run dev link .tmux.conf             # link it
bun run dev skill eli5 --tool claude    # install one personal skill
bun run dev sync --dry                  # preview all owned dotfiles
bun run dev sync                        # link home/ using GNU Stow
```

Conflicting files are left in place and reported as errors. `sync` only links dotfiles; it does not configure agents, install skills, fetch Git changes, or install packages. Use the stable checkout when installing into the real home directory. `--home /absolute/path` targets an isolated home for testing.

`bun run build` creates the optional `./dot` executable with the same commands. Old interactive `ai`, settings, `init`, `add`, and `remove` commands have been retired. Tell the agent what you want to change instead.

## Development

```sh
bun run typecheck
bun run test
bun run test:e2e
bun run lint
bun run format:check
```

Filesystem tests use temporary homes. See [AGENTS.md](AGENTS.md) for ownership and verification requirements.
