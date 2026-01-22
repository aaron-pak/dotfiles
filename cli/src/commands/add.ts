import { Args, Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";
import {
  AlreadyManaged,
  AlreadySymlink,
  InvalidPath,
  SourceNotFound,
  Stow,
} from "../services/Stow.js";

const paths = Args.text({ name: "paths" }).pipe(
  Args.withDescription("Paths to add (relative to home)"),
  Args.repeated,
);

const dryRun = Options.boolean("dry-run").pipe(
  Options.withAlias("n"),
  Options.withDescription("Show what would be added without doing it"),
);

export const add = Command.make("add", { paths, dryRun }, ({ paths, dryRun }) =>
  Effect.gen(function* () {
    if (paths.length === 0) {
      yield* Console.log("Usage: dot add [-n] <path>...");
      return;
    }

    const stow = yield* Stow;

    for (const p of paths) {
      if (dryRun) {
        yield* stow.checkAddable(p);
        yield* Console.log(`Would add: ~/${p}`);
      } else {
        yield* stow.addDotfile(p);
        yield* Console.log(`Added: ~/${p}`);
      }
    }

    if (!dryRun) {
      const links = yield* stow.sync();
      if (links.length > 0) {
        yield* Console.log("\nSymlinks created:");
        for (const { target } of links) {
          yield* Console.log(`  ${target}`);
        }
      }
    }
  }).pipe(
    Effect.catchTags({
      SourceNotFound: (e: SourceNotFound) =>
        Console.error(`Not found: ~/${e.path}`),
      AlreadyManaged: (e: AlreadyManaged) =>
        Console.error(`Already managed: ${e.path}`),
      AlreadySymlink: (e: AlreadySymlink) =>
        Console.error(`Already a symlink: ~/${e.path}`),
      InvalidPath: (e: InvalidPath) =>
        Console.error(`Invalid path "${e.path}": ${e.reason}`),
    }),
  ),
).pipe(Command.withDescription("Add dotfiles to be managed"));
