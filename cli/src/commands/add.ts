import { Args, Command } from "@effect/cli"
import { Console } from "effect"

const filePath = Args.text({ name: "path" }).pipe(
  Args.withDescription("Path to the file to add (relative to home)")
)

export const add = Command.make("add", { filePath }, ({ filePath }) =>
  Console.log(`[not implemented] Would add: ${filePath}`)
).pipe(Command.withDescription("Add a new dotfile to be managed"))
