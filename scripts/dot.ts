#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, realpathSync, statSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const usage = `Usage:
  dot sync [--dry]                     Link home/ using GNU Stow
  dot link <home-relative-file>... [--dry]
  dot skill <name> --tool codex|claude [--dry]

Options:
  --home <absolute-directory>          Target an isolated home
  --dry, -n                           Preview without changing files
  --help, -h                          Show this help

Conflicts stop the operation. Settings, packages, and Git are never synchronized.`;

export type Command = {
  action: 'sync' | 'link' | 'skill' | 'help';
  names: string[];
  dry: boolean;
  home: string;
  tool?: 'codex' | 'claude';
};

export function parseArgs(args: string[]): Command {
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    return { action: 'help', names: [], dry: true, home: homedir() };
  }
  const [action, ...rest] = args;
  if (action !== 'sync' && action !== 'link' && action !== 'skill') {
    throw new Error(`Unknown or retired command: ${action}.\n${usage}`);
  }
  const command: Command = { action, names: [], dry: false, home: homedir() };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === '--dry' || arg === '-n') command.dry = true;
    else if (arg === '--home') {
      const value = rest[++i];
      if (!value || !isAbsolute(value)) throw new Error('--home requires an absolute directory');
      command.home = resolve(value);
    } else if (arg === '--tool') {
      const value = rest[++i];
      if (value !== 'codex' && value !== 'claude') {
        throw new Error('--tool must be codex or claude');
      }
      command.tool = value;
    } else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else command.names.push(arg);
  }
  if (action === 'sync' && command.names.length !== 0) {
    throw new Error('sync takes no paths; use link for individual files');
  }
  if (action === 'link' && command.names.length === 0) throw new Error('link requires a file');
  if (action === 'skill' && (command.names.length !== 1 || !command.tool)) {
    throw new Error('skill requires one name and --tool codex|claude');
  }
  if (action !== 'skill' && command.tool) throw new Error('--tool is only valid with skill');
  return command;
}

function inspect(path: string) {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function inside(root: string, path: string) {
  const suffix = relative(root, path);
  return suffix !== '' && suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix);
}

function sourcePath(root: string, name: string) {
  if (isAbsolute(name) || name.split(/[\\/]/).includes('..')) {
    throw new Error(`Expected a relative path inside ${root}: ${name}`);
  }
  const source = resolve(root, name);
  if (!inside(root, source) || !inside(realpathSync(root), realpathSync(source))) {
    throw new Error(`Source escapes ${root}: ${name}`);
  }
  return source;
}

// A link beneath a linked directory could modify another repository or app home.
function checkParents(home: string, target: string) {
  let parent = dirname(target);
  while (inside(home, parent)) {
    const info = inspect(parent);
    if (info && (!info.isDirectory() || info.isSymbolicLink())) {
      throw new Error(`Parent must be a real directory: ${parent}`);
    }
    parent = dirname(parent);
  }
}

type Link = { source: string; target: string; unchanged: boolean };

function planLink(home: string, source: string, target: string): Link {
  const existing = inspect(target);
  // Older Stow installations may link an owned config directory as a whole.
  // If this file already resolves to our source, no filesystem mutation is needed.
  if (existing) {
    try {
      if (realpathSync(target) === realpathSync(source)) return { source, target, unchanged: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  checkParents(home, target);
  if (existing)
    throw new Error(`Conflict: ${target} already exists; inspect it before replacing it`);
  return { source, target, unchanged: false };
}

function applyLinks(links: Link[], home: string, dry: boolean, log: (text: string) => void) {
  for (const link of links) {
    if (link.unchanged) {
      log(`Already linked: ${link.target}`);
    } else if (dry) {
      log(`Would link: ${link.target} -> ${link.source}`);
    } else {
      checkParents(home, link.target);
      mkdirSync(dirname(link.target), { recursive: true });
      // symlink never replaces an existing destination, including a dangling link.
      symlinkSync(relative(dirname(link.target), link.source), link.target);
      log(`Linked: ${link.target} -> ${link.source}`);
    }
  }
}

export function run(command: Command, repoRoot: string, log = console.log) {
  if (command.action === 'help') {
    log(usage);
    return;
  }
  const root = realpathSync(repoRoot);
  const home = realpathSync(command.home);
  if (!statSync(home).isDirectory()) throw new Error(`Home must be a directory: ${home}`);
  if (!command.dry && home === realpathSync(homedir()) && inspect(join(root, '.git'))?.isFile()) {
    throw new Error('Install into your real home from the stable checkout, not a linked worktree');
  }

  if (command.action === 'sync') {
    const args = ['--dir', root, '--target', home, '--no-folding', '--verbose', 'home'];
    const invoke = (dry: boolean) => {
      const result = spawnSync('stow', [...(dry ? ['--simulate'] : []), ...args], {
        cwd: root,
        encoding: 'utf8',
      });
      if (result.error) throw new Error(`Could not run GNU Stow: ${result.error.message}`);
      if (result.status !== 0) {
        throw new Error(`Stow failed (${result.status ?? result.signal}):\n${result.stderr}`);
      }
      return `${result.stdout}${result.stderr}`.trim();
    };
    const preview = invoke(true);
    if (command.dry) log(preview || 'Dotfiles already linked.');
    else log(invoke(false) || 'Dotfiles already linked.');
    return;
  }

  if (command.action === 'skill') {
    const name = command.names[0]!;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`Invalid skill name: ${name}`);
    const source = sourcePath(join(root, '.codex', 'skills'), name);
    if (!statSync(join(source, 'SKILL.md')).isFile())
      throw new Error(`Missing SKILL.md: ${source}`);
    const target = join(home, `.${command.tool}`, 'skills', name);
    applyLinks([planLink(home, source, target)], home, command.dry, log);
    return;
  }

  // Preflight every requested file before making the first link.
  const links = [...new Set(command.names)].map((name) => {
    const source = sourcePath(join(root, 'home'), name);
    if (!statSync(source).isFile() || name === '.stow-local-ignore') {
      throw new Error(`Choose an owned file within home/: ${name}`);
    }
    const target = resolve(home, name);
    return planLink(home, source, target);
  });
  applyLinks(links, home, command.dry, log);
}

if (import.meta.main) {
  try {
    // Bun embeds compiled sources in /$bunfs; the executable stays beside home/.
    const root = import.meta.dirname.startsWith('/$bunfs/')
      ? dirname(process.execPath)
      : resolve(import.meta.dirname, '..');
    run(parseArgs(process.argv.slice(2)), root);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
