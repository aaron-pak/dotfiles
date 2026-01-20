import { Command, CommandExecutor, Path } from "@effect/platform"
import { Context, Effect, Layer, Schema, Stream } from "effect"
import * as os from "node:os"

// -------------------------------------------------------------------------------------
// Data Types
// -------------------------------------------------------------------------------------

/**
 * Represents the result of a stow dry-run.
 * Contains an array of conflicting file paths relative to the target directory.
 */
export class StowResult extends Schema.Class<StowResult>("StowResult")({
  conflicts: Schema.Array(Schema.String),
}) {}

/**
 * Error for stow execution failures.
 */
export class StowError extends Schema.TaggedError<StowError>()("StowError", {
  message: Schema.String,
}) {}

// -------------------------------------------------------------------------------------
// Service
// -------------------------------------------------------------------------------------

export class Stow extends Context.Tag("@dotfiles/Stow")<
  Stow,
  {
    /**
     * Run a dry-run of stow and return any conflicts.
     */
    readonly dryRun: () => Effect.Effect<StowResult, StowError>

    /**
     * Actually sync the dotfiles using stow.
     */
    readonly sync: () => Effect.Effect<void, StowError>
  }
>() {
  static readonly layer = Layer.effect(
    Stow,
    Effect.gen(function* () {
      // Acquire dependencies at layer construction time
      const executor = yield* CommandExecutor.CommandExecutor
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

      /**
       * Parse stow stderr output for conflict paths.
       * Stow conflict lines look like:
       *   * cannot stow ../home/.config/foo over existing target .config/foo since...
       * We extract the target path (.config/foo in this example).
       */
      const parseConflicts = (stderr: string): string[] => {
        const conflicts: string[] = []
        const lines = stderr.split("\n")

        for (const line of lines) {
          // Match: "* cannot stow ... over existing target <path> since..."
          const match = line.match(
            /\* cannot stow .+ over existing target (.+) since/
          )
          if (match && match[1]) {
            conflicts.push(match[1])
          }
        }

        return conflicts
      }

      /**
       * Run a stow command and capture stderr.
       */
      const runStow = (args: string[]) =>
        Effect.gen(function* () {
          const cmd = Command.make("stow", ...args).pipe(
            Command.workingDirectory(dotfilesRoot)
          )

          // Start the process and capture stderr
          const result = yield* Effect.scoped(
            Effect.gen(function* () {
              const process = yield* executor.start(cmd)

              // Read stderr as string
              const stderr = yield* process.stderr.pipe(
                Stream.decodeText(),
                Stream.runFold("", (acc, chunk) => acc + chunk)
              )

              // Wait for process to complete
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

      // Public API
      const dryRun = Effect.fn("Stow.dryRun")(function* () {
        const { stderr } = yield* runStow(["-n", "-v", "home", "-t", homeDir])

        // Exit code 1 with conflicts is expected during dry-run
        // Parse conflicts from stderr regardless of exit code
        const conflicts = parseConflicts(stderr)

        return StowResult.make({ conflicts })
      })

      const sync = Effect.fn("Stow.sync")(function* () {
        const { exitCode, stderr } = yield* runStow(["home", "-t", homeDir])

        if (exitCode !== 0) {
          return yield* StowError.make({
            message: `Stow failed with exit code ${exitCode}: ${stderr}`,
          })
        }
      })

      return Stow.of({ dryRun, sync })
    })
  )
}
