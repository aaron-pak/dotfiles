import { Args, Command } from "@effect/cli";
import { Console } from "effect";

const filePath = Args.text({ name: "path" }).pipe(
  Args.withDescription("Path to the managed dotfile to remove"),
);

export const remove = Command.make("remove", { filePath }, ({ filePath }) =>
  Console.log(`[not implemented] Would remove: ${filePath}`),
).pipe(Command.withDescription("Remove a dotfile from being managed"));
