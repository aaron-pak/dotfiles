import { Command, Options, Prompt } from "@effect/cli";
import { Console, Effect, Option } from "effect";
import { ClaudeSettings } from "../services/ClaudeSettings.js";
import { Homebrew } from "../services/Homebrew.js";
import {
  type ConflictChoice,
  type ConflictResolution,
  Stow,
  type StowLink,
} from "../services/Stow.js";

/** Print conflict resolutions if any. */
const printResolutions = (resolutions: readonly ConflictResolution[]) =>
  Effect.gen(function* () {
    if (resolutions.length === 0) return;

    yield* Console.log("\nConflict resolutions:");
    for (const r of resolutions) {
      const suffix = Option.match(r.backupPath, {
        onNone: () => "",
        onSome: (bp) => ` -> ${bp}`,
      });
      yield* Console.log(`  ${r.target}${suffix}`);
    }
  });

/** Print symlinks created if any. */
const printLinks = (links: readonly StowLink[]) =>
  Effect.gen(function* () {
    if (links.length === 0) return;

    yield* Console.log("\nSymlinks created:");
    for (const { target } of links) {
      yield* Console.log(`  ${target}`);
    }
  });

const dry = Options.boolean("dry").pipe(
  Options.withAlias("n"),
  Options.withDescription("Show what would happen without making changes"),
);

const skipBrew = Options.boolean("skip-brew").pipe(
  Options.withDescription("Skip Homebrew installation phase"),
);

export const init = Command.make(
  "init",
  { dry, skipBrew },
  ({ dry, skipBrew }) =>
    Effect.gen(function* () {
      const homebrew = yield* Homebrew;
      const stow = yield* Stow;

      // Phase 1: Homebrew
      if (!skipBrew) {
        yield* Console.log("=== Phase 1: Homebrew ===\n");

        // Check if Homebrew is installed
        const brewInstalled = yield* homebrew.checkInstalled();

        if (!brewInstalled) {
          if (dry) {
            yield* Console.log("Would install Homebrew (not installed)");
          } else {
            const shouldInstall = yield* Prompt.confirm({
              message: "Homebrew is not installed. Install it now?",
              initial: true,
            });

            if (!shouldInstall) {
              yield* Console.log("Skipping Homebrew installation.");
            } else {
              yield* Console.log("Installing Homebrew...");
              yield* homebrew.install();
              yield* Console.log("Homebrew installed successfully!");
            }
          }
        } else {
          yield* Console.log("Homebrew is already installed.");
        }

        // Run brew bundle
        if (dry) {
          yield* Console.log("\nChecking Brewfile packages...");
          const checkResult = yield* homebrew.bundleDryRun();

          if (checkResult.satisfied) {
            yield* Console.log("All packages already installed.");
          } else {
            yield* Console.log(
              `Would install ${checkResult.missing.length} package(s):`,
            );
            for (const pkg of checkResult.missing) {
              const prefix = pkg.type === "cask" ? "cask" : "brew";
              yield* Console.log(`  ${prefix} ${pkg.name}`);
            }
          }
        } else {
          yield* Console.log("\nInstalling packages from Brewfile...");
          const bundleResult = yield* homebrew.bundle({ verbose: true });

          if (bundleResult.installed.length > 0) {
            yield* Console.log(
              `Installed ${bundleResult.installed.length} package(s):`,
            );
            for (const pkg of bundleResult.installed) {
              yield* Console.log(`  ${pkg.name}`);
            }
          }

          if (bundleResult.skipped.length > 0) {
            yield* Console.log(
              `Already installed: ${bundleResult.skipped.length} package(s)`,
            );
          }

          if (
            bundleResult.installed.length === 0 &&
            bundleResult.skipped.length === 0
          ) {
            yield* Console.log("All packages already installed.");
          }
        }
      } else {
        yield* Console.log("Skipping Homebrew phase (--skip-brew)");
      }

      // Phase 2: Stow
      yield* Console.log("\n=== Phase 2: Dotfiles ===\n");

      const result = yield* stow.dryRun();

      if (dry) {
        if (result.conflicts.length > 0) {
          yield* Console.log(
            `Would encounter ${result.conflicts.length} conflict(s):`,
          );
          for (const { target } of result.conflicts) {
            yield* Console.log(`  - ${target}`);
          }
        }
        if (result.links.length > 0) {
          yield* Console.log("\nWould create symlinks:");
          for (const { target } of result.links) {
            yield* Console.log(`  ${target}`);
          }
        }
        if (result.conflicts.length === 0 && result.links.length === 0) {
          yield* Console.log("All dotfiles already synced.");
        }
      } else {
        yield* Console.log("Checking for conflicts...");

        if (result.conflicts.length === 0) {
          yield* Console.log("No conflicts found. Syncing dotfiles...");
          const links = yield* stow.sync();
          yield* printLinks(links);
          yield* Console.log("\nDotfiles synced successfully!");
        } else {
          // Show conflicts
          yield* Console.log(`\nFound ${result.conflicts.length} conflict(s):`);
          for (const { target } of result.conflicts) {
            yield* Console.log(`  - ${target}`);
          }
          yield* Console.log("");

          // Prompt user for resolution
          const choice = yield* Prompt.select<ConflictChoice>({
            message: "How would you like to resolve these conflicts?",
            choices: [
              {
                title: "Backup",
                value: "backup",
                description: "Rename conflicting files to .bak and sync",
              },
              {
                title: "Delete",
                value: "delete",
                description: "Delete conflicting files and sync",
              },
              {
                title: "Abort",
                value: "abort",
                description: "Do nothing and exit",
              },
            ],
          });

          // Resolve conflicts
          const resolveResult = yield* stow.resolveConflicts(
            result.conflicts,
            choice,
          );

          if (resolveResult._tag === "Resolved") {
            yield* printResolutions(resolveResult.resolutions);
            yield* Console.log("\nSyncing dotfiles...");
            const links = yield* stow.sync();
            yield* printLinks(links);
            yield* Console.log("\nDotfiles synced successfully!");
          }
        }
      }

      // Phase 3: Claude Code Settings
      yield* Console.log("\n=== Phase 3: Claude Code Settings ===\n");

      const claudeSettings = yield* ClaudeSettings;

      if (dry) {
        const shared = yield* claudeSettings.readShared();
        const sharedKeys = Object.keys(shared);

        if (sharedKeys.length === 0) {
          yield* Console.log("No shared Claude settings to pull.");
        } else {
          yield* Console.log("Would pull the following shared settings:");
          for (const key of sharedKeys) {
            yield* Console.log(`  ${key}`);
          }
        }
      } else {
        const pullResult = yield* claudeSettings.pull();

        if (pullResult.updatedKeys.length === 0) {
          yield* Console.log("No shared Claude settings to pull.");
        } else {
          yield* Console.log("Pulled shared Claude settings:");
          for (const key of pullResult.updatedKeys) {
            yield* Console.log(`  ${key}`);
          }
        }
      }

      yield* Console.log("\nInitialization complete!");
    }),
).pipe(Command.withDescription("Initialize dotfiles on a new machine"));
