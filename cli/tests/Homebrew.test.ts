import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer } from "effect";
import {
  BrewBundleError,
  BrewfileNotFound,
  BundleCheckResult,
  BundleResult,
  Homebrew,
  HomebrewInstallError,
  InstalledPackage,
} from "../src/services/Homebrew.js";
import {
  makeFailingChildProcessSpawner,
  makeMockChildProcessSpawner,
  TestPath,
  TestStowConfig,
} from "./testSupport.js";

type FsState = {
  exists: Set<string>;
};

const makeFsState = (overrides: Partial<FsState> = {}): FsState => ({
  exists: new Set(),
  ...overrides,
});

const mockFileSystem = (state: FsState) =>
  FileSystem.layerNoop({
    exists: (path) => Effect.succeed(state.exists.has(path)),
  });

const makeTestLayer = (
  exitCode: number,
  stdout: string,
  stderr: string,
  fsState: FsState,
) =>
  Homebrew.Live.pipe(
    Layer.provideMerge(
      makeMockChildProcessSpawner({ exitCode, stdout, stderr }),
    ),
    Layer.provideMerge(mockFileSystem(fsState)),
    Layer.provideMerge(TestStowConfig),
    Layer.provideMerge(TestPath),
  );

const makeTestLayerWithFailingSpawner = (fsState: FsState) =>
  Homebrew.Live.pipe(
    Layer.provideMerge(makeFailingChildProcessSpawner("brew")),
    Layer.provideMerge(mockFileSystem(fsState)),
    Layer.provideMerge(TestStowConfig),
    Layer.provideMerge(TestPath),
  );

describe("Homebrew service", () => {
  describe("checkInstalled", () => {
    it.effect("returns true when brew is found", () =>
      Effect.gen(function* () {
        const homebrew = yield* Homebrew;
        const result = yield* homebrew.checkInstalled();

        expect(result).toBe(true);
      }).pipe(
        Effect.provide(
          makeTestLayer(0, "/opt/homebrew/bin/brew", "", makeFsState()),
        ),
      ),
    );

    it.effect("returns false when brew is not found", () =>
      Effect.gen(function* () {
        const homebrew = yield* Homebrew;
        const result = yield* homebrew.checkInstalled();

        expect(result).toBe(false);
      }).pipe(Effect.provide(makeTestLayer(1, "", "", makeFsState()))),
    );

    it.effect("returns false on spawner failure", () =>
      Effect.gen(function* () {
        const homebrew = yield* Homebrew;
        const result = yield* homebrew.checkInstalled();

        expect(result).toBe(false);
      }).pipe(Effect.provide(makeTestLayerWithFailingSpawner(makeFsState()))),
    );
  });

  describe("install", () => {
    it.effect("succeeds on exit code 0", () =>
      Effect.gen(function* () {
        const homebrew = yield* Homebrew;
        yield* homebrew.install();
      }).pipe(
        Effect.provide(
          makeTestLayer(0, "==> Installation successful!", "", makeFsState()),
        ),
      ),
    );

    it.effect("fails with HomebrewInstallError on non-zero exit", () =>
      Effect.gen(function* () {
        const homebrew = yield* Homebrew;
        const result = yield* homebrew.install().pipe(Effect.flip);

        expect(result).toBeInstanceOf(HomebrewInstallError);
      }).pipe(
        Effect.provide(
          makeTestLayer(1, "", "Installation failed", makeFsState()),
        ),
      ),
    );
  });

  describe("bundle", () => {
    it.effect("fails with BrewfileNotFound when Brewfile missing", () =>
      Effect.gen(function* () {
        const homebrew = yield* Homebrew;
        const result = yield* homebrew.bundle().pipe(Effect.flip);

        expect(result).toBeInstanceOf(BrewfileNotFound);
        if (result._tag === "BrewfileNotFound") {
          expect(result.path).toBe("/test/dotfiles/Brewfile");
        }
      }).pipe(Effect.provide(makeTestLayer(0, "", "", makeFsState()))),
    );

    it.effect("parses installed packages from output", () => {
      const fsState = makeFsState({
        exists: new Set(["/test/dotfiles/Brewfile"]),
      });

      const stdout = `Installing stow
Installing neovim
Installing cask ghostty
Using ripgrep`;

      return Effect.gen(function* () {
        const homebrew = yield* Homebrew;
        const result = yield* homebrew.bundle();

        expect(result).toBeInstanceOf(BundleResult);
        expect(result.installed).toHaveLength(3);
        expect(result.installed[0]).toEqual(
          new InstalledPackage({ name: "stow", type: "formula" }),
        );
        expect(result.installed[2]).toEqual(
          new InstalledPackage({ name: "ghostty", type: "cask" }),
        );
        expect(result.skipped).toHaveLength(1);
        expect(result.skipped[0]).toEqual(
          new InstalledPackage({ name: "ripgrep", type: "formula" }),
        );
      }).pipe(Effect.provide(makeTestLayer(0, stdout, "", fsState)));
    });

    it.effect("fails with BrewBundleError on non-zero exit", () => {
      const fsState = makeFsState({
        exists: new Set(["/test/dotfiles/Brewfile"]),
      });

      return Effect.gen(function* () {
        const homebrew = yield* Homebrew;
        const result = yield* homebrew.bundle().pipe(Effect.flip);

        expect(result).toBeInstanceOf(BrewBundleError);
      }).pipe(Effect.provide(makeTestLayer(1, "", "bundle failed", fsState)));
    });
  });

  describe("bundleDryRun", () => {
    it.effect("fails with BrewfileNotFound when Brewfile missing", () =>
      Effect.gen(function* () {
        const homebrew = yield* Homebrew;
        const result = yield* homebrew.bundleDryRun().pipe(Effect.flip);

        expect(result).toBeInstanceOf(BrewfileNotFound);
      }).pipe(Effect.provide(makeTestLayer(0, "", "", makeFsState()))),
    );

    it.effect("returns satisfied when all packages installed", () => {
      const fsState = makeFsState({
        exists: new Set(["/test/dotfiles/Brewfile"]),
      });

      return Effect.gen(function* () {
        const homebrew = yield* Homebrew;
        const result = yield* homebrew.bundleDryRun();

        expect(result).toBeInstanceOf(BundleCheckResult);
        expect(result.satisfied).toBe(true);
        expect(result.missing).toHaveLength(0);
      }).pipe(
        Effect.provide(
          makeTestLayer(
            0,
            "The Brewfile's dependencies are satisfied.",
            "",
            fsState,
          ),
        ),
      );
    });

    it.effect("parses missing packages from output", () => {
      const fsState = makeFsState({
        exists: new Set(["/test/dotfiles/Brewfile"]),
      });

      const stdout = `→ Formula stow needs to be installed or updated.
→ Cask ghostty needs to be installed or updated.`;

      return Effect.gen(function* () {
        const homebrew = yield* Homebrew;
        const result = yield* homebrew.bundleDryRun();

        expect(result.satisfied).toBe(false);
        expect(result.missing).toHaveLength(2);
        expect(result.missing[0]).toEqual(
          new InstalledPackage({ name: "stow", type: "formula" }),
        );
        expect(result.missing[1]).toEqual(
          new InstalledPackage({ name: "ghostty", type: "cask" }),
        );
      }).pipe(Effect.provide(makeTestLayer(1, stdout, "", fsState)));
    });
  });
});
