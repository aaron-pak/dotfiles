import { Command } from "@effect/cli";
import { Path } from "@effect/platform";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Cause, Chunk, Console, Effect, Layer } from "effect";
import { add } from "./commands/add.js";
import { ai } from "./commands/ai.js";
import { init } from "./commands/init.js";
import { remove } from "./commands/remove.js";
import { sync } from "./commands/sync.js";
import { AiLocalState } from "./services/AiLocalState.js";
import { AiSkills } from "./services/AiSkills.js";
import { AiState } from "./services/AiState.js";
import { ClaudeSettings } from "./services/ClaudeSettings.js";
import { CodexSettings } from "./services/CodexSettings.js";
import { Homebrew } from "./services/Homebrew.js";
import { Stow } from "./services/Stow.js";
import { StowConfig } from "./services/StowConfig.js";

// Root command
const dot = Command.make("dot", {}, () =>
  Console.log("Dotfiles manager\n\nUse --help for available commands."),
).pipe(
  Command.withDescription("Manage your dotfiles with ease"),
  Command.withSubcommands([sync, add, remove, init, ai]),
);

// CLI application
const cli = Command.run(dot, { name: "dot", version: "0.1.0" });

const ManagedAiLayer = Layer.provideMerge(
  Layer.mergeAll(ClaudeSettings.Default, CodexSettings.Default, AiSkills.Default),
  Layer.merge(AiState.Default, AiLocalState.Default),
);

const PlatformLayer = Layer.mergeAll(
  Path.layer,
  Layer.provideMerge(StowConfig.Default, Path.layer),
  BunContext.layer,
);

const MainLayer = Layer.provideMerge(
  Layer.merge(Layer.merge(Stow.Default, Homebrew.Default), ManagedAiLayer),
  PlatformLayer,
);

// Run
cli(process.argv).pipe(
  Effect.tapErrorCause((cause) => {
    if (Cause.isInterruptedOnly(cause)) return Effect.void;
    const errors = Cause.failures(cause);
    if (Chunk.isNonEmpty(errors)) {
      return Console.error(
        [...errors]
          .map((error) =>
            error instanceof Error ? error.message : String(error),
          )
          .join("\n"),
      );
    }
    return Console.error(Cause.pretty(cause));
  }),
  Effect.provide(MainLayer),
  BunRuntime.runMain({ disableErrorReporting: true }),
);
