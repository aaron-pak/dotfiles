import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixture, write } from './fixtures.js';

describe('compiled helper and GNU Stow', () => {
  let f: ReturnType<typeof fixture>;
  const invoke = (args: string[], env = process.env) =>
    spawnSync(join(f.repo, 'dot'), [...args, '--home', f.home], {
      cwd: f.temp,
      env,
      encoding: 'utf8',
      timeout: 10_000,
      input: '',
    });

  beforeEach(() => {
    f = fixture();
    copyFileSync(resolve('dot'), join(f.repo, 'dot'));
    chmodSync(join(f.repo, 'dot'), 0o755);
    write(join(f.home, '.codex/config.toml'), '# keep\nmodel = "local"\n');
    write(join(f.home, '.claude/settings.json'), '{"local":true}\n');
  });
  afterEach(() => rmSync(f.temp, { recursive: true, force: true }));

  it('previews, links only home/, preserves settings and converges', () => {
    const dry = invoke(['sync', '--dry']);
    expect(dry.status, dry.stderr).toBe(0);
    expect(existsSync(join(f.home, '.tmux.conf'))).toBe(false);

    const applied = invoke(['sync']);
    expect(applied.status, applied.stderr).toBe(0);
    expect(realpathSync(join(f.home, '.tmux.conf'))).toBe(
      realpathSync(join(f.repo, 'home/.tmux.conf')),
    );
    expect(readFileSync(join(f.home, '.claude/CLAUDE.md'), 'utf8')).toBe('@~/.codex/AGENTS.md\n');
    expect(readFileSync(join(f.home, '.codex/AGENTS.md'), 'utf8')).toBe('Shared instructions\n');
    expect(lstatSync(join(f.home, '.codex')).isSymbolicLink()).toBe(false);
    expect(lstatSync(join(f.home, '.claude')).isSymbolicLink()).toBe(false);
    expect(existsSync(join(f.home, '.codex/skills'))).toBe(false);
    expect(readFileSync(join(f.home, '.codex/config.toml'), 'utf8')).toBe(
      '# keep\nmodel = "local"\n',
    );
    expect(readFileSync(join(f.home, '.claude/settings.json'), 'utf8')).toBe('{"local":true}\n');
    const inode = lstatSync(join(f.home, '.tmux.conf')).ino;
    const again = invoke(['sync']);
    expect(again.status, again.stderr).toBe(0);
    expect(lstatSync(join(f.home, '.tmux.conf')).ino).toBe(inode);
  });

  it('a conflict stops the entire sync without prompting or applying other files', () => {
    write(join(f.home, '.tmux.conf'), 'existing local content');
    const result = invoke(['sync']);
    expect(result.status).toBe(1);
    expect(result.error).toBeUndefined();
    expect(readFileSync(join(f.home, '.tmux.conf'), 'utf8')).toBe('existing local content');
    expect(existsSync(join(f.home, '.codex/AGENTS.md'))).toBe(false);
    expect(existsSync(join(f.home, '.claude/CLAUDE.md'))).toBe(false);
    expect(existsSync(join(f.home, '.codex/skills'))).toBe(false);
  });

  it('propagates unexpected Stow preview failures and never attempts apply', () => {
    const log = join(f.temp, 'stow-calls');
    const fakeStow = join(f.temp, 'bin/stow');
    write(
      fakeStow,
      '#!/bin/sh\nprintf "called\\n" >> "$DOT_TEST_LOG"\necho unexpected failure >&2\nexit 2\n',
    );
    chmodSync(fakeStow, 0o755);
    const result = invoke(['sync'], {
      ...process.env,
      PATH: `${join(f.temp, 'bin')}${delimiter}${process.env.PATH}`,
      DOT_TEST_LOG: log,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unexpected failure');
    expect(readFileSync(log, 'utf8')).toBe('called\n');
    expect(existsSync(join(f.home, '.tmux.conf'))).toBe(false);
  });

  it('finds its repository beside the executable regardless of cwd or folder name', () => {
    const result = invoke(['link', '.codex/AGENTS.md']);
    expect(result.status, result.stderr).toBe(0);
    expect(realpathSync(join(f.home, '.codex/AGENTS.md'))).toBe(
      realpathSync(join(f.repo, 'home/.codex/AGENTS.md')),
    );
    expect(existsSync(join(f.home, '.tmux.conf'))).toBe(false);
    const skill = invoke(['skill', 'example', '--tool', 'claude']);
    expect(skill.status, skill.stderr).toBe(0);
    expect(realpathSync(join(f.home, '.claude/skills/example'))).toBe(
      realpathSync(join(f.repo, '.codex/skills/example')),
    );
  });
});
