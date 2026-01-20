import { Command, CommandExecutor, Path } from "@effect/platform"
import { Context, Effect, Layer, Option, Schema, Stream } from "effect"
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
