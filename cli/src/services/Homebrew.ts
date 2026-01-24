import { Command, CommandExecutor, FileSystem, Path } from "@effect/platform";
import { Effect, Option, Schema, Stream } from "effect";
import { StowConfig } from "./StowConfig.js";

// -------------------------------------------------------------------------------------
// Data Types
// -------------------------------------------------------------------------------------

/**
 * Package installed by brew bundle.
 */
export class InstalledPackage extends Schema.Class<InstalledPackage>(
  "InstalledPackage",
)({
  name: Schema.String,
  type: Schema.Literal("formula", "cask"),
}) {}

/**
 * Result of brew bundle operation.
 */
export class BundleResult extends Schema.Class<BundleResult>("BundleResult")({
  installed: Schema.Array(InstalledPackage),
  skipped: Schema.Array(InstalledPackage),
}) {}

/**
 * Missing packages from brew bundle check.
 */
export class BundleCheckResult extends Schema.Class<BundleCheckResult>(
  "BundleCheckResult",
)({
  missing: Schema.Array(InstalledPackage),
  satisfied: Schema.Boolean,
}) {}

// -------------------------------------------------------------------------------------
// Errors
// -------------------------------------------------------------------------------------

export class HomebrewNotFound extends Schema.TaggedError<HomebrewNotFound>()(
  "HomebrewNotFound",
  {},
) {
  override get message() {
    return "Homebrew is not installed";
  }
}

export class HomebrewInstallError extends Schema.TaggedError<HomebrewInstallError>()(
  "HomebrewInstallError",
  { details: Schema.String },
) {
  override get message() {
    return `Failed to install Homebrew: ${this.details}`;
  }
}

export class BrewBundleError extends Schema.TaggedError<BrewBundleError>()(
  "BrewBundleError",
  { details: Schema.String },
) {
  override get message() {
    return `brew bundle failed: ${this.details}`;
  }
}

export class BrewfileNotFound extends Schema.TaggedError<BrewfileNotFound>()(
  "BrewfileNotFound",
  { path: Schema.String },
) {
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
): Option.Option<{ name: string; type: "formula" | "cask" }> => {
  const installingMatch = line.match(/^Installing (?:cask )?(\S+)/);
  const name = installingMatch?.[1];
  if (name) {
    const isCask = line.includes("cask ");
    return Option.some({
      name,
      type: isCask ? "cask" : "formula",
    });
  }
  return Option.none();
};

const parseUsingLine = (
  line: string,
): Option.Option<{ name: string; type: "formula" | "cask" }> => {
  const name = line.match(/^Using (\S+)/)?.[1];
  if (name) {
    return Option.some({ name, type: "formula" });
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
): Option.Option<{ name: string; type: "formula" | "cask" }> => {
  // "→ Formula <name> needs to be installed"
  const formulaName = line.match(/Formula (\S+) needs/)?.[1];
  if (formulaName) {
    return Option.some({ name: formulaName, type: "formula" });
  }

  // "→ Cask <name> needs to be installed"
  const caskName = line.match(/Cask (\S+) needs/)?.[1];
  if (caskName) {
    return Option.some({ name: caskName, type: "cask" });
  }

  return Option.none();
};

// -------------------------------------------------------------------------------------
// Service
// -------------------------------------------------------------------------------------

export class Homebrew extends Effect.Service<Homebrew>()("@dotfiles/Homebrew", {
  effect: Effect.gen(function* () {
    const executor = yield* CommandExecutor.CommandExecutor;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { dotfilesRoot } = yield* StowConfig;

    const brewfilePath = path.join(dotfilesRoot, "Brewfile");

    /** Run a command and capture stdout/stderr. */
    const runCommand = (cmd: Command.Command) =>
      Effect.scoped(
        Effect.gen(function* () {
          const process = yield* executor.start(cmd);

          const stdout = yield* process.stdout.pipe(
            Stream.decodeText(),
            Stream.runFold("", (acc, chunk) => acc + chunk),
          );

          const stderr = yield* process.stderr.pipe(
            Stream.decodeText(),
            Stream.runFold("", (acc, chunk) => acc + chunk),
          );

          const exitCode = yield* process.exitCode;

          return { exitCode, stdout, stderr };
        }),
      );

    /**
     * Check if Homebrew is installed.
     */
    const checkInstalled = Effect.fn("Homebrew.checkInstalled")(function* () {
      const cmd = Command.make("which", "brew");

      const result = yield* runCommand(cmd).pipe(
        Effect.catchAll(() =>
          Effect.succeed({ exitCode: 1, stdout: "", stderr: "" }),
        ),
      );

      return result.exitCode === 0;
    });

    /**
     * Install Homebrew using the official install script.
     */
    const install = Effect.fn("Homebrew.install")(function* () {
      // Use the official Homebrew install script
      const installScript =
        '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"';

      const cmd = Command.make("bash", "-c", installScript);

      const result = yield* runCommand(cmd).pipe(
        Effect.catchAll((error) =>
          HomebrewInstallError.make({ details: String(error) }),
        ),
      );

      if (result.exitCode !== 0) {
        return yield* HomebrewInstallError.make({
          details: result.stderr || "Unknown error",
        });
      }

      return;
    });

    /**
     * Run brew bundle to install packages from Brewfile.
     */
    const bundle = Effect.fn("Homebrew.bundle")(function* (opts?: {
      verbose?: boolean;
    }) {
      // Check Brewfile exists
      const brewfileExists = yield* fs.exists(brewfilePath);
      if (!brewfileExists) {
        return yield* BrewfileNotFound.make({ path: brewfilePath });
      }

      const args = ["bundle", "--file", brewfilePath];
      if (opts?.verbose) {
        args.push("--verbose");
      }

      const cmd = Command.make("brew", ...args);

      const result = yield* runCommand(cmd).pipe(
        Effect.catchAll((error) =>
          BrewBundleError.make({ details: String(error) }),
        ),
      );

      if (result.exitCode !== 0) {
        return yield* BrewBundleError.make({
          details: result.stderr || result.stdout || "Unknown error",
        });
      }

      // Parse output for installed/skipped packages
      const lines = (result.stdout + result.stderr).split("\n");
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

      return BundleResult.make({ installed, skipped });
    });

    /**
     * Run brew bundle check to see what packages are missing.
     */
    const bundleDryRun = Effect.fn("Homebrew.bundleDryRun")(function* () {
      // Check Brewfile exists
      const brewfileExists = yield* fs.exists(brewfilePath);
      if (!brewfileExists) {
        return yield* BrewfileNotFound.make({ path: brewfilePath });
      }

      const cmd = Command.make(
        "brew",
        "bundle",
        "check",
        "--verbose",
        "--file",
        brewfilePath,
      );

      const result = yield* runCommand(cmd).pipe(
        Effect.catchAll((error) =>
          BrewBundleError.make({ details: String(error) }),
        ),
      );

      // Exit code 1 means packages are missing (expected)
      // Parse output for missing packages
      const lines = (result.stdout + result.stderr).split("\n");
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

      return BundleCheckResult.make({ missing, satisfied });
    });

    return {
      checkInstalled,
      install,
      bundle,
      bundleDryRun,
    };
  }),
}) {}
