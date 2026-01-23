import { Command, CommandExecutor, FileSystem, Path } from "@effect/platform";
import { Console, Data, Effect, Option, Schema, Stream } from "effect";
import { StowConfig } from "./StowConfig.js";

// -------------------------------------------------------------------------------------
// Data Types
// -------------------------------------------------------------------------------------

/**
 * Parsed from stow stderr line:
 * "* cannot stow <source> over existing target <target> since <reason>"
 */
export class StowConflict extends Schema.Class<StowConflict>("StowConflict")({
  source: Schema.String,
  target: Schema.String,
  reason: Schema.String,
}) {}

/**
 * Schema parser for stow conflict lines using TemplateLiteralParser.
 * Extracts source path, target path, and reason from stderr output.
 */
const ConflictLine = Schema.TemplateLiteralParser(
  "* cannot stow ",
  Schema.String,
  " over existing target ",
  Schema.String,
  " since ",
  Schema.String,
);

const decodeConflictLine = Schema.decodeUnknownOption(ConflictLine);

/**
 * Parse stow stderr output for conflicts.
 * Lines matching the ConflictLine schema are decoded into StowConflict instances.
 */
export const parseConflicts = (stderr: string): readonly StowConflict[] =>
  stderr.split("\n").flatMap((line) =>
    decodeConflictLine(line.trim()).pipe(
      Option.map(
        ([, source, , target, , reason]) =>
          new StowConflict({ source, target, reason }),
      ),
      Option.toArray,
    ),
  );

/**
 * Parsed from stow verbose output: "LINK: <target> => <source>"
 */
export class StowLink extends Schema.Class<StowLink>("StowLink")({
  target: Schema.String,
  source: Schema.String,
}) {}

/**
 * Schema parser for stow link lines using TemplateLiteralParser.
 * Extracts target and source paths from verbose stderr output.
 */
const LinkLine = Schema.TemplateLiteralParser(
  "LINK: ",
  Schema.String,
  " => ",
  Schema.String,
);

const decodeLinkLine = Schema.decodeUnknownOption(LinkLine);

/**
 * Parse stow stderr output for LINK lines.
 */
export const parseLinks = (stderr: string): readonly StowLink[] =>
  stderr.split("\n").flatMap((line) =>
    decodeLinkLine(line).pipe(
      Option.map(([, target, , source]) => new StowLink({ target, source })),
      Option.toArray,
    ),
  );

/**
 * Track what happened to each conflict.
 */
export class ConflictResolution extends Schema.Class<ConflictResolution>(
  "ConflictResolution",
)({
  target: Schema.String,
  action: Schema.Literal("backup", "delete"),
  backupPath: Schema.OptionFromNullOr(Schema.String),
}) {}

/**
 * Result of conflict resolution.
 */
export type ResolveResult = Data.TaggedEnum<{
  Abort: {};
  Resolved: { readonly resolutions: readonly ConflictResolution[] };
}>;
export const ResolveResult = Data.taggedEnum<ResolveResult>();

/**
 * Represents the result of a stow dry-run.
 * Contains conflicts and links that would be created.
 */
export class StowResult extends Schema.Class<StowResult>("StowResult")({
  conflicts: Schema.Array(StowConflict),
  links: Schema.Array(StowLink),
}) {}

/**
 * Error for stow execution failures.
 */
export class StowError extends Schema.TaggedError<StowError>()("StowError", {
  message: Schema.String,
}) {}

/**
 * Source file/dir doesn't exist at ~/path
 */
export class SourceNotFound extends Schema.TaggedError<SourceNotFound>()(
  "SourceNotFound",
  { path: Schema.String },
) {
  get message() {
    return `file not found: ~/${this.path}`;
  }
}

/**
 * Target already exists in home/ (already managed)
 */
export class AlreadyManaged extends Schema.TaggedError<AlreadyManaged>()(
  "AlreadyManaged",
  { path: Schema.String },
) {
  get message() {
    return `already managed: ${this.path}`;
  }
}

/**
 * Source is already a symlink (likely already managed)
 */
export class AlreadySymlink extends Schema.TaggedError<AlreadySymlink>()(
  "AlreadySymlink",
  { path: Schema.String },
) {
  get message() {
    return `already a symlink: ~/${this.path}`;
  }
}

/**
 * Path is invalid (empty, absolute, contains ..)
 */
export class InvalidPath extends Schema.TaggedError<InvalidPath>()(
  "InvalidPath",
  { path: Schema.String, reason: Schema.String },
) {
  get message() {
    return `invalid path "${this.path}": ${this.reason}`;
  }
}

/**
 * Path is not managed (doesn't exist in home/)
 */
export class NotManaged extends Schema.TaggedError<NotManaged>()("NotManaged", {
  path: Schema.String,
}) {
  get message() {
    return `not managed: ${this.path}`;
  }
}

/**
 * Source at ~/ is not a symlink
 */
export class NotSymlink extends Schema.TaggedError<NotSymlink>()("NotSymlink", {
  path: Schema.String,
}) {
  get message() {
    return `not a symlink: ~/${this.path}`;
  }
}

/**
 * Source symlink points to unexpected location
 */
export class SymlinkMismatch extends Schema.TaggedError<SymlinkMismatch>()(
  "SymlinkMismatch",
  { path: Schema.String, actual: Schema.String, expected: Schema.String },
) {
  get message() {
    return `symlink mismatch: ~/${this.path} -> ${this.actual}, expected ${this.expected}`;
  }
}

export type ConflictChoice = "backup" | "delete" | "abort";

// -------------------------------------------------------------------------------------
// Service
// -------------------------------------------------------------------------------------

export class Stow extends Effect.Service<Stow>()("@dotfiles/Stow", {
  effect: Effect.gen(function* () {
    const executor = yield* CommandExecutor.CommandExecutor;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { dotfilesRoot, homeDir } = yield* StowConfig;

    /** Run a stow command and capture stderr. */
    const runStow = (args: string[]) =>
      Effect.gen(function* () {
        const cmd = Command.make("stow", ...args).pipe(
          Command.workingDirectory(dotfilesRoot),
        );

        // Effect.scoped: executor.start returns Effect<Process, ..., Scope>.
        // Scope manages process lifecycle - when scope closes, process is
        // cleaned up (killed if running, file descriptors closed).
        // Effect.scoped creates scope, runs effect, then closes - ensuring
        // cleanup even on error. Without it, Scope leaks to callers.
        const result = yield* Effect.scoped(
          Effect.gen(function* () {
            const process = yield* executor.start(cmd);

            // process.stderr is Stream<Uint8Array> - bytes arriving over time.
            // decodeText: Uint8Array -> string chunks
            // runFold: like Array.reduce for streams - starts with "",
            // concatenates each chunk, returns final string when stream ends.
            const stderr = yield* process.stderr.pipe(
              Stream.decodeText(),
              Stream.runFold("", (acc, chunk) => acc + chunk),
            );

            const exitCode = yield* process.exitCode;

            return { exitCode, stderr };
          }),
        ).pipe(
          Effect.catchAll((error) =>
            StowError.make({
              message: `Failed to execute stow: ${error}`,
            }),
          ),
        );

        return result;
      });

    /**
     * Run a dry-run of stow and return conflicts and links that would be created.
     */
    const dryRun = Effect.fn("Stow.dryRun")(function* () {
      const { stderr } = yield* runStow(["-n", "-v", "home", "-t", homeDir]);

      // Exit code 1 with conflicts is expected during dry-run
      // Parse conflicts and links from stderr regardless of exit code
      const conflicts = parseConflicts(stderr);
      const links = parseLinks(stderr);

      return StowResult.make({ conflicts, links });
    });

    /**
     * Actually sync the dotfiles using stow.
     * Returns the links that were created.
     */
    const sync = Effect.fn("Stow.sync")(function* () {
      const { exitCode, stderr } = yield* runStow([
        "-v",
        "home",
        "-t",
        homeDir,
      ]);

      if (exitCode !== 0) {
        return yield* StowError.make({
          message: `Stow failed with exit code ${exitCode}: ${stderr}`,
        });
      }

      return parseLinks(stderr);
    });

    /**
     * Resolve conflicts by backing up or deleting conflicting files.
     * Returns Abort or Resolved with resolution details.
     */
    const resolveConflicts = Effect.fn("Stow.resolveConflicts")(function* (
      conflicts: readonly StowConflict[],
      choice: ConflictChoice,
    ) {
      if (choice === "abort") {
        yield* Console.log("Aborted. No changes were made.");
        return ResolveResult.Abort() as ResolveResult;
      }

      const resolutions: ConflictResolution[] = [];

      for (const { target } of conflicts) {
        const fullPath = path.join(homeDir, target);

        if (choice === "backup") {
          // Keep appending .bak until we find a free name
          let backupPath = `${fullPath}.bak`;
          let backupSuffix = ".bak";
          while (yield* fs.exists(backupPath)) {
            backupSuffix += ".bak";
            backupPath = `${fullPath}${backupSuffix}`;
          }
          yield* Console.log(
            `  Backing up: ${target} -> ${target}${backupSuffix}`,
          );
          yield* fs.rename(fullPath, backupPath);
          resolutions.push(
            new ConflictResolution({
              target,
              action: "backup",
              backupPath: Option.some(`${target}${backupSuffix}`),
            }),
          );
        } else if (choice === "delete") {
          yield* Console.log(`  Deleting: ${target}`);
          yield* fs.remove(fullPath);
          resolutions.push(
            new ConflictResolution({
              target,
              action: "delete",
              backupPath: Option.none(),
            }),
          );
        }
      }

      return ResolveResult.Resolved({ resolutions });
    });

    /**
     * Validate path for add operation (shared logic).
     */
    const validatePath = (p: string) =>
      Effect.gen(function* () {
        // Normalize: strip leading ./ or /
        const normalized = p.replace(/^\.\//, "").replace(/^\//, "");

        if (normalized.length === 0) {
          return yield* InvalidPath.make({
            path: p,
            reason: "path is empty",
          });
        }

        if (path.isAbsolute(p)) {
          return yield* InvalidPath.make({
            path: p,
            reason: "path must be relative to home",
          });
        }

        if (normalized.includes("..")) {
          return yield* InvalidPath.make({
            path: p,
            reason: "path cannot contain '..'",
          });
        }

        const sourcePath = path.join(homeDir, normalized);
        const targetPath = path.join(dotfilesRoot, "home", normalized);

        // Check source exists
        const sourceExists = yield* fs.exists(sourcePath);
        if (!sourceExists) {
          return yield* SourceNotFound.make({ path: normalized });
        }

        // Check source isn't already a symlink (readLink succeeds only for symlinks)
        const isSymlink = yield* fs.readLink(sourcePath).pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        );
        if (isSymlink) {
          return yield* AlreadySymlink.make({ path: normalized });
        }

        // Check target doesn't already exist in repo
        const targetExists = yield* fs.exists(targetPath);
        if (targetExists) {
          return yield* AlreadyManaged.make({ path: normalized });
        }

        return { normalized, sourcePath, targetPath };
      });

    /**
     * Check if a path can be added (dry-run validation).
     */
    const checkAddable = Effect.fn("Stow.checkAddable")(function* (p: string) {
      const result = yield* validatePath(p);
      return result.normalized;
    });

    /**
     * Add a dotfile to the repo by moving it from ~/ to home/.
     */
    const addDotfile = Effect.fn("Stow.addDotfile")(function* (p: string) {
      const { normalized, sourcePath, targetPath } = yield* validatePath(p);

      // Create parent directories in target
      const targetDir = path.dirname(targetPath);
      yield* fs.makeDirectory(targetDir, { recursive: true });

      // Move file/dir from source to target
      yield* fs.rename(sourcePath, targetPath);

      return normalized;
    });

    // -------------------------------------------------------------------------------------
    // Remove operations
    // -------------------------------------------------------------------------------------

    const homeRoot = path.join(dotfilesRoot, "home");

    type ManagedItem = { path: string; isDirectory: boolean };

    /**
     * Recursively collect all files in a directory.
     * Returns paths relative to homeRoot with type info.
     */
    const collectManagedItems = (
      targetDir: string,
    ): Effect.Effect<readonly ManagedItem[], never, never> =>
      Effect.gen(function* () {
        const items: ManagedItem[] = [];

        const walk = (dir: string): Effect.Effect<void, never, never> =>
          Effect.gen(function* () {
            const entries = yield* fs
              .readDirectory(dir)
              .pipe(Effect.orElseSucceed(() => [] as string[]));

            for (const entry of entries) {
              const fullPath = path.join(dir, entry);
              const stat = yield* fs
                .stat(fullPath)
                .pipe(Effect.orElseSucceed(() => null));

              if (stat === null) continue;

              const relativePath = fullPath.slice(homeRoot.length + 1);
              const isDir = stat.type === "Directory";
              items.push({ path: relativePath, isDirectory: isDir });

              if (isDir) {
                yield* walk(fullPath);
              }
            }
          });

        yield* walk(targetDir);
        return items;
      });

    /**
     * Remove empty parent directories up to home/ root.
     * Only removes truly empty directories.
     */
    const cleanupEmptyDirs = (targetPath: string) =>
      Effect.gen(function* () {
        let dir = path.dirname(targetPath);

        while (dir !== homeRoot && dir.startsWith(homeRoot + "/")) {
          const entries = yield* fs.readDirectory(dir);
          if (entries.length > 0) break;

          yield* fs.remove(dir);
          dir = path.dirname(dir);
        }
      });

    /**
     * Normalize path for remove operation (shared with add).
     */
    const normalizePath = (p: string) =>
      Effect.gen(function* () {
        const normalized = p.replace(/^\.\//, "").replace(/^\//, "");

        if (normalized.length === 0) {
          return yield* InvalidPath.make({
            path: p,
            reason: "path is empty",
          });
        }

        if (path.isAbsolute(p)) {
          return yield* InvalidPath.make({
            path: p,
            reason: "path must be relative to home",
          });
        }

        if (normalized.includes("..")) {
          return yield* InvalidPath.make({
            path: p,
            reason: "path cannot contain '..'",
          });
        }

        return normalized;
      });

    /**
     * Validate a single item can be removed (is a symlink pointing to repo).
     */
    const validateSingleRemovable = (normalized: string) =>
      Effect.gen(function* () {
        const sourcePath = path.join(homeDir, normalized);
        const targetPath = path.join(homeRoot, normalized);

        // Check symlink exists at source
        const linkTarget = yield* fs
          .readLink(sourcePath)
          .pipe(Effect.catchAll(() => Effect.succeed(null)));

        if (linkTarget === null) {
          return yield* NotSymlink.make({ path: normalized });
        }

        // Resolve and compare - symlink should point to our target
        const resolvedLink = path.resolve(path.dirname(sourcePath), linkTarget);
        if (resolvedLink !== targetPath) {
          return yield* SymlinkMismatch.make({
            path: normalized,
            actual: linkTarget,
            expected: targetPath,
          });
        }

        return { normalized, sourcePath, targetPath };
      });

    /**
     * Validate path for remove operation.
     * Handles both single files and directories.
     */
    const validateRemovable = (p: string) =>
      Effect.gen(function* () {
        const normalized = yield* normalizePath(p);

        const sourcePath = path.join(homeDir, normalized);
        const targetPath = path.join(homeRoot, normalized);

        // Check target exists in repo
        const targetExists = yield* fs.exists(targetPath);
        if (!targetExists) {
          return yield* NotManaged.make({ path: normalized });
        }

        // Check if source is a symlink pointing to target (tree-folded directory)
        const linkTarget = yield* fs
          .readLink(sourcePath)
          .pipe(Effect.catchAll(() => Effect.succeed(null)));

        if (linkTarget !== null) {
          const resolvedLink = path.resolve(
            path.dirname(sourcePath),
            linkTarget,
          );
          if (resolvedLink === targetPath) {
            // Source is a symlink directly to target - tree-folded case
            const stat = yield* fs.stat(targetPath);
            const isDirectory = stat.type === "Directory";
            return {
              normalized,
              sourcePath,
              targetPath,
              isDirectory,
              isDirectorySymlink: isDirectory,
              items: [] as readonly ManagedItem[],
            };
          } else {
            // Symlink points elsewhere
            return yield* SymlinkMismatch.make({
              path: normalized,
              actual: linkTarget,
              expected: targetPath,
            });
          }
        }

        // Source is not a symlink - check if target is a directory
        const stat = yield* fs.stat(targetPath);
        const isDirectory = stat.type === "Directory";

        if (isDirectory) {
          // Collect all items and validate each file symlink
          const items = yield* collectManagedItems(targetPath);

          for (const item of items) {
            if (!item.isDirectory) {
              yield* validateSingleRemovable(item.path);
            }
          }

          return {
            normalized,
            sourcePath,
            targetPath,
            isDirectory: true,
            isDirectorySymlink: false,
            items,
          };
        } else {
          // Single file that's not a symlink - error
          return yield* NotSymlink.make({ path: normalized });
        }
      });

    /**
     * Check if a path can be removed (dry-run validation).
     */
    const checkRemovable = Effect.fn("Stow.checkRemovable")(function* (
      p: string,
    ) {
      const result = yield* validateRemovable(p);
      return {
        normalized: result.normalized,
        isDirectory: result.isDirectory,
        itemCount: result.items.length,
      };
    });

    /**
     * Remove a dotfile from management by moving it back to ~/.
     */
    const removeDotfile = Effect.fn("Stow.removeDotfile")(function* (
      p: string,
    ) {
      const { normalized, isDirectory, isDirectorySymlink, items } =
        yield* validateRemovable(p);

      if (isDirectorySymlink) {
        // Tree-folded: entire directory is a symlink
        const sourcePath = path.join(homeDir, normalized);
        const targetPath = path.join(homeRoot, normalized);

        // Remove symlink
        yield* fs.remove(sourcePath);

        // Ensure parent dir exists at ~/
        yield* fs.makeDirectory(path.dirname(sourcePath), { recursive: true });

        // Move entire directory back
        yield* fs.rename(targetPath, sourcePath);
      } else if (isDirectory) {
        // Separate files and directories using pre-computed type info
        const files = items.filter((item) => !item.isDirectory);
        const dirs = items.filter((item) => item.isDirectory);

        // Sort by depth (deepest first) for proper removal order
        const sortByDepth = (a: ManagedItem, b: ManagedItem) =>
          b.path.split("/").length - a.path.split("/").length;
        files.sort(sortByDepth);
        dirs.sort(sortByDepth);

        // Remove files first
        for (const item of files) {
          const itemSourcePath = path.join(homeDir, item.path);
          const itemTargetPath = path.join(homeRoot, item.path);

          // Delete symlink
          yield* fs.remove(itemSourcePath);

          // Ensure parent dir exists at ~/
          yield* fs.makeDirectory(path.dirname(itemSourcePath), {
            recursive: true,
          });

          // Move file back
          yield* fs.rename(itemTargetPath, itemSourcePath);
        }

        // Remove directories (now empty in repo)
        for (const item of dirs) {
          const itemSourcePath = path.join(homeDir, item.path);
          const itemTargetPath = path.join(homeRoot, item.path);

          // Only remove symlink if it exists (dir might already exist at ~/)
          const isSymlink = yield* fs.readLink(itemSourcePath).pipe(
            Effect.as(true),
            Effect.catchAll(() => Effect.succeed(false)),
          );
          if (isSymlink) {
            yield* fs.remove(itemSourcePath);
          }

          // Ensure dir exists at ~/
          yield* fs.makeDirectory(itemSourcePath, { recursive: true });

          // Remove the now-empty dir from repo
          yield* fs
            .remove(itemTargetPath)
            .pipe(Effect.catchAll(() => Effect.void));
        }

        // Clean up the root directory
        const rootTargetPath = path.join(homeRoot, normalized);
        yield* fs
          .remove(rootTargetPath)
          .pipe(Effect.catchAll(() => Effect.void));
      } else {
        // Single file
        const sourcePath = path.join(homeDir, normalized);
        const targetPath = path.join(homeRoot, normalized);

        // Delete symlink
        yield* fs.remove(sourcePath);

        // Ensure parent dir exists at ~/
        yield* fs.makeDirectory(path.dirname(sourcePath), { recursive: true });

        // Move file back
        yield* fs.rename(targetPath, sourcePath);
      }

      // Clean up empty parent directories in home/
      yield* cleanupEmptyDirs(path.join(homeRoot, normalized));

      return normalized;
    });

    return {
      dryRun,
      resolveConflicts,
      sync,
      checkAddable,
      addDotfile,
      checkRemovable,
      removeDotfile,
    };
  }),
}) {}
