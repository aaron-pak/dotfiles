import { Command, Prompt } from "@effect/cli"
import { Console, Effect } from "effect"
import { type ConflictChoice, resolveConflicts } from "../lib/conflicts.js"
import { Stow } from "../services/Stow.js"

export const sync = Command.make("sync", {}, () =>
  Effect.gen(function* () {
    const stow = yield* Stow

    yield* Console.log("Checking for conflicts...")
    const result = yield* stow.dryRun()

    if (result.conflicts.length === 0) {
      yield* Console.log("No conflicts found. Syncing dotfiles...")
      yield* stow.sync()
      yield* Console.log("Dotfiles synced successfully!")
      return
    }

    // Show conflicts
    yield* Console.log(`\nFound ${result.conflicts.length} conflict(s):`)
    for (const { target } of result.conflicts) {
      yield* Console.log(`  - ${target}`)
    }
    yield* Console.log("")

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
    })

    // Resolve conflicts
    const shouldSync = yield* resolveConflicts(result.conflicts, choice)

    if (shouldSync) {
      yield* Console.log("\nSyncing dotfiles...")
      yield* stow.sync()
      yield* Console.log("Dotfiles synced successfully!")
    }
  })
).pipe(Command.withDescription("Sync dotfiles to home directory using GNU Stow"))
