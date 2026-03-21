import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Option, PlatformError } from "effect";
import {
  CodexHome,
  CodexHomeLive,
} from "../src/services/CodexHome.js";
import { TestPath, TestStowConfig, testDotfilesRoot, testHomeDir } from "./testSupport.js";

type Entry =
  | { readonly type: "Directory" }
  | { readonly type: "File"; readonly content: string }
  | { readonly type: "SymbolicLink"; readonly target: string };

type FsEntries = Record<string, Entry>;

const systemError = (method: string, pathValue: string) =>
  PlatformError.systemError({
    _tag: "NotFound",
    module: "FileSystem",
    method,
    pathOrDescriptor: pathValue,
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
    throw systemError("copy", fromPath);
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

const renameEntry = (entries: FsEntries, fromPath: string, toPath: string) => {
  const updates = Object.entries(entries)
    .filter(([key]) => key === fromPath || key.startsWith(`${fromPath}/`))
    .map(([key, entry]) => [key, entry] as const);

  removeEntry(entries, fromPath);

  for (const [key, entry] of updates) {
    const suffix = key.slice(fromPath.length);
    const nextPath = `${toPath}${suffix}`;
    ensureParents(entries, nextPath);
    entries[nextPath] = entry;
  }
};

const realPath = (entries: FsEntries, pathValue: string): string => {
  const entry = entries[pathValue];
  if (entry === undefined) {
    throw systemError("realPath", pathValue);
  }
  if (entry.type !== "SymbolicLink") {
    return pathValue;
  }
  return realPath(entries, resolveRelative(dirname(pathValue), entry.target));
};

const makeCodexHomeFsLayer = (entries: FsEntries) =>
  FileSystem.layerNoop({
    readLink: (pathValue) => {
      const entry = entries[pathValue];
      return entry !== undefined && entry.type === "SymbolicLink"
        ? Effect.succeed(entry.target)
        : Effect.fail(systemError("readLink", pathValue));
    },
    realPath: (pathValue) =>
      Effect.sync(() => {
        return realPath(entries, pathValue);
      }),
    copy: (fromPath, toPath) =>
      Effect.sync(() => {
        copyEntry(entries, fromPath, toPath);
      }),
    remove: (pathValue) =>
      Effect.sync(() => {
        removeEntry(entries, pathValue);
      }),
    rename: (fromPath, toPath) =>
      Effect.sync(() => {
        renameEntry(entries, fromPath, toPath);
      }),
    stat: (pathValue) => {
      const entry = entries[pathValue];
      if (entry === undefined) {
        return Effect.fail(systemError("stat", pathValue));
      }

      return Effect.succeed({
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
        size: FileSystem.Size(0n),
        blksize: Option.none(),
        blocks: Option.none(),
      });
    },
  });

const makeTestLayer = (entries: FsEntries) =>
  CodexHomeLive.pipe(
    Layer.provideMerge(makeCodexHomeFsLayer(entries)),
    Layer.provideMerge(TestStowConfig),
    Layer.provideMerge(TestPath),
  );

describe("CodexHome service", () => {
  it.effect("previewRepair returns false for a normal local directory", () => {
    const entries: FsEntries = {
      ["/"]: { type: "Directory" },
      [testHomeDir]: { type: "Directory" },
      [`${testHomeDir}/.codex`]: { type: "Directory" },
      [testDotfilesRoot]: { type: "Directory" },
      [`${testDotfilesRoot}/home`]: { type: "Directory" },
      [`${testDotfilesRoot}/home/.codex`]: { type: "Directory" },
    };

    return Effect.gen(function* () {
      const codexHome = yield* CodexHome;
      const preview = yield* codexHome.previewRepair();

      expect(preview).toEqual({
        needsRepair: false,
        path: "/test/home/.codex",
      });
    }).pipe(Effect.provide(makeTestLayer(entries)));
  });

  it.effect("previewRepair detects the legacy repo symlink", () => {
    const entries: FsEntries = {
      ["/"]: { type: "Directory" },
      [testHomeDir]: { type: "Directory" },
      [`${testHomeDir}/.codex`]: {
        type: "SymbolicLink",
        target: "../dotfiles/home/.codex",
      },
      [testDotfilesRoot]: { type: "Directory" },
      [`${testDotfilesRoot}/home`]: { type: "Directory" },
      [`${testDotfilesRoot}/home/.codex`]: { type: "Directory" },
    };

    return Effect.gen(function* () {
      const codexHome = yield* CodexHome;
      const preview = yield* codexHome.previewRepair();

      expect(preview).toEqual({
        needsRepair: true,
        path: "/test/home/.codex",
      });
    }).pipe(Effect.provide(makeTestLayer(entries)));
  });

  it.effect("repairIfNeeded replaces the legacy symlink with a real directory copy", () => {
    const entries: FsEntries = {
      ["/"]: { type: "Directory" },
      [testHomeDir]: { type: "Directory" },
      [`${testHomeDir}/.codex`]: {
        type: "SymbolicLink",
        target: "../dotfiles/home/.codex",
      },
      [testDotfilesRoot]: { type: "Directory" },
      [`${testDotfilesRoot}/home`]: { type: "Directory" },
      [`${testDotfilesRoot}/home/.codex`]: { type: "Directory" },
      [`${testDotfilesRoot}/home/.codex/auth.json`]: {
        type: "File",
        content: "{\"token\":\"secret\"}",
      },
      [`${testDotfilesRoot}/home/.codex/AGENTS.md`]: {
        type: "SymbolicLink",
        target: "../.claude/CLAUDE.md",
      },
      [`${testDotfilesRoot}/home/.codex/skills`]: { type: "Directory" },
      [`${testDotfilesRoot}/home/.codex/skills/batch`]: {
        type: "SymbolicLink",
        target: "../../../ai/skills/batch",
      },
    };

    return Effect.gen(function* () {
      const codexHome = yield* CodexHome;
      const result = yield* codexHome.repairIfNeeded();

      expect(result).toEqual({
        repaired: true,
        path: "/test/home/.codex",
      });
      expect(entries["/test/home/.codex"]).toEqual({ type: "Directory" });
      expect(entries["/test/home/.codex/auth.json"]).toEqual({
        type: "File",
        content: "{\"token\":\"secret\"}",
      });
      expect(entries["/test/home/.codex/AGENTS.md"]).toEqual({
        type: "SymbolicLink",
        target: "../.claude/CLAUDE.md",
      });
      expect(entries["/test/home/.codex/skills/batch"]).toEqual({
        type: "SymbolicLink",
        target: "../../../ai/skills/batch",
      });
      expect(entries["/test/home/.codex.dot-repair.tmp"]).toBeUndefined();
    }).pipe(Effect.provide(makeTestLayer(entries)));
  });
});
