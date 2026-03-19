import { Console, Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { Stow } from "../services/Stow.js";

const paths = Argument.string("paths").pipe(
  Argument.withDescription("Paths to remove (relative to home)"),
  Argument.variadic({ min: 1 }),
);

const dry = Flag.boolean("dry").pipe(
  Flag.withAlias("n"),
  Flag.withDescription("Show what would be removed without doing it"),
);

export const remove = Command.make("remove", { paths, dry }, ({ paths, dry }) =>
  Effect.gen(function* () {
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
