import { Command, Options, Prompt } from "@effect/cli";
import { Console, Effect, Option } from "effect";
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

const dryRun = Options.boolean("dry-run").pipe(
  Options.withAlias("n"),
  Options.withDescription("Show what would be synced without doing it"),
);

export const sync = Command.make("sync", { dryRun }, ({ dryRun }) =>
  Effect.gen(function* () {
    const stow = yield* Stow;
    const result = yield* stow.dryRun();

    if (dryRun) {
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
        yield* Console.log("Nothing to do. All dotfiles already synced.");
      }
      return;
    }

    yield* Console.log("Checking for conflicts...");

    if (result.conflicts.length === 0) {
      yield* Console.log("No conflicts found. Syncing dotfiles...");
      const links = yield* stow.sync();
      yield* printLinks(links);
      yield* Console.log("\nDotfiles synced successfully!");
      return;
    }

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
  }),
).pipe(
  Command.withDescription("Sync dotfiles to home directory using GNU Stow"),
);
