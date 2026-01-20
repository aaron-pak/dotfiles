import { FileSystem, Path } from "@effect/platform"
import { Console, Effect } from "effect"
import * as os from "node:os"
import type { StowConflict } from "../services/Stow.js"

export type ConflictChoice = "backup" | "delete" | "abort"

export const resolveConflicts = Effect.fn("resolveConflicts")(function* (
  conflicts: readonly StowConflict[],
  choice: ConflictChoice
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const homeDir = os.homedir()

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
