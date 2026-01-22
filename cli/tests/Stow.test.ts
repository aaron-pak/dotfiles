import {
  CommandExecutor,
  Error as PlatformError,
  FileSystem,
  Path,
} from "@effect/platform";
import { describe, expect, it } from "@effect/vitest";
import assert from "node:assert";
import { Effect, Inspectable, Layer, Option, Sink, Stream } from "effect";
import {
  AlreadyManaged,
  AlreadySymlink,
  ConflictResolution,
  SourceNotFound,
  Stow,
  StowConflict,
  StowError,
  StowLink,
} from "../src/services/Stow.js";
import { StowConfig } from "../src/services/StowConfig.js";

// Test paths
const testDotfilesRoot = "/test/dotfiles";
const testHomeDir = "/test/home";

// Mock StowConfig
const TestStowConfig = Layer.succeed(
  StowConfig,
  StowConfig.make({
    dotfilesRoot: testDotfilesRoot,
    homeDir: testHomeDir,
  }),
);

// Use built-in POSIX Path layer
const TestPath = Path.layer;

// Process prototype matching Effect's internal pattern
const ProcessProto = {
  [CommandExecutor.ProcessTypeId]: CommandExecutor.ProcessTypeId,
  ...Inspectable.BaseProto,
  toJSON(this: CommandExecutor.Process) {
    return {
      _id: "@effect/platform/CommandExecutor/Process",
      pid: this.pid,
    };
  },
};

const mockProcess = (
  exitCode: number,
  stderr: string,
): CommandExecutor.Process =>
  Object.assign(Object.create(ProcessProto), {
    pid: CommandExecutor.ProcessId(1),
    exitCode: Effect.succeed(CommandExecutor.ExitCode(exitCode)),
    isRunning: Effect.succeed(false),
    stdin: Sink.drain,
    stdout: Stream.empty,
    stderr: Stream.make(new TextEncoder().encode(stderr)),
    kill: () => Effect.void,
  });

const mockExecutor = (exitCode: number, stderr: string) =>
  Layer.succeed(
    CommandExecutor.CommandExecutor,
    CommandExecutor.makeExecutor(() =>
      Effect.succeed(mockProcess(exitCode, stderr)),
    ),
  );

const mockExecutorFailure = () =>
  Layer.succeed(
    CommandExecutor.CommandExecutor,
    CommandExecutor.makeExecutor(() =>
      Effect.fail(
        new PlatformError.SystemError({
          reason: "NotFound",
          module: "Command",
          method: "spawn",
          pathOrDescriptor: "stow",
        }),
      ),
    ),
  );

// Helper to create mock FileSystem
type FsState = {
  exists: Set<string>;
  symlinks: Set<string>;
  renamed: Array<{ from: string; to: string }>;
  removed: string[];
  mkdirs: string[];
};

const makeFsState = (overrides: Partial<FsState> = {}): FsState => ({
  exists: new Set(),
  symlinks: new Set(),
  renamed: [],
  removed: [],
  mkdirs: [],
  ...overrides,
});

const notFound = (method: string, path: string) =>
  new PlatformError.SystemError({
    module: "FileSystem",
    method,
    reason: "NotFound",
    pathOrDescriptor: path,
  });

const mockFileSystem = (state: FsState) =>
  FileSystem.layerNoop({
    exists: (path) => Effect.succeed(state.exists.has(path)),
    readLink: (path) =>
      state.symlinks.has(path)
        ? Effect.succeed("/some/target")
        : Effect.fail(notFound("readLink", path)),
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
  });

// Compose all test dependencies into single layer
const makeTestLayer = (exitCode: number, stderr: string, fsState: FsState) =>
  Stow.Default.pipe(
    Layer.provideMerge(mockExecutor(exitCode, stderr)),
    Layer.provideMerge(mockFileSystem(fsState)),
    Layer.provideMerge(TestStowConfig),
    Layer.provideMerge(TestPath),
  );

const makeTestLayerWithFailingExecutor = (fsState: FsState) =>
  Stow.Default.pipe(
    Layer.provideMerge(mockExecutorFailure()),
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

    it.effect("backup: renames files, returns Resolved with resolutions", () => {
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
    });

    it.effect("delete: removes files, returns Resolved with resolutions", () => {
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
    });

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
        symlinks: new Set(["/test/home/.bashrc"]),
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
    it.effect("executor failure -> StowError", () => {
      const fsState = makeFsState();

      return Effect.gen(function* () {
        const stow = yield* Stow;
        const result = yield* stow.dryRun().pipe(Effect.flip);

        expect(result).toBeInstanceOf(StowError);
        expect(result.message).toContain("Failed to execute stow");
      }).pipe(Effect.provide(makeTestLayerWithFailingExecutor(fsState)));
    });
  });
});
