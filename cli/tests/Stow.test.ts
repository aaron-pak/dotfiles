import {
  CommandExecutor,
  Error as PlatformError,
  FileSystem,
  Path,
} from "@effect/platform";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Inspectable, Layer, Sink, Stream } from "effect";
import {
  AlreadyManaged,
  AlreadySymlink,
  SourceNotFound,
  Stow,
  StowConflict,
  StowError,
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
    it.effect("succeeds on exit code 0", () =>
      Effect.gen(function* () {
        const stow = yield* Stow;
        yield* stow.sync();
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

    it.effect("backup: renames files with .bak suffix", () => {
      const fsState = makeFsState();

      return Effect.gen(function* () {
        const stow = yield* Stow;
        const shouldSync = yield* stow.resolveConflicts(conflicts, "backup");

        expect(shouldSync).toBe(true);
        expect(fsState.renamed).toEqual([
          { from: "/test/home/.bashrc", to: "/test/home/.bashrc.bak" },
          { from: "/test/home/.zshrc", to: "/test/home/.zshrc.bak" },
        ]);
        expect(fsState.removed).toHaveLength(0);
      }).pipe(Effect.provide(makeTestLayer(0, "", fsState)));
    });

    it.effect("delete: removes files", () => {
      const fsState = makeFsState();

      return Effect.gen(function* () {
        const stow = yield* Stow;
        const shouldSync = yield* stow.resolveConflicts(conflicts, "delete");

        expect(shouldSync).toBe(true);
        expect(fsState.removed).toEqual([
          "/test/home/.bashrc",
          "/test/home/.zshrc",
        ]);
        expect(fsState.renamed).toHaveLength(0);
      }).pipe(Effect.provide(makeTestLayer(0, "", fsState)));
    });

    it.effect("abort: no fs calls, returns false", () => {
      const fsState = makeFsState();

      return Effect.gen(function* () {
        const stow = yield* Stow;
        const shouldSync = yield* stow.resolveConflicts(conflicts, "abort");

        expect(shouldSync).toBe(false);
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
  });
});
