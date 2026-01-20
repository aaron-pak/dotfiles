import {
  Command,
  CommandExecutor,
  FileSystem,
  Path,
} from "@effect/platform"
import { Console, Effect, Option, Schema, Stream } from "effect"
import * as os from "node:os"

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
  Schema.String
)

const decodeConflictLine = Schema.decodeUnknownOption(ConflictLine)

/**
 * Parse stow stderr output for conflicts.
 * Lines matching the ConflictLine schema are decoded into StowConflict instances.
 */
const parseConflicts = (stderr: string): readonly StowConflict[] =>
  stderr.split("\n").flatMap((line) =>
    decodeConflictLine(line).pipe(
      Option.map(
        ([, source, , target, , reason]) =>
          new StowConflict({ source, target, reason })
      ),
      Option.toArray
    )
  )

/**
 * Represents the result of a stow dry-run.
 * Contains an array of parsed conflict details.
 */
export class StowResult extends Schema.Class<StowResult>("StowResult")({
  conflicts: Schema.Array(StowConflict),
}) {}

/**
 * Error for stow execution failures.
 */
export class StowError extends Schema.TaggedError<StowError>()("StowError", {
  message: Schema.String,
}) {}

export type ConflictChoice = "backup" | "delete" | "abort"

// -------------------------------------------------------------------------------------
// Service
// -------------------------------------------------------------------------------------

export class Stow extends Effect.Service<Stow>()("@dotfiles/Stow", {
  effect: Effect.gen(function* () {
    const executor = yield* CommandExecutor.CommandExecutor
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path

    // Compute the dotfiles root directory
    // import.meta.dirname gives us the directory of this file (cli/src/services)
    // We need to go up 3 levels to get to the dotfiles root
    // In Bun, import.meta.dirname is always defined
    const dotfilesRoot = path.resolve(
      import.meta.dirname ?? process.cwd(),
      "..",
      "..",
      ".."
    )
    const homeDir = os.homedir()

    /** Run a stow command and capture stderr. */
    const runStow = (args: string[]) =>
      Effect.gen(function* () {
        const cmd = Command.make("stow", ...args).pipe(
          Command.workingDirectory(dotfilesRoot)
        )

        // Effect.scoped: executor.start returns Effect<Process, ..., Scope>.
        // Scope manages process lifecycle - when scope closes, process is
        // cleaned up (killed if running, file descriptors closed).
        // Effect.scoped creates scope, runs effect, then closes - ensuring
        // cleanup even on error. Without it, Scope leaks to callers.
        const result = yield* Effect.scoped(
          Effect.gen(function* () {
            const process = yield* executor.start(cmd)

            // process.stderr is Stream<Uint8Array> - bytes arriving over time.
            // decodeText: Uint8Array -> string chunks
            // runFold: like Array.reduce for streams - starts with "",
            // concatenates each chunk, returns final string when stream ends.
            const stderr = yield* process.stderr.pipe(
              Stream.decodeText(),
              Stream.runFold("", (acc, chunk) => acc + chunk)
            )

            const exitCode = yield* process.exitCode

            return { exitCode, stderr }
          })
        ).pipe(
          Effect.catchAll((error) =>
            StowError.make({
              message: `Failed to execute stow: ${error}`,
            })
          )
        )

        return result
      })

    /**
     * Run a dry-run of stow and return any conflicts.
     */
    const dryRun = Effect.fn("Stow.dryRun")(function* () {
      const { stderr } = yield* runStow(["-n", "-v", "home", "-t", homeDir])

      // Exit code 1 with conflicts is expected during dry-run
      // Parse conflicts from stderr regardless of exit code
      const conflicts = parseConflicts(stderr)

      return StowResult.make({ conflicts })
    })

    /**
     * Actually sync the dotfiles using stow.
     */
    const sync = Effect.fn("Stow.sync")(function* () {
      const { exitCode, stderr } = yield* runStow(["home", "-t", homeDir])

      if (exitCode !== 0) {
        return yield* StowError.make({
          message: `Stow failed with exit code ${exitCode}: ${stderr}`,
        })
      }
    })

    /**
     * Resolve conflicts by backing up or deleting conflicting files.
     * Returns true if sync should proceed, false if aborted.
     */
    const resolveConflicts = Effect.fn("Stow.resolveConflicts")(function* (
      conflicts: readonly StowConflict[],
      choice: ConflictChoice
    ) {
      if (choice === "abort") {
        yield* Console.log("Aborted. No changes were made.")
        return false
      }

      for (const { target } of conflicts) {
        const fullPath = path.join(homeDir, target)

        if (choice === "backup") {
          const backupPath = `${fullPath}.bak`
          yield* Console.log(`  Backing up: ${target} -> ${target}.bak`)
          yield* fs.rename(fullPath, backupPath)
        } else if (choice === "delete") {
          yield* Console.log(`  Deleting: ${target}`)
          yield* fs.remove(fullPath)
        }
      }

      return true
    })

    return { dryRun, resolveConflicts, sync }
  }),
}) {}
