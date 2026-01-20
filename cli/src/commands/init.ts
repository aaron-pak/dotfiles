import { Command } from "@effect/cli"
import { Console } from "effect"

export const init = Command.make("init", {}, () =>
  Console.log("[not implemented] Would initialize dotfiles on this machine")
).pipe(Command.withDescription("Initialize dotfiles on a new machine"))
