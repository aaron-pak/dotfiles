import { Command, Options } from "@effect/cli";
import { runFullSync } from "./syncFlow.js";

const dry = Options.boolean("dry").pipe(
  Options.withAlias("n"),
  Options.withDescription("Show what would be synced without doing it"),
);

export const sync = Command.make("sync", { dry }, ({ dry }) =>
  runFullSync(dry),
).pipe(
  Command.withDescription(
    "Sync shared dotfiles, skills, and managed settings onto this machine",
  ),
);
