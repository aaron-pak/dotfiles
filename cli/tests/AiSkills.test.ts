import { Error as PlatformError, FileSystem } from "@effect/platform";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { AiSkills, AiSkillsError } from "../src/services/AiSkills.js";
import { AiState } from "../src/services/AiState.js";
import { testDotfilesRoot, testHomeDir, TestPath, TestStowConfig } from "./testSupport.js";

type Entry =
  | { readonly type: "Directory" }
  | { readonly type: "File"; content: string }
  | { readonly type: "SymbolicLink"; target: string };

type FsEntries = Record<string, Entry>;

const aiStatePath = `${testDotfilesRoot}/ai/state.toml`;

const emptyAiStateToml = `
[instructions]
canonical = "home/.claude/CLAUDE.md"

[tools.claude.settings]
shared_settings_file = "ai/claude-settings-shared.json"

[tools.codex.settings]
shared_settings_file = "ai/codex-settings-shared.toml"
`.trimStart();

const systemError = (method: string, path: string, reason: "NotFound") =>
  new PlatformError.SystemError({
    module: "FileSystem",
    method,
    pathOrDescriptor: path,
    reason,
  });

const dirname = (pathValue: string) => {
  const parts = pathValue.split("/").filter((part) => part.length > 0);
  if (parts.length <= 1) {
    return "/";
  }
  return `/${parts.slice(0, -1).join("/")}`;
};

const normalizePath = (pathValue: string) => {
  const parts = pathValue.split("/").filter((part) => part.length > 0);
  return `/${parts.join("/")}`;
};

const resolveRelative = (fromDir: string, target: string) => {
  if (target.startsWith("/")) {
    return normalizePath(target);
  }

  const parts = fromDir.split("/").filter((part) => part.length > 0);
  for (const segment of target.split("/").filter((part) => part.length > 0)) {
    if (segment === ".") {
      continue;
    }
    if (segment === "..") {
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return `/${parts.join("/")}`;
};

const ensureParents = (entries: FsEntries, pathValue: string) => {
  let current = dirname(pathValue);
  while (current !== "/" && !(current in entries)) {
    entries[current] = { type: "Directory" };
    current = dirname(current);
  }
  entries["/"] = { type: "Directory" };
};

const copyEntry = (entries: FsEntries, fromPath: string, toPath: string) => {
  const entry = entries[fromPath];
  if (entry === undefined) {
    throw systemError("copy", fromPath, "NotFound");
  }

  ensureParents(entries, toPath);
  if (entry.type === "File") {
    entries[toPath] = { type: "File", content: entry.content };
    return;
  }

  if (entry.type === "SymbolicLink") {
    entries[toPath] = { type: "SymbolicLink", target: entry.target };
    return;
  }

  entries[toPath] = { type: "Directory" };
  for (const childPath of Object.keys(entries)) {
    if (!childPath.startsWith(`${fromPath}/`)) {
      continue;
    }
    const suffix = childPath.slice(fromPath.length);
    copyEntry(entries, childPath, `${toPath}${suffix}`);
  }
};

const removeEntry = (entries: FsEntries, pathValue: string) => {
  for (const key of Object.keys(entries)) {
    if (key === pathValue || key.startsWith(`${pathValue}/`)) {
      delete entries[key];
    }
  }
};

const readDirectory = (entries: FsEntries, pathValue: string) => {
  const prefix = pathValue === "/" ? "/" : `${pathValue}/`;
  const children = new Set<string>();
  for (const key of Object.keys(entries)) {
    if (!key.startsWith(prefix) || key === pathValue) {
      continue;
    }
    const remainder = key.slice(prefix.length);
    const child = remainder.split("/")[0];
    if (child !== undefined && child.length > 0) {
      children.add(child);
    }
  }
  return [...children].sort();
};

const realPath = (entries: FsEntries, pathValue: string): string => {
  const entry = entries[pathValue];
  if (entry === undefined) {
    throw systemError("realPath", pathValue, "NotFound");
  }
  if (entry.type !== "SymbolicLink") {
    return pathValue;
  }
  return realPath(entries, resolveRelative(dirname(pathValue), entry.target));
};

const makeSkillFsLayer = (entries: FsEntries) =>
  FileSystem.layerNoop({
    exists: (pathValue) => Effect.succeed(pathValue in entries),
    makeDirectory: (pathValue) =>
      Effect.sync(() => {
        ensureParents(entries, pathValue);
        entries[pathValue] = { type: "Directory" };
      }),
    readFileString: (pathValue) => {
      const entry = entries[pathValue];
      return entry !== undefined && entry.type === "File"
        ? Effect.succeed(entry.content)
        : Effect.fail(systemError("readFileString", pathValue, "NotFound"));
    },
    writeFileString: (pathValue, content) =>
      Effect.sync(() => {
        ensureParents(entries, pathValue);
        entries[pathValue] = { type: "File", content };
      }),
    stat: (pathValue) =>
      Effect.gen(function* () {
        const entry = entries[pathValue];
        if (entry === undefined) {
          return yield* systemError("stat", pathValue, "NotFound");
        }

        return {
          type: entry.type,
          mtime: Option.none(),
          atime: Option.none(),
          birthtime: Option.none(),
          dev: 0,
          ino: Option.none(),
          mode: 0,
          nlink: Option.none(),
          uid: Option.none(),
          gid: Option.none(),
          rdev: Option.none(),
          size: FileSystem.Size(0),
          blksize: Option.none(),
          blocks: Option.none(),
        };
      }),
    readDirectory: (pathValue) =>
      pathValue in entries
        ? Effect.succeed(readDirectory(entries, pathValue))
        : Effect.fail(systemError("readDirectory", pathValue, "NotFound")),
    copy: (fromPath, toPath) =>
      Effect.sync(() => {
        copyEntry(entries, fromPath, toPath);
      }),
    remove: (pathValue) =>
      Effect.sync(() => {
        removeEntry(entries, pathValue);
      }),
    symlink: (fromPath, toPath) =>
      Effect.sync(() => {
        ensureParents(entries, toPath);
        entries[toPath] = { type: "SymbolicLink", target: fromPath };
      }),
    readLink: (pathValue) => {
      const entry = entries[pathValue];
      return entry !== undefined && entry.type === "SymbolicLink"
        ? Effect.succeed(entry.target)
        : Effect.fail(systemError("readLink", pathValue, "NotFound"));
    },
    realPath: (pathValue) =>
      Effect.sync(() => {
        return realPath(entries, pathValue);
      }),
  });

const makeTestLayer = (entries: FsEntries) =>
  AiSkills.Default.pipe(
    Layer.provideMerge(AiState.Default),
    Layer.provideMerge(makeSkillFsLayer(entries)),
    Layer.provideMerge(TestStowConfig),
    Layer.provideMerge(TestPath),
  );

describe("AiSkills service", () => {
  it.effect("adopts a local Codex skill into canonical storage and projects selected targets", () => {
    const entries: FsEntries = {
      ["/"]: { type: "Directory" },
      [testDotfilesRoot]: { type: "Directory" },
      [`${testDotfilesRoot}/config`]: { type: "Directory" },
      [aiStatePath]: { type: "File", content: emptyAiStateToml },
      [testHomeDir]: { type: "Directory" },
      [`${testHomeDir}/.codex`]: { type: "Directory" },
      [`${testHomeDir}/.codex/skills`]: { type: "Directory" },
      [`${testHomeDir}/.claude`]: { type: "Directory" },
      [`${testHomeDir}/.claude/skills`]: { type: "Directory" },
      [`${testHomeDir}/.codex/skills/my-skill`]: { type: "Directory" },
      [`${testHomeDir}/.codex/skills/my-skill/SKILL.md`]: {
        type: "File",
        content: "# My Skill",
      },
    };

    return Effect.gen(function* () {
      const skills = yield* AiSkills;
      const result = yield* skills.adopt({
        name: "my-skill",
        sourcePath: `${testHomeDir}/.codex/skills/my-skill`,
        targets: ["claude", "codex"],
      });

      expect(result.canonicalDir).toBe("ai/skills/my-skill");
      expect(entries[`${testDotfilesRoot}/ai/skills/my-skill/SKILL.md`]).toEqual({
        type: "File",
        content: "# My Skill",
      });
      expect(entries[`${testHomeDir}/.codex/skills/my-skill`]).toEqual({
        type: "SymbolicLink",
        target: "../../../dotfiles/ai/skills/my-skill",
      });
      expect(entries[`${testHomeDir}/.claude/skills/my-skill`]).toEqual({
        type: "SymbolicLink",
        target: "../../../dotfiles/ai/skills/my-skill",
      });
      const stateEntry = entries[aiStatePath];
      expect(stateEntry?.type).toBe("File");
      if (stateEntry !== undefined && stateEntry.type === "File") {
        expect(stateEntry.content).toContain("[skills.my-skill]");
      }
    }).pipe(Effect.provide(makeTestLayer(entries)));
  });

  it.effect("rejects adopt when a target path already exists as a real local directory", () => {
    const entries: FsEntries = {
      ["/"]: { type: "Directory" },
      [testDotfilesRoot]: { type: "Directory" },
      [`${testDotfilesRoot}/config`]: { type: "Directory" },
      [aiStatePath]: { type: "File", content: emptyAiStateToml },
      [testHomeDir]: { type: "Directory" },
      [`${testHomeDir}/.codex`]: { type: "Directory" },
      [`${testHomeDir}/.codex/skills`]: { type: "Directory" },
      [`${testHomeDir}/.claude`]: { type: "Directory" },
      [`${testHomeDir}/.claude/skills`]: { type: "Directory" },
      [`${testHomeDir}/.codex/skills/my-skill`]: { type: "Directory" },
      [`${testHomeDir}/.codex/skills/my-skill/SKILL.md`]: {
        type: "File",
        content: "# My Skill",
      },
      [`${testHomeDir}/.claude/skills/my-skill`]: { type: "Directory" },
    };

    return Effect.gen(function* () {
      const skills = yield* AiSkills;
      const error = yield* skills
        .adopt({
          name: "my-skill",
          sourcePath: `${testHomeDir}/.codex/skills/my-skill`,
          targets: ["claude", "codex"],
        })
        .pipe(Effect.flip);

      expect(error).toBeInstanceOf(AiSkillsError);
      if (error._tag === "AiSkillsError") {
        expect(error.details).toContain("already exists as a local directory");
      }
    }).pipe(Effect.provide(makeTestLayer(entries)));
  });

  it.effect("sync creates missing managed skill links and reports conflicts", () => {
    const entries: FsEntries = {
      ["/"]: { type: "Directory" },
      [testDotfilesRoot]: { type: "Directory" },
      [aiStatePath]: {
        type: "File",
        content: `${emptyAiStateToml}

[skills.batch]
canonical_dir = "ai/skills/batch"
targets = ["claude", "codex", "agents"]
`,
      },
      [`${testDotfilesRoot}/ai/skills`]: { type: "Directory" },
      [`${testDotfilesRoot}/ai/skills/batch`]: { type: "Directory" },
      [`${testDotfilesRoot}/ai/skills/batch/SKILL.md`]: {
        type: "File",
        content: "# Batch",
      },
      [testHomeDir]: { type: "Directory" },
      [`${testHomeDir}/.claude`]: { type: "Directory" },
      [`${testHomeDir}/.claude/skills`]: { type: "Directory" },
      [`${testHomeDir}/.codex`]: { type: "Directory" },
      [`${testHomeDir}/.codex/skills`]: { type: "Directory" },
      [`${testHomeDir}/.codex/skills/batch`]: { type: "Directory" },
    };

    return Effect.gen(function* () {
      const skills = yield* AiSkills;
      const preview = yield* skills.previewSync();

      expect(preview.toCreate).toEqual([
        "~/.claude/skills/batch",
        "~/.agents/skills/batch",
      ]);
      expect(preview.toRemove).toEqual([]);
      expect(preview.conflicts).toEqual([
        "~/.codex/skills/batch already exists as a local directory",
      ]);

      const error = yield* skills.sync().pipe(Effect.flip);
      expect(error).toBeInstanceOf(AiSkillsError);
    }).pipe(Effect.provide(makeTestLayer(entries)));
  });

  it.effect("updateTargets removes a deselected managed target immediately", () => {
    const entries: FsEntries = {
      ["/"]: { type: "Directory" },
      [testDotfilesRoot]: { type: "Directory" },
      [aiStatePath]: {
        type: "File",
        content: `${emptyAiStateToml}

[skills.batch]
canonical_dir = "ai/skills/batch"
targets = ["claude", "codex"]
`,
      },
      [`${testDotfilesRoot}/ai/skills`]: { type: "Directory" },
      [`${testDotfilesRoot}/ai/skills/batch`]: { type: "Directory" },
      [`${testDotfilesRoot}/ai/skills/batch/SKILL.md`]: {
        type: "File",
        content: "# Batch",
      },
      [testHomeDir]: { type: "Directory" },
      [`${testHomeDir}/.claude`]: { type: "Directory" },
      [`${testHomeDir}/.claude/skills`]: { type: "Directory" },
      [`${testHomeDir}/.claude/skills/batch`]: {
        type: "SymbolicLink",
        target: "../../../dotfiles/ai/skills/batch",
      },
      [`${testHomeDir}/.codex`]: { type: "Directory" },
      [`${testHomeDir}/.codex/skills`]: { type: "Directory" },
      [`${testHomeDir}/.codex/skills/batch`]: {
        type: "SymbolicLink",
        target: "../../../dotfiles/ai/skills/batch",
      },
    };

    return Effect.gen(function* () {
      const skills = yield* AiSkills;
      const result = yield* skills.updateTargets("batch", ["codex"]);

      expect(result.targets).toEqual(["codex"]);
      expect(entries[`${testHomeDir}/.claude/skills/batch`]).toBeUndefined();
      expect(entries[`${testHomeDir}/.codex/skills/batch`]).toEqual({
        type: "SymbolicLink",
        target: "../../../dotfiles/ai/skills/batch",
      });
      const stateEntry = entries[aiStatePath];
      if (stateEntry !== undefined && stateEntry.type === "File") {
        expect(stateEntry.content).toContain('targets = [ "codex" ]');
      }
    }).pipe(Effect.provide(makeTestLayer(entries)));
  });

  it.effect("sync removes stale managed links for deselected targets", () => {
    const entries: FsEntries = {
      ["/"]: { type: "Directory" },
      [testDotfilesRoot]: { type: "Directory" },
      [aiStatePath]: {
        type: "File",
        content: `${emptyAiStateToml}

[skills.batch]
canonical_dir = "ai/skills/batch"
targets = ["codex"]
`,
      },
      [`${testDotfilesRoot}/ai/skills`]: { type: "Directory" },
      [`${testDotfilesRoot}/ai/skills/batch`]: { type: "Directory" },
      [`${testDotfilesRoot}/ai/skills/batch/SKILL.md`]: {
        type: "File",
        content: "# Batch",
      },
      [testHomeDir]: { type: "Directory" },
      [`${testHomeDir}/.claude`]: { type: "Directory" },
      [`${testHomeDir}/.claude/skills`]: { type: "Directory" },
      [`${testHomeDir}/.claude/skills/batch`]: {
        type: "SymbolicLink",
        target: "../../../dotfiles/ai/skills/batch",
      },
      [`${testHomeDir}/.codex`]: { type: "Directory" },
      [`${testHomeDir}/.codex/skills`]: { type: "Directory" },
      [`${testHomeDir}/.codex/skills/batch`]: {
        type: "SymbolicLink",
        target: "../../../dotfiles/ai/skills/batch",
      },
    };

    return Effect.gen(function* () {
      const skills = yield* AiSkills;
      const preview = yield* skills.previewSync();

      expect(preview.toCreate).toEqual([]);
      expect(preview.toRemove).toEqual(["~/.claude/skills/batch"]);
      expect(preview.unchanged).toEqual(["~/.codex/skills/batch"]);

      const result = yield* skills.sync();
      expect(result.toRemove).toEqual(["~/.claude/skills/batch"]);
      expect(entries[`${testHomeDir}/.claude/skills/batch`]).toBeUndefined();
      expect(entries[`${testHomeDir}/.codex/skills/batch`]).toEqual({
        type: "SymbolicLink",
        target: "../../../dotfiles/ai/skills/batch",
      });
    }).pipe(Effect.provide(makeTestLayer(entries)));
  });

  it.effect("unmanage keeps local copies on this machine and removes repo management", () => {
    const entries: FsEntries = {
      ["/"]: { type: "Directory" },
      [testDotfilesRoot]: { type: "Directory" },
      [`${testDotfilesRoot}/config`]: { type: "Directory" },
      [aiStatePath]: {
        type: "File",
        content: `${emptyAiStateToml}

[skills.batch]
canonical_dir = "ai/skills/batch"
targets = ["claude"]
`,
      },
      [`${testDotfilesRoot}/ai/skills`]: { type: "Directory" },
      [`${testDotfilesRoot}/ai/skills/batch`]: { type: "Directory" },
      [`${testDotfilesRoot}/ai/skills/batch/SKILL.md`]: {
        type: "File",
        content: "# Batch",
      },
      [testHomeDir]: { type: "Directory" },
      [`${testHomeDir}/.claude`]: { type: "Directory" },
      [`${testHomeDir}/.claude/skills`]: { type: "Directory" },
      [`${testHomeDir}/.claude/skills/batch`]: {
        type: "SymbolicLink",
        target: "../../../dotfiles/ai/skills/batch",
      },
    };

    return Effect.gen(function* () {
      const skills = yield* AiSkills;
      yield* skills.unmanage("batch");

      expect(entries[`${testHomeDir}/.claude/skills/batch`]).toEqual({
        type: "Directory",
      });
      expect(entries[`${testHomeDir}/.claude/skills/batch/SKILL.md`]).toEqual({
        type: "File",
        content: "# Batch",
      });
      expect(entries[`${testDotfilesRoot}/ai/skills/batch`]).toBeUndefined();
      const stateEntry = entries[aiStatePath];
      if (stateEntry !== undefined && stateEntry.type === "File") {
        expect(stateEntry.content).not.toContain("[skills.batch]");
      }
    }).pipe(Effect.provide(makeTestLayer(entries)));
  });

  it.effect("unmanage can delete local copies on this machine and remove repo management", () => {
    const entries: FsEntries = {
      ["/"]: { type: "Directory" },
      [testDotfilesRoot]: { type: "Directory" },
      [`${testDotfilesRoot}/config`]: { type: "Directory" },
      [aiStatePath]: {
        type: "File",
        content: `${emptyAiStateToml}

[skills.batch]
canonical_dir = "ai/skills/batch"
targets = ["claude"]
`,
      },
      [`${testDotfilesRoot}/ai/skills`]: { type: "Directory" },
      [`${testDotfilesRoot}/ai/skills/batch`]: { type: "Directory" },
      [`${testDotfilesRoot}/ai/skills/batch/SKILL.md`]: {
        type: "File",
        content: "# Batch",
      },
      [testHomeDir]: { type: "Directory" },
      [`${testHomeDir}/.claude`]: { type: "Directory" },
      [`${testHomeDir}/.claude/skills`]: { type: "Directory" },
      [`${testHomeDir}/.claude/skills/batch`]: {
        type: "SymbolicLink",
        target: "../../../dotfiles/ai/skills/batch",
      },
    };

    return Effect.gen(function* () {
      const skills = yield* AiSkills;
      yield* skills.unmanage("batch", "delete-local-copies");

      expect(entries[`${testHomeDir}/.claude/skills/batch`]).toBeUndefined();
      expect(entries[`${testDotfilesRoot}/ai/skills/batch`]).toBeUndefined();
      const stateEntry = entries[aiStatePath];
      if (stateEntry !== undefined && stateEntry.type === "File") {
        expect(stateEntry.content).not.toContain("[skills.batch]");
      }
    }).pipe(Effect.provide(makeTestLayer(entries)));
  });
});
