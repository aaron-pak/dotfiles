import { Args, Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";
import { Stow } from "../services/Stow.js";

const paths = Args.text({ name: "paths" }).pipe(
  Args.withDescription("Paths to remove (relative to home)"),
  Args.repeated,
);

const dry = Options.boolean("dry").pipe(
  Options.withAlias("n"),
  Options.withDescription("Show what would be removed without doing it"),
);

export const remove = Command.make("remove", { paths, dry }, ({ paths, dry }) =>
  Effect.gen(function* () {
    if (paths.length === 0) {
      yield* Console.log("Usage: dot remove [-n] <path>...");
      return;
    }

    const stow = yield* Stow;

    for (const p of paths) {
      if (dry) {
        const result = yield* stow.checkRemovable(p);
        if (result.isDirectory) {
          yield* Console.log(
            `Would remove: ${result.normalized} (${result.itemCount} items)`,
          );
        } else {
          yield* Console.log(`Would remove: ${result.normalized}`);
        }
      } else {
        yield* stow.removeDotfile(p);
        yield* Console.log(`Removed: ~/${p}`);
      }
    }
  }),
).pipe(Command.withDescription("Remove a dotfile from being managed"));
