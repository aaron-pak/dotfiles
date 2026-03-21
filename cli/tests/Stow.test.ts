import { describe, expect, it } from "@effect/vitest";
import assert from "node:assert";
import {
  Effect,
  FileSystem,
  Layer,
  Option,
  PlatformError,
} from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import {
  AlreadyManaged,
  AlreadySymlink,
  ConflictResolution,
  NotManaged,
  NotSymlink,
  SourceNotFound,
  Stow,
  StowConflict,
  StowError,
  StowLink,
  SymlinkMismatch,
} from "../src/services/Stow.js";
import {
  makeFailingChildProcessSpawner,
  makeMockChildProcessHandle,
  makeMockChildProcessSpawner,
  TestPath,
  TestStowConfig,
} from "./testSupport.js";

type FsState = {
  exists: Set<string>;
  symlinks: Map<string, string>;
  directories: Set<string>;
  renamed: Array<{ from: string; to: string }>;
  removed: string[];
  mkdirs: string[];
  directoryContents: Map<string, string[]>;
};

const makeFsState = (overrides: Partial<FsState> = {}): FsState => ({
  exists: new Set(),
  symlinks: new Map(),
  directories: new Set(),
  renamed: [],
  removed: [],
  mkdirs: [],
  directoryContents: new Map(),
  ...overrides,
});

const notFound = (method: string, path: string) =>
  PlatformError.systemError({
    _tag: "NotFound",
    module: "FileSystem",
    method,
    pathOrDescriptor: path,
  });

const mockFileSystem = (state: FsState) =>
  FileSystem.layerNoop({
    exists: (path) => Effect.succeed(state.exists.has(path)),
    readLink: (path) => {
      const target = state.symlinks.get(path);
      return target
        ? Effect.succeed(target)
        : Effect.fail(notFound("readLink", path));
    },
    rename: (from, to) =>
      Effect.sync(() => {
        state.renamed.push({ from, to });
      }),
    remove: (path) =>
      Effect.sync(() => {
        state.removed.push(path);
      }),
    makeDirectory: (path) =>
      Effect.sync(() => {
        state.mkdirs.push(path);
      }),
    stat: (path) =>
      state.exists.has(path)
        ? Effect.succeed({
            type: state.directories.has(path) ? "Directory" : "File",
            mtime: Option.some(new Date()),
            atime: Option.some(new Date()),
            birthtime: Option.some(new Date()),
            dev: 0,
            ino: Option.some(0),
            mode: 0,
            nlink: Option.some(0),
            uid: Option.some(0),
            gid: Option.some(0),
            rdev: Option.some(0),
            size: FileSystem.Size(0n),
            blksize: Option.some(FileSystem.Size(0n)),
            blocks: Option.some(0),
          })
        : Effect.fail(notFound("stat", path)),
    readDirectory: (path) => {
      const contents = state.directoryContents.get(path);
      return contents
        ? Effect.succeed(contents)
        : Effect.fail(notFound("readDirectory", path));
    },
  });

const makeTestLayer = (exitCode: number, stderr: string, fsState: FsState) =>
  Stow.Live.pipe(
    Layer.provideMerge(
      makeMockChildProcessSpawner({ exitCode, stderr }),
    ),
    Layer.provideMerge(mockFileSystem(fsState)),
    Layer.provideMerge(TestStowConfig),
    Layer.provideMerge(TestPath),
  );

const makeTestLayerWithFailingSpawner = (fsState: FsState) =>
  Stow.Live.pipe(
    Layer.provideMerge(makeFailingChildProcessSpawner("stow")),
    Layer.provideMerge(mockFileSystem(fsState)),
    Layer.provideMerge(TestStowConfig),
    Layer.provideMerge(TestPath),
  );

describe("Stow service", () => {
  describe("dryRun", () => {
    it.effect("returns conflicts from stderr", () =>
      Effect.gen(function* () {
        const stow = yield* Stow;
        const result = yield* stow.dryRun();

        expect(result.conflicts).toHaveLength(2);
        expect(result.conflicts[0]).toEqual(
          new StowConflict({
            source: ".bashrc",
            target: ".bashrc",
            reason: "neither a link nor a directory",
          }),
        );
      }).pipe(
        Effect.provide(
          makeTestLayer(
            1,
            `WARNING: some warning
* cannot stow .bashrc over existing target .bashrc since neither a link nor a directory
* cannot stow .zshrc over existing target .zshrc since it is a directory`,
            makeFsState(),
          ),
        ),
      ),
    );

    it.effect("returns empty conflicts on clean stderr", () =>
      Effect.gen(function* () {
        const stow = yield* Stow;
        const result = yield* stow.dryRun();

        expect(result.conflicts).toHaveLength(0);
      }).pipe(
        Effect.provide(
          makeTestLayer(0, "LINK: .bashrc => home/.bashrc", makeFsState()),
        ),
      ),
    );

    it.effect("passes --no-folding to stow dry-run", () => {
      const commands: string[][] = [];

      const recordingSpawner = Layer.succeed(
        ChildProcessSpawner.ChildProcessSpawner,
        ChildProcessSpawner.make((command) =>
          Effect.sync(() => {
            if (command._tag === "StandardCommand") {
              commands.push([command.command, ...command.args]);
            }
            return makeMockChildProcessHandle({ exitCode: 0, stderr: "" });
          }),
        ),
      );

      return Effect.gen(function* () {
        const stow = yield* Stow;
        yield* stow.dryRun();

        expect(commands).toEqual([
          ["stow", "--no-folding", "-n", "-v", "home", "-t", "/test/home"],
        ]);
      }).pipe(
        Effect.provide(
          Stow.Live.pipe(
            Layer.provideMerge(recordingSpawner),
            Layer.provideMerge(mockFileSystem(makeFsState())),
            Layer.provideMerge(TestStowConfig),
            Layer.provideMerge(TestPath),
          ),
        ),
      );
    });
  });

  describe("sync", () => {
    it.effect("returns parsed links on exit code 0", () =>
      Effect.gen(function* () {
        const stow = yield* Stow;
        const links = yield* stow.sync();

        expect(links).toHaveLength(2);
        expect(links[0]).toEqual(
          new StowLink({ target: ".bashrc", source: "home/.bashrc" }),
        );
        expect(links[1]).toEqual(
          new StowLink({ target: ".zshrc", source: "home/.zshrc" }),
        );
      }).pipe(
        Effect.provide(
          makeTestLayer(
            0,
            "LINK: .bashrc => home/.bashrc\nLINK: .zshrc => home/.zshrc",
            makeFsState(),
          ),
        ),
      ),
    );

    it.effect("returns empty links when no output", () =>
      Effect.gen(function* () {
        const stow = yield* Stow;
        const links = yield* stow.sync();

        expect(links).toHaveLength(0);
      }).pipe(Effect.provide(makeTestLayer(0, "", makeFsState()))),
    );

    it.effect("fails with StowError on exit code 1", () =>
      Effect.gen(function* () {
        const stow = yield* Stow;
        const result = yield* stow.sync().pipe(Effect.flip);

        expect(result).toBeInstanceOf(StowError);
        expect(result.message).toContain("Stow failed with exit code 1");
      }).pipe(Effect.provide(makeTestLayer(1, "some error", makeFsState()))),
    );

    it.effect("passes --no-folding to stow sync", () => {
      const commands: string[][] = [];

      const recordingSpawner = Layer.succeed(
        ChildProcessSpawner.ChildProcessSpawner,
        ChildProcessSpawner.make((command) =>
          Effect.sync(() => {
            if (command._tag === "StandardCommand") {
              commands.push([command.command, ...command.args]);
            }
            return makeMockChildProcessHandle({ exitCode: 0, stderr: "" });
          }),
        ),
      );

      return Effect.gen(function* () {
        const stow = yield* Stow;
        yield* stow.sync();

        expect(commands).toEqual([
          ["stow", "--no-folding", "-v", "home", "-t", "/test/home"],
        ]);
      }).pipe(
        Effect.provide(
          Stow.Live.pipe(
            Layer.provideMerge(recordingSpawner),
            Layer.provideMerge(mockFileSystem(makeFsState())),
            Layer.provideMerge(TestStowConfig),
            Layer.provideMerge(TestPath),
          ),
        ),
      );
    });
  });

  describe("resolveConflicts", () => {
    const conflicts = [
      new StowConflict({
        source: ".bashrc",
        target: ".bashrc",
        reason: "exists",
      }),
      new StowConflict({
        source: ".zshrc",
        target: ".zshrc",
        reason: "exists",
      }),
    ];

    it.effect(
      "backup: renames files, returns Resolved with resolutions",
      () => {
        const fsState = makeFsState();

        return Effect.gen(function* () {
          const stow = yield* Stow;
          const result = yield* stow.resolveConflicts(conflicts, "backup");

          expect(result._tag).toBe("Resolved");
          assert(result._tag === "Resolved");
          expect(result.resolutions).toHaveLength(2);
          expect(result.resolutions[0]).toEqual(
            new ConflictResolution({
              target: ".bashrc",
              action: "backup",
              backupPath: Option.some(".bashrc.bak"),
            }),
          );
          expect(result.resolutions[1]).toEqual(
            new ConflictResolution({
              target: ".zshrc",
              action: "backup",
              backupPath: Option.some(".zshrc.bak"),
            }),
          );
          expect(fsState.renamed).toEqual([
            { from: "/test/home/.bashrc", to: "/test/home/.bashrc.bak" },
            { from: "/test/home/.zshrc", to: "/test/home/.zshrc.bak" },
          ]);
          expect(fsState.removed).toHaveLength(0);
        }).pipe(Effect.provide(makeTestLayer(0, "", fsState)));
      },
    );

    it.effect(
      "delete: removes files, returns Resolved with resolutions",
      () => {
        const fsState = makeFsState();

        return Effect.gen(function* () {
          const stow = yield* Stow;
          const result = yield* stow.resolveConflicts(conflicts, "delete");

          expect(result._tag).toBe("Resolved");
          assert(result._tag === "Resolved");
          expect(result.resolutions).toHaveLength(2);
          expect(result.resolutions[0]).toEqual(
            new ConflictResolution({
              target: ".bashrc",
              action: "delete",
              backupPath: Option.none(),
            }),
          );
          expect(result.resolutions[1]).toEqual(
            new ConflictResolution({
              target: ".zshrc",
              action: "delete",
              backupPath: Option.none(),
            }),
          );
          expect(fsState.removed).toEqual([
            "/test/home/.bashrc",
            "/test/home/.zshrc",
          ]);
          expect(fsState.renamed).toHaveLength(0);
        }).pipe(Effect.provide(makeTestLayer(0, "", fsState)));
      },
    );

    it.effect("abort: no fs calls, returns Abort", () => {
      const fsState = makeFsState();

      return Effect.gen(function* () {
        const stow = yield* Stow;
        const result = yield* stow.resolveConflicts(conflicts, "abort");

        expect(result._tag).toBe("Abort");
        expect(fsState.renamed).toHaveLength(0);
        expect(fsState.removed).toHaveLength(0);
      }).pipe(Effect.provide(makeTestLayer(0, "", fsState)));
    });
  });

  describe("checkAddable", () => {
    it.effect("valid path succeeds", () => {
      const fsState = makeFsState({ exists: new Set(["/test/home/.bashrc"]) });

      return Effect.gen(function* () {
        const stow = yield* Stow;
        const result = yield* stow.checkAddable(".bashrc");

        expect(result).toBe(".bashrc");
      }).pipe(Effect.provide(makeTestLayer(0, "", fsState)));
    });

    it.effect("nonexistent path -> SourceNotFound", () => {
      const fsState = makeFsState();

      return Effect.gen(function* () {
        const stow = yield* Stow;
        const result = yield* stow.checkAddable(".bashrc").pipe(Effect.flip);

        expect(result).toBeInstanceOf(SourceNotFound);
      }).pipe(Effect.provide(makeTestLayer(0, "", fsState)));
    });

    it.effect("already symlink -> AlreadySymlink", () => {
      const fsState = makeFsState({
        exists: new Set(["/test/home/.bashrc"]),
        symlinks: new Map([["/test/home/.bashrc", "/some/target"]]),
      });

      return Effect.gen(function* () {
        const stow = yield* Stow;
        const result = yield* stow.checkAddable(".bashrc").pipe(Effect.flip);

        expect(result).toBeInstanceOf(AlreadySymlink);
      }).pipe(Effect.provide(makeTestLayer(0, "", fsState)));
    });

    it.effect("already managed -> AlreadyManaged", () => {
      const fsState = makeFsState({
        exists: new Set(["/test/home/.bashrc", "/test/dotfiles/home/.bashrc"]),
      });

      return Effect.gen(function* () {
        const stow = yield* Stow;
        const result = yield* stow.checkAddable(".bashrc").pipe(Effect.flip);

        expect(result).toBeInstanceOf(AlreadyManaged);
      }).pipe(Effect.provide(makeTestLayer(0, "", fsState)));
    });

    it.effect("empty path -> InvalidPath", () => {
      const fsState = makeFsState();

      return Effect.gen(function* () {
        const stow = yield* Stow;
        const result = yield* stow.checkAddable("").pipe(Effect.flip);

        assert(result._tag === "InvalidPath");
        expect(result.reason).toBe("path is empty");
      }).pipe(Effect.provide(makeTestLayer(0, "", fsState)));
    });

    it.effect("absolute path -> InvalidPath", () => {
      const fsState = makeFsState();

      return Effect.gen(function* () {
        const stow = yield* Stow;
        const result = yield* stow
          .checkAddable("/etc/passwd")
          .pipe(Effect.flip);

        assert(result._tag === "InvalidPath");
        expect(result.reason).toBe("path must be relative to home");
      }).pipe(Effect.provide(makeTestLayer(0, "", fsState)));
    });

    it.effect("path with .. -> InvalidPath", () => {
      const fsState = makeFsState();

      return Effect.gen(function* () {
        const stow = yield* Stow;
        const result = yield* stow
          .checkAddable(".config/../../../etc/passwd")
          .pipe(Effect.flip);

        assert(result._tag === "InvalidPath");
        expect(result.reason).toBe("path cannot contain '..'");
      }).pipe(Effect.provide(makeTestLayer(0, "", fsState)));
    });

    it.effect("normalizes ./ prefix", () => {
      const fsState = makeFsState({ exists: new Set(["/test/home/.bashrc"]) });

      return Effect.gen(function* () {
        const stow = yield* Stow;
        const result = yield* stow.checkAddable("./.bashrc");

        expect(result).toBe(".bashrc");
      }).pipe(Effect.provide(makeTestLayer(0, "", fsState)));
    });
  });

  describe("addDotfile", () => {
    it.effect("moves file and creates parent dirs", () => {
      const fsState = makeFsState({
        exists: new Set(["/test/home/.config/app/config.json"]),
      });

      return Effect.gen(function* () {
        const stow = yield* Stow;
        const result = yield* stow.addDotfile(".config/app/config.json");

        expect(result).toBe(".config/app/config.json");
        expect(fsState.mkdirs).toContain("/test/dotfiles/home/.config/app");
        expect(fsState.renamed).toEqual([
          {
            from: "/test/home/.config/app/config.json",
            to: "/test/dotfiles/home/.config/app/config.json",
          },
        ]);
      }).pipe(Effect.provide(makeTestLayer(0, "", fsState)));
    });

    it.effect("root level file (no nested parent)", () => {
      const fsState = makeFsState({ exists: new Set(["/test/home/.bashrc"]) });

      return Effect.gen(function* () {
        const stow = yield* Stow;
        const result = yield* stow.addDotfile(".bashrc");

        expect(result).toBe(".bashrc");
        expect(fsState.mkdirs).toContain("/test/dotfiles/home");
        expect(fsState.renamed).toEqual([
          {
            from: "/test/home/.bashrc",
            to: "/test/dotfiles/home/.bashrc",
          },
        ]);
      }).pipe(Effect.provide(makeTestLayer(0, "", fsState)));
    });

    it.effect("propagates SourceNotFound", () => {
      const fsState = makeFsState();

      return Effect.gen(function* () {
        const stow = yield* Stow;
        const result = yield* stow.addDotfile(".nonexistent").pipe(Effect.flip);

        expect(result).toBeInstanceOf(SourceNotFound);
      }).pipe(Effect.provide(makeTestLayer(0, "", fsState)));
    });
  });

  describe("runStow error handling", () => {
    it.effect("spawner failure -> StowError", () => {
      const fsState = makeFsState();

      return Effect.gen(function* () {
        const stow = yield* Stow;
        const result = yield* stow.dryRun().pipe(Effect.flip);

        expect(result).toBeInstanceOf(StowError);
        expect(result.message).toContain("Failed to execute stow");
      }).pipe(Effect.provide(makeTestLayerWithFailingSpawner(fsState)));
    });
  });

  describe("checkRemovable", () => {
    it.effect("valid managed file succeeds", () => {
      const fsState = makeFsState({
        exists: new Set(["/test/dotfiles/home/.bashrc", "/test/home/.bashrc"]),
        symlinks: new Map([["/test/home/.bashrc", "../dotfiles/home/.bashrc"]]),
      });

      return Effect.gen(function* () {
        const stow = yield* Stow;
        const result = yield* stow.checkRemovable(".bashrc");

        expect(result.normalized).toBe(".bashrc");
        expect(result.isDirectory).toBe(false);
      }).pipe(Effect.provide(makeTestLayer(0, "", fsState)));
    });

    it.effect("not managed -> NotManaged", () => {
      const fsState = makeFsState();

      return Effect.gen(function* () {
        const stow = yield* Stow;
        const result = yield* stow.checkRemovable(".bashrc").pipe(Effect.flip);

        expect(result).toBeInstanceOf(NotManaged);
      }).pipe(Effect.provide(makeTestLayer(0, "", fsState)));
    });

    it.effect("not a symlink -> NotSymlink", () => {
      const fsState = makeFsState({
        exists: new Set(["/test/dotfiles/home/.bashrc", "/test/home/.bashrc"]),
      });

      return Effect.gen(function* () {
        const stow = yield* Stow;
        const result = yield* stow.checkRemovable(".bashrc").pipe(Effect.flip);

        expect(result).toBeInstanceOf(NotSymlink);
      }).pipe(Effect.provide(makeTestLayer(0, "", fsState)));
    });

    it.effect("symlink mismatch -> SymlinkMismatch", () => {
      const fsState = makeFsState({
        exists: new Set(["/test/dotfiles/home/.bashrc", "/test/home/.bashrc"]),
        symlinks: new Map([["/test/home/.bashrc", "/some/other/path"]]),
      });

      return Effect.gen(function* () {
        const stow = yield* Stow;
        const result = yield* stow.checkRemovable(".bashrc").pipe(Effect.flip);

        expect(result).toBeInstanceOf(SymlinkMismatch);
      }).pipe(Effect.provide(makeTestLayer(0, "", fsState)));
    });

    it.effect("empty path -> InvalidPath", () => {
      const fsState = makeFsState();

      return Effect.gen(function* () {
        const stow = yield* Stow;
        const result = yield* stow.checkRemovable("").pipe(Effect.flip);

        assert(result._tag === "InvalidPath");
        expect(result.reason).toBe("path is empty");
      }).pipe(Effect.provide(makeTestLayer(0, "", fsState)));
    });
  });

  describe("removeDotfile", () => {
    it.effect("removes symlink and moves file back", () => {
      const fsState = makeFsState({
        exists: new Set(["/test/dotfiles/home/.bashrc", "/test/home/.bashrc"]),
        symlinks: new Map([["/test/home/.bashrc", "../dotfiles/home/.bashrc"]]),
      });

      return Effect.gen(function* () {
        const stow = yield* Stow;
        const result = yield* stow.removeDotfile(".bashrc");

        expect(result).toBe(".bashrc");
        expect(fsState.removed).toContain("/test/home/.bashrc");
        expect(fsState.renamed).toContainEqual({
          from: "/test/dotfiles/home/.bashrc",
          to: "/test/home/.bashrc",
        });
      }).pipe(Effect.provide(makeTestLayer(0, "", fsState)));
    });

    it.effect("propagates NotManaged", () => {
      const fsState = makeFsState();

      return Effect.gen(function* () {
        const stow = yield* Stow;
        const result = yield* stow
          .removeDotfile(".nonexistent")
          .pipe(Effect.flip);

        expect(result).toBeInstanceOf(NotManaged);
      }).pipe(Effect.provide(makeTestLayer(0, "", fsState)));
    });
  });
});
