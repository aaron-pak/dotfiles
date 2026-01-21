import { Command } from "@effect/cli";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Console, Effect, Layer } from "effect";
import { add } from "./commands/add.js";
import { init } from "./commands/init.js";
import { remove } from "./commands/remove.js";
import { sync } from "./commands/sync.js";
import { Stow } from "./services/Stow.js";
import { StowConfig } from "./services/StowConfig.js";

// Root command
const dot = Command.make("dot", {}, () =>
  Console.log("Dotfiles manager\n\nUse --help for available commands."),
).pipe(
  Command.withDescription("Manage your dotfiles with ease"),
  Command.withSubcommands([sync, add, remove, init]),
);

// CLI application
const cli = Command.run(dot, { name: "dot", version: "0.1.0" });

// Layer composition
const MainLayer = Layer.provideMerge(
  Layer.provideMerge(Stow.Default, StowConfig.Default),
  BunContext.layer,
);

// Run
cli(process.argv).pipe(Effect.provide(MainLayer), BunRuntime.runMain);
