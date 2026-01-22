import { Args, Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";
import {
  InvalidPath,
  NotManaged,
  NotSymlink,
  Stow,
  SymlinkMismatch,
} from "../services/Stow.js";

const paths = Args.text({ name: "paths" }).pipe(
  Args.withDescription("Paths to remove (relative to home)"),
  Args.repeated,
);

const dryRun = Options.boolean("dry-run").pipe(
  Options.withAlias("n"),
  Options.withDescription("Show what would be removed without doing it"),
);

export const remove = Command.make(
  "remove",
  { paths, dryRun },
  ({ paths, dryRun }) =>
    Effect.gen(function* () {
      if (paths.length === 0) {
        yield* Console.log("Usage: dot remove [-n] <path>...");
        return;
      }

      const stow = yield* Stow;

      for (const p of paths) {
        if (dryRun) {
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
    }).pipe(
      Effect.catchTags({
        NotManaged: (e: NotManaged) => Console.error(`Not managed: ${e.path}`),
        NotSymlink: (e: NotSymlink) =>
          Console.error(`Not a symlink: ~/${e.path}`),
        SymlinkMismatch: (e: SymlinkMismatch) =>
          Console.error(
            `Symlink mismatch: ~/${e.path} points to ${e.actual}, expected ${e.expected}`,
          ),
        InvalidPath: (e: InvalidPath) =>
          Console.error(`Invalid path "${e.path}": ${e.reason}`),
      }),
    ),
).pipe(Command.withDescription("Remove a dotfile from being managed"));
