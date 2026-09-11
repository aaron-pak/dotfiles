import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export function write(path: string, contents: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

export function fixture() {
  const temp = mkdtempSync(join(tmpdir(), 'dotfiles-test-'));
  // This deliberately does not contain "dotfiles": root detection must not use the name.
  const repo = join(temp, 'configuration');
  const home = join(temp, 'home');
  mkdirSync(home);
  write(join(repo, 'home/.tmux.conf'), 'set -g mouse on\n');
  write(join(repo, 'home/.codex/AGENTS.md'), 'Shared instructions\n');
  write(join(repo, 'home/.claude/CLAUDE.md'), '@~/.codex/AGENTS.md\n');
  write(
    join(repo, '.codex/skills/example/SKILL.md'),
    '---\nname: example\ndescription: A fixture skill.\n---\nUse it when requested.\n',
  );
  return { temp, repo, home };
}
