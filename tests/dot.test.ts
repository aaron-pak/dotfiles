import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseArgs, run } from '../scripts/dot.js';
import { fixture, write } from './fixtures.js';

describe('explicit link operations', () => {
  let f: ReturnType<typeof fixture>;
  const messages: string[] = [];
  const log = (message: string) => messages.push(message);
  const invoke = (...args: string[]) => run(parseArgs([...args, '--home', f.home]), f.repo, log);

  beforeEach(() => {
    f = fixture();
    messages.length = 0;
  });
  afterEach(() => rmSync(f.temp, { recursive: true, force: true }));

  it('previews without creating parent directories or links', () => {
    invoke('link', '.codex/AGENTS.md', '--dry');
    expect(existsSync(join(f.home, '.codex'))).toBe(false);
    expect(messages).toHaveLength(1);
  });

  it('links only selected files and converges without replacement', () => {
    invoke('link', '.codex/AGENTS.md');
    const target = join(f.home, '.codex/AGENTS.md');
    const inode = lstatSync(target).ino;
    expect(realpathSync(target)).toBe(realpathSync(join(f.repo, 'home/.codex/AGENTS.md')));
    expect(lstatSync(join(f.home, '.codex')).isSymbolicLink()).toBe(false);
    expect(existsSync(join(f.home, '.tmux.conf'))).toBe(false);
    invoke('link', '.codex/AGENTS.md');
    expect(lstatSync(target).ino).toBe(inode);
  });

  it('preflights every destination before changing any file', () => {
    write(join(f.home, '.tmux.conf'), 'my local settings');
    expect(() => invoke('link', '.codex/AGENTS.md', '.tmux.conf')).toThrow('Conflict');
    expect(existsSync(join(f.home, '.codex'))).toBe(false);
    expect(readFileSync(join(f.home, '.tmux.conf'), 'utf8')).toBe('my local settings');
  });

  it('preserves an unrelated dangling link', () => {
    const target = join(f.home, '.tmux.conf');
    symlinkSync('missing-local-file', target);
    expect(() => invoke('link', '.tmux.conf')).toThrow('Conflict');
    expect(readlinkSync(target)).toBe('missing-local-file');
  });

  it('refuses to traverse a linked application directory', () => {
    const elsewhere = join(f.temp, 'another-app');
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, join(f.home, '.codex'));
    expect(() => invoke('link', '.codex/AGENTS.md')).toThrow('Parent must be a real directory');
    expect(existsSync(join(elsewhere, 'AGENTS.md'))).toBe(false);
  });

  it('leaves an already-owned folded config directory intact', () => {
    write(join(f.repo, 'home/.config/ghostty/config'), 'font-size = 14');
    mkdirSync(join(f.home, '.config'));
    const directory = join(f.home, '.config/ghostty');
    symlinkSync(join(f.repo, 'home/.config/ghostty'), directory);
    invoke('link', '.config/ghostty/config');
    expect(lstatSync(directory).isSymbolicLink()).toBe(true);
    expect(messages[0]).toContain('Already linked');
  });

  it.each(['../outside', '/tmp/outside', '.codex/../../outside'])(
    'rejects path escape %s',
    (path) => {
      expect(() => invoke('link', path)).toThrow('Expected a relative path');
    },
  );

  it('rejects an owned source symlink that escapes home/', () => {
    write(join(f.temp, 'outside'), 'outside');
    symlinkSync(join(f.temp, 'outside'), join(f.repo, 'home/escape'));
    expect(() => invoke('link', 'escape')).toThrow('Source escapes');
    expect(existsSync(join(f.home, 'escape'))).toBe(false);
  });

  it('does not link a whole harness directory', () => {
    expect(() => invoke('link', '.codex')).toThrow('Choose an owned file');
    expect(existsSync(join(f.home, '.codex'))).toBe(false);
  });

  it('accepts paths containing two dots without treating them as traversal', () => {
    write(join(f.repo, 'home/file..conf'), 'value');
    invoke('link', 'file..conf');
    expect(readFileSync(join(f.home, 'file..conf'), 'utf8')).toBe('value');
  });

  it('installs a whole skill for exactly one harness and preserves settings', () => {
    write(join(f.home, '.codex/config.toml'), '# local\nmodel = "local-model"\n');
    write(join(f.repo, '.codex/skills/example/scripts/helper.sh'), 'echo fixture');
    invoke('skill', 'example', '--tool', 'codex');
    const target = join(f.home, '.codex/skills/example');
    expect(realpathSync(target)).toBe(realpathSync(join(f.repo, '.codex/skills/example')));
    expect(readFileSync(join(target, 'scripts/helper.sh'), 'utf8')).toBe('echo fixture');
    expect(lstatSync(join(f.home, '.codex/skills')).isDirectory()).toBe(true);
    expect(existsSync(join(f.home, '.claude'))).toBe(false);
    expect(readFileSync(join(f.home, '.codex/config.toml'), 'utf8')).toBe(
      '# local\nmodel = "local-model"\n',
    );
  });

  it('skill previews do not create a harness home', () => {
    invoke('skill', 'example', '--tool', 'claude', '-n');
    expect(existsSync(join(f.home, '.claude'))).toBe(false);
  });

  it('preserves conflicting local skill copies', () => {
    const target = join(f.home, '.claude/skills/example/SKILL.md');
    write(target, 'local skill');
    expect(() => invoke('skill', 'example', '--tool', 'claude')).toThrow('Conflict');
    expect(readFileSync(target, 'utf8')).toBe('local skill');
  });

  it('uninstalling one link leaves the canonical skill and other installation intact', () => {
    invoke('skill', 'example', '--tool', 'claude');
    invoke('skill', 'example', '--tool', 'codex');
    unlinkSync(join(f.home, '.claude/skills/example'));
    expect(existsSync(join(f.repo, '.codex/skills/example/SKILL.md'))).toBe(true);
    expect(existsSync(join(f.home, '.codex/skills/example/SKILL.md'))).toBe(true);
  });

  it('refuses real-home installations from a linked worktree before any mutation', () => {
    write(join(f.repo, '.git'), 'gitdir: /nonexistent/worktrees/test');
    expect(() => run(parseArgs(['link', '.tmux.conf']), f.repo, log)).toThrow('stable checkout');
  });

  it('recognizes the intended relative link without replacing it', () => {
    const target = join(f.home, '.tmux.conf');
    symlinkSync(relative(f.home, join(f.repo, 'home/.tmux.conf')), target);
    invoke('link', '.tmux.conf');
    expect(messages[0]).toContain('Already linked');
  });
});

describe('noninteractive command arguments', () => {
  it.each([
    ['ai'],
    ['init'],
    ['sync', '--force'],
    ['sync', '.tmux.conf'],
    ['link'],
    ['link', '.tmux.conf', '--tool', 'codex'],
    ['skill', 'example'],
    ['skill', 'example', '--tool', 'agents'],
    ['skill', 'one', 'two', '--tool', 'codex'],
    ['sync', '--home'],
    ['sync', '--home', 'relative'],
  ])('rejects incomplete or retired commands: %j', (...args) => {
    expect(() => parseArgs(args)).toThrow();
  });

  it('defaults to the actual home directory', () => {
    expect(parseArgs(['sync']).home).toBe(homedir());
  });
});
