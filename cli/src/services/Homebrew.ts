import { Data, Effect, FileSystem, Layer, Option, Path, Schema, ServiceMap, Stream } from 'effect';
import type * as PlatformError from 'effect/PlatformError';
import { ChildProcess as Process, ChildProcessSpawner } from 'effect/unstable/process';
import { StowConfig } from './StowConfig.js';

// -------------------------------------------------------------------------------------
// Data Types
// -------------------------------------------------------------------------------------

const installedPackageTypes = ['formula', 'cask'] satisfies readonly ['formula', 'cask'];

/**
 * Package installed by brew bundle.
 */
export class InstalledPackage extends Schema.Class<InstalledPackage>('InstalledPackage')({
  name: Schema.String,
  type: Schema.Literals(installedPackageTypes),
}) {}

/**
 * Result of brew bundle operation.
 */
export class BundleResult extends Schema.Class<BundleResult>('BundleResult')({
  installed: Schema.Array(InstalledPackage),
  skipped: Schema.Array(InstalledPackage),
}) {}

/**
 * Missing packages from brew bundle check.
 */
export class BundleCheckResult extends Schema.Class<BundleCheckResult>('BundleCheckResult')({
  missing: Schema.Array(InstalledPackage),
  satisfied: Schema.Boolean,
}) {}

// -------------------------------------------------------------------------------------
// Errors
// -------------------------------------------------------------------------------------

export class HomebrewNotFound extends Data.TaggedError('HomebrewNotFound')<{}> {
  override get message() {
    return 'Homebrew is not installed';
  }
}

export class HomebrewInstallError extends Data.TaggedError('HomebrewInstallError')<{
  readonly details: string;
}> {
  override get message() {
    return `Failed to install Homebrew: ${this.details}`;
  }
}

export class BrewBundleError extends Data.TaggedError('BrewBundleError')<{
  readonly details: string;
}> {
  override get message() {
    return `brew bundle failed: ${this.details}`;
  }
}

export class BrewfileNotFound extends Data.TaggedError('BrewfileNotFound')<{
  readonly path: string;
}> {
  override get message() {
    return `Brewfile not found at: ${this.path}`;
  }
}

// -------------------------------------------------------------------------------------
// Parsing
// -------------------------------------------------------------------------------------

/**
 * Parse brew bundle output for installed/skipped packages.
 * Lines like:
 *   "Installing stow"
 *   "Using ripgrep" (already installed)
 *   "Installing cask ghostty"
 */
const parseInstallingLine = (
  line: string,
): Option.Option<{ name: string; type: 'formula' | 'cask' }> => {
  const installingMatch = line.match(/^Installing (?:cask )?(\S+)/);
  const name = installingMatch?.[1];
  if (name) {
    const isCask = line.includes('cask ');
    return Option.some({
      name,
      type: isCask ? 'cask' : 'formula',
    });
  }
  return Option.none();
};

const parseUsingLine = (
  line: string,
): Option.Option<{ name: string; type: 'formula' | 'cask' }> => {
  const name = line.match(/^Using (\S+)/)?.[1];
  if (name) {
    return Option.some({ name, type: 'formula' });
  }
  return Option.none();
};

/**
 * Parse brew bundle check output for missing packages.
 * Verbose output format:
 *   "→ Formula neovim needs to be installed or updated."
 *   "→ Cask ghostty needs to be installed or updated."
 */
const parseMissingLine = (
  line: string,
): Option.Option<{ name: string; type: 'formula' | 'cask' }> => {
  const formulaName = line.match(/Formula (\S+) needs/)?.[1];
  if (formulaName) {
    return Option.some({ name: formulaName, type: 'formula' });
  }

  const caskName = line.match(/Cask (\S+) needs/)?.[1];
  if (caskName) {
    return Option.some({ name: caskName, type: 'cask' });
  }

  return Option.none();
};

// -------------------------------------------------------------------------------------
// Service
// -------------------------------------------------------------------------------------

export class Homebrew extends ServiceMap.Service<
  Homebrew,
  {
    readonly checkInstalled: () => Effect.Effect<boolean>;
    readonly install: () => Effect.Effect<void, HomebrewInstallError>;
    readonly bundle: (opts?: {
      readonly verbose?: boolean;
    }) => Effect.Effect<
      BundleResult,
      BrewfileNotFound | BrewBundleError | PlatformError.PlatformError
    >;
    readonly bundleDryRun: () => Effect.Effect<
      BundleCheckResult,
      BrewfileNotFound | BrewBundleError | PlatformError.PlatformError
    >;
  }
>()('@dotfiles/Homebrew') {
  static readonly Live = Layer.effect(
    Homebrew,
    Effect.gen(function* () {
      const processSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { dotfilesRoot } = yield* StowConfig;

      const brewfilePath = path.join(dotfilesRoot, 'Brewfile');

      const collectText = (
        stream: Stream.Stream<string, PlatformError.PlatformError>,
      ): Effect.Effect<string, PlatformError.PlatformError> =>
        stream.pipe(
          Stream.runFold(
            () => '',
            (acc, chunk) => acc + chunk,
          ),
        );

      /** Run a command and capture stdout/stderr. */
      const runCommand = (
        command: Process.Command,
      ): Effect.Effect<
        {
          readonly exitCode: ChildProcessSpawner.ExitCode;
          readonly stdout: string;
          readonly stderr: string;
        },
        PlatformError.PlatformError,
        never
      > =>
        Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* processSpawner.spawn(command);
            return yield* Effect.all({
              exitCode: handle.exitCode,
              stdout: collectText(handle.stdout.pipe(Stream.decodeText())),
              stderr: collectText(handle.stderr.pipe(Stream.decodeText())),
            });
          }),
        );

      /**
       * Check if Homebrew is installed.
       */
      const checkInstalled = Effect.fn('Homebrew.checkInstalled')(function* () {
        const command = Process.make('which', ['brew']);
        return yield* runCommand(command).pipe(
          Effect.map((result) => result.exitCode === 0),
          Effect.catchTag('PlatformError', () => Effect.succeed(false)),
        );
      });

      /**
       * Install Homebrew using the official install script.
       */
      const install = Effect.fn('Homebrew.install')(function* () {
        const installScript =
          '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"';
        const command = Process.make('bash', ['-c', installScript]);

        const result = yield* runCommand(command).pipe(
          Effect.catchTag('PlatformError', (error) =>
            Effect.fail(new HomebrewInstallError({ details: error.message })),
          ),
        );

        if (result.exitCode !== 0) {
          return yield* new HomebrewInstallError({
            details: result.stderr || 'Unknown error',
          });
        }
      });

      /**
       * Run brew bundle to install packages from Brewfile.
       */
      const bundle = Effect.fn('Homebrew.bundle')(function* (opts?: {
        readonly verbose?: boolean;
      }) {
        const brewfileExists = yield* fs.exists(brewfilePath);
        if (!brewfileExists) {
          return yield* new BrewfileNotFound({ path: brewfilePath });
        }

        const args = ['bundle', '--file', brewfilePath];
        if (opts?.verbose) {
          args.push('--verbose');
        }

        const command = Process.make('brew', args);
        const result = yield* runCommand(command).pipe(
          Effect.catchTag('PlatformError', (error) =>
            Effect.fail(new BrewBundleError({ details: error.message })),
          ),
        );

        if (result.exitCode !== 0) {
          return yield* new BrewBundleError({
            details: result.stderr || result.stdout || 'Unknown error',
          });
        }

        const lines = (result.stdout + result.stderr).split('\n');
        const installed: InstalledPackage[] = [];
        const skipped: InstalledPackage[] = [];

        for (const line of lines) {
          const trimmed = line.trim();

          const installingResult = parseInstallingLine(trimmed);
          if (Option.isSome(installingResult)) {
            installed.push(
              new InstalledPackage({
                name: installingResult.value.name,
                type: installingResult.value.type,
              }),
            );
            continue;
          }

          const usingResult = parseUsingLine(trimmed);
          if (Option.isSome(usingResult)) {
            skipped.push(
              new InstalledPackage({
                name: usingResult.value.name,
                type: usingResult.value.type,
              }),
            );
          }
        }

        return new BundleResult({ installed, skipped });
      });

      /**
       * Run brew bundle check to see what packages are missing.
       */
      const bundleDryRun = Effect.fn('Homebrew.bundleDryRun')(function* () {
        const brewfileExists = yield* fs.exists(brewfilePath);
        if (!brewfileExists) {
          return yield* new BrewfileNotFound({ path: brewfilePath });
        }

        const command = Process.make('brew', [
          'bundle',
          'check',
          '--verbose',
          '--file',
          brewfilePath,
        ]);

        const result = yield* runCommand(command).pipe(
          Effect.catchTag('PlatformError', (error) =>
            Effect.fail(new BrewBundleError({ details: error.message })),
          ),
        );

        // Exit code 1 means packages are missing (expected)
        const lines = (result.stdout + result.stderr).split('\n');
        const missing: InstalledPackage[] = [];

        for (const line of lines) {
          const trimmed = line.trim();
          const missingResult = parseMissingLine(trimmed);
          if (Option.isSome(missingResult)) {
            missing.push(
              new InstalledPackage({
                name: missingResult.value.name,
                type: missingResult.value.type,
              }),
            );
          }
        }

        const satisfied = result.exitCode === 0 && missing.length === 0;
        return new BundleCheckResult({ missing, satisfied });
      });

      return Homebrew.of({
        checkInstalled,
        install,
        bundle,
        bundleDryRun,
      });
    }),
  );
}

export const HomebrewLive = Homebrew.Live;
